/**
 * lib/reminders/send-reminder-template.ts
 *
 * Envío de un template de WhatsApp (recordatorio de turno) + tracking +
 * notificación a OpenAI. Extraído de app/api/proxylistener/route.ts
 * (rama Type="template" de handleTemplateSend) para poder reutilizar
 * EXACTAMENTE la misma lógica desde:
 *   - proxylistener/route.ts: el envío síncrono original que dispara el sistema externo.
 *   - app/api/reminders/deliver/route.ts: los reintentos (24h / segundo / último) programados vía QStash.
 *
 * No se tocó ningún detalle de comportamiento respecto al código original — es
 * un recorte y pegue con las variables convertidas en parámetros.
 */

import { sendWhatsAppTemplate } from "../whatsapp-api"
import { saveConversationMessage } from "../conversations"
import { nanoid } from "nanoid"
import { trackTemplateSent } from "../appointment-stats"
import { extractAndFormatDate } from "../utils/date-utils"
import { saveAppointmentContext } from "../appointment-flow-state"
import { extraerDatosDelTurno, type DatosDelTurno } from "./datos-del-turno"
import { agregarBotonesAlEnvio } from "../flows/recordatorio-con-botones"

/**
 * Extrae los datos del turno de un template que se está por enviar.
 *
 * Delega en lib/reminders/datos-del-turno.ts, que es puro y está testeado. Ver
 * ahí el porqué: la versión anterior leía los parámetros por posición, y con
 * `cancelar_turno_solicitado` —que no lleva el nombre de la clínica al
 * principio— guardaba la hora como fecha y el teléfono como profesional.
 *
 * `chatbotData` es opcional sólo por compatibilidad con llamadas viejas; sin él
 * la extracción es mucho más pobre, porque es la fuente autoritativa.
 */
export function extractAppointmentInfo(templateBody: any, chatbotData?: any): DatosDelTurno | null {
  try {
    const datos = extraerDatosDelTurno(templateBody, chatbotData)
    console.log("[REMINDERS] Información del turno extraída:", datos)
    return datos
  } catch (error) {
    console.error("[REMINDERS] Error al extraer información del turno:", error)
    return null
  }
}

// Función para extraer contenido legible de la plantilla
export function extractTemplateContent(templateBody: any, chatbotData?: any): string {
  try {
    const templateData = typeof templateBody === "string" ? JSON.parse(templateBody) : templateBody

    if (!templateData.template) {
      return "Plantilla enviada"
    }

    const templateName = templateData.template.name || "plantilla_desconocida"
    let content = `Plantilla: ${templateName}\n\n`

    // Parse chatbot data if available
    let chatbotDataParsed = null
    if (chatbotData) {
      try {
        chatbotDataParsed = typeof chatbotData === "string" ? JSON.parse(chatbotData) : chatbotData
      } catch (e) {
        console.error("[REMINDERS] Error parsing chatbot data:", e)
      }
    }

    // Extract parameters from body component
    if (templateData.template.components) {
      for (const component of templateData.template.components) {
        if (component.type === "body" && component.parameters) {
          const params = component.parameters.filter((p: any) => p.type === "text" && p.text).map((p: any) => p.text)

          if (params.length > 0) {
            // Check if we have chatbot data with multiple appointments
            if (chatbotDataParsed && chatbotDataParsed.turnos && Array.isArray(chatbotDataParsed.turnos)) {
              const turnos = chatbotDataParsed.turnos
              const clinica = params[0] || chatbotDataParsed.clinica || "la clínica"
              const fecha = turnos[0]?.fecha || params[1] || "próximamente"

              if (turnos.length > 1) {
                // Multiple appointments format
                content += `Hola! Nos comunicamos desde ${clinica} para recordarle que tiene los siguientes turnos el día ${fecha}:\n\n`

                turnos.forEach((turno: any) => {
                  content += `  ●   ${turno.hora || "hora a confirmar"} horas con ${turno.profesional || "el profesional"}  en ${turno.direccion || turno.sede || "nuestra sede"}.\n`
                })

                content += `\nPor favor, confirme o cancele su asistencia.\nMuchas gracias.`
              } else {
                // Single appointment format
                const turno = turnos[0]
                content += `Hola! Nos comunicamos desde ${clinica} para recordarle que tiene un turno el día ${turno.fecha || fecha}, a las ${turno.hora || "a confirmar"} horas con ${turno.profesional || "el profesional"} en ${turno.direccion || turno.sede || "nuestra sede"}.\n\n`
                content += `Por favor, confirme o cancele su asistencia.`
              }
            } else if (templateName.includes("confirmacion") || templateName.includes("recordatorio")) {
              // Fallback to parameter-based extraction for single appointment
              const [clinica, fecha, hora, profesional, lugar] = params
              content += `Hola! Nos comunicamos desde ${clinica || "la clínica"} para recordarle que tiene un turno el día ${fecha || "próximamente"}, a las ${hora || "a confirmar"} horas con ${profesional || "el profesional"} en ${lugar || "nuestra sede"}.\n\n`
              content += `Por favor, confirme o cancele su asistencia.`
            } else {
              // Generic template
              content += params.join(" | ")
            }
          }
        }
      }
    }

    return content
  } catch (error) {
    console.error("[REMINDERS] Error extracting template content:", error)
    return "Plantilla enviada (contenido no disponible)"
  }
}

export interface SendReminderTemplateParams {
  /** Config de WhatsApp del cliente (getWhatsAppConfigByPhoneIdFresh / getAllWhatsAppConfigs) */
  config: any
  destinationPhone: string
  cleanPhoneNumber: string
  /** Envelope del template de WhatsApp (string JSON u objeto ya parseado) */
  Body: any
  Chatbot_Data?: any
  Sede_Id?: string
}

/**
 * Envía el template de WhatsApp, guarda el mensaje en el historial de
 * conversación, trackea el envío para estadísticas, y notifica a OpenAI del
 * envío con el contexto completo del turno — idéntico a lo que hacía
 * proxylistener/route.ts para el envío original (Type="template").
 */
export async function sendReminderTemplate(params: SendReminderTemplateParams): Promise<any> {
  const { config, destinationPhone, cleanPhoneNumber, Body, Chatbot_Data, Sede_Id } = params

  // ── Recordatorio con tres botones (22/9/2026) ────────────────────────────
  //
  // El sistema de la clínica manda `confirmacion_1_turno`, que tiene dos
  // botones: confirmar y cancelar. Cuando el cliente tiene el portal activo, lo
  // reescribimos al template de tres —el tercero es "Reprogramar turno"— sin
  // que la clínica cambie absolutamente nada de su integración.
  //
  // Los parámetros del cuerpo se copian tal cual. Es lo único que no puede
  // fallar acá: un parámetro corrido es un paciente recibiendo la fecha de otro.
  //
  // Si algo no encaja —el template ya trae botones propios, el payload tiene
  // otra forma, el cliente no configuró el nombre— se manda el original. Un
  // recordatorio sin el botón nuevo llega igual; uno que no llega es un
  // paciente que no se entera de su turno.
  // ── No se ofrece un botón que no lleva a ningún lado (23/9/2026) ─────────
  //
  // `Chatbot_Data` trae `admite_reagendamiento` por turno. Cuando es `false`
  // —agendas que la clínica sólo reserva por teléfono— el tercer botón no tiene
  // destino posible: el proxy va a devolver cero turnos, con razón.
  //
  // Se decide acá, en el envío, y no sólo al responder. Contestar bien "eso se
  // reprograma por teléfono" está implementado y es la red de seguridad, pero
  // es peor experiencia y encima cuesta: el paciente toca un botón, espera, y
  // recibe un no. Mejor no mostrárselo.
  //
  // La red de seguridad sigue haciendo falta igual: entre el recordatorio y el
  // clic pasan horas, y la clínica puede cambiar la agenda en el medio.
  let admiteReagendamiento = true
  try {
    const datos = typeof Chatbot_Data === "string" ? JSON.parse(Chatbot_Data) : Chatbot_Data
    const primerTurno = Array.isArray(datos?.turnos) ? datos.turnos[0] : undefined
    // `!== false`: si el campo no viene, no sabemos, y no sabemos no es un no.
    if (primerTurno?.admite_reagendamiento === false) admiteReagendamiento = false
  } catch {
    // Chatbot_Data ilegible: se sigue como si admitiera. El caso lo atrapa la
    // compuerta de la respuesta.
  }

  let bodyAEnviar = Body
  if (config.clientePortalWeb === true && config.templateRecordatorioFlows && !admiteReagendamiento) {
    console.log(
      "[REMINDERS] El turno no admite reagendamiento online; se envía el recordatorio original (sin el botón de reprogramar)",
    )
  } else if (config.clientePortalWeb === true && config.templateRecordatorioFlows) {
    const reescrito = agregarBotonesAlEnvio(Body, {
      nombreTemplateFlows: config.templateRecordatorioFlows,
    })
    if (reescrito) {
      bodyAEnviar = reescrito
      console.log(`[REMINDERS] Recordatorio reescrito a ${config.templateRecordatorioFlows} (3 botones)`)
    } else {
      console.warn("[REMINDERS] No se pudo reescribir el recordatorio; se envía el original")
    }
  }

  const whatsappResponse = await sendWhatsAppTemplate(config.phoneNumberId, config.accessToken, destinationPhone, bodyAEnviar, config.wabaId)

  const templateContent = extractTemplateContent(Body, Chatbot_Data)
  await saveConversationMessage({
    id: nanoid(),
    role: "assistant",
    content: templateContent,
    timestamp: new Date().toISOString(),
    phoneNumber: cleanPhoneNumber,
    configId: config.id,
    messageType: "template",
  })
  console.log("[REMINDERS] ✅ Mensaje de plantilla guardado en Redis")

  // 19/8/2026 (caso Vicente, tel. 1139200357): el recordatorio nunca se agregaba al
  // historial corto que lee el AI Dispatcher (conversation-history.ts, distinto del
  // saveConversationMessage de arriba, que es para el visor del dashboard, y distinto
  // también del thread de OpenAI que se notifica más abajo). Sin esto, la primera
  // respuesta del paciente al recordatorio ("Si mucha gracias") se clasificaba sin
  // saber que se le acababa de preguntar explícitamente "confirme o cancele su
  // asistencia" — el dispatcher solo veía el dato crudo "Estado: No confirmado" del
  // turno. Ver también context-builder.ts (templatePendingConfirmation).
  try {
    const { appendToHistory } = await import("../conversation-state/conversation-history")
    await appendToHistory(cleanPhoneNumber, {
      role: "bot",
      text: templateContent,
      timestamp: Date.now(),
    })
  } catch (e) {
    console.error("[REMINDERS] ⚠️ Error guardando plantilla en conversation-history (continuando):", e)
  }

  // Parsear Chatbot_Data ANTES de extraer los datos del turno (17/9/2026).
  // Antes se parseaba más abajo y extractAppointmentInfo sólo recibía el Body
  // del template, así que tenía que deducir los campos por la posición de los
  // parámetros — y con `cancelar_turno_solicitado`, que no lleva el nombre de
  // la clínica al principio, quedaban todos corridos un lugar. Chatbot_Data
  // trae los mismos datos con nombre; era cuestión de leerlos antes.
  let chatbotDataParsed: any = null
  if (Chatbot_Data) {
    try {
      chatbotDataParsed = typeof Chatbot_Data === "string" ? JSON.parse(Chatbot_Data) : Chatbot_Data
    } catch (e) {
      console.error("[REMINDERS] ❌ Error al parsear Chatbot_Data:", e)
    }
  }

  const appointmentInfo = extractAppointmentInfo(Body, chatbotDataParsed)
  console.log(`[REMINDERS] 📊 config.id: ${config.id}`)
  console.log(`[REMINDERS] 📊 config.cliente_id: ${config.cliente_id || "NO DISPONIBLE"}`)

  if (config.cliente_id) {
    console.log(`[REMINDERS] 📊 Trackeando template con cliente_id: ${config.cliente_id}`)
    await trackTemplateSent(config.cliente_id, cleanPhoneNumber, appointmentInfo)
    console.log(`[REMINDERS] ✅ Template tracked para cliente_id: ${config.cliente_id}`)
  } else {
    console.warn(`[REMINDERS] ⚠️ No hay cliente_id para config ${config.id}, no se puede trackear template`)
  }

  // (Chatbot_Data ya se parseó más arriba, antes de extraer los datos del turno.)

  // CRÍTICO (fix 27/8/2026): guardar el contexto del turno en Redis para que
  // el flujo de respuestas DIRECTAS (botones "Confirmar"/"Cancelar", que no
  // pasan por OpenAI) funcione. Antes esto vivía DENTRO del try/catch de
  // notificación a OpenAI de abajo — desde que OpenAI dio de baja la
  // Assistants API (sunset 26/8/2026, /v1/threads ahora devuelve 404 siempre),
  // ese try/catch falla en la primera línea y el contexto nunca se guardaba.
  // Resultado real observado: paciente responde "Confirmar" → "[APPOINTMENT-FLOW]
  // No hay contexto" → bot responde "No pudimos procesar tu confirmación...".
  // Se saca este guardado del bloque de OpenAI para que corra SIEMPRE,
  // sin depender de que esa notificación tenga éxito.
  if (chatbotDataParsed && config && cleanPhoneNumber) {
    try {
      const firstTurno = Array.isArray(chatbotDataParsed.turnos) && chatbotDataParsed.turnos[0]
      if (firstTurno && firstTurno.agenda_id && !chatbotDataParsed.appointment_id) {
        chatbotDataParsed.appointment_id = firstTurno.agenda_id
      }
      if (!chatbotDataParsed.proxyUrl) {
        // Proxy dinámico por clínica primero (config.proxy, ya en scope), con
        // fallback a las env vars globales — ver lib/proxy-url-resolver.ts
        chatbotDataParsed.proxyUrl = config.proxy || process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL || null
      }
      await saveAppointmentContext(cleanPhoneNumber, config.id, chatbotDataParsed)
      console.log("[REMINDERS] ✅ Contexto de turno guardado en Redis para respuestas directas", {
        appointment_id: chatbotDataParsed.appointment_id,
        tieneProxyUrl: !!chatbotDataParsed.proxyUrl,
      })
    } catch (e) {
      console.error("[REMINDERS] ⚠️ Error guardando contexto en Redis (continuando):", e)
    }
  } else if (!chatbotDataParsed) {
    console.warn("[REMINDERS] ⚠️ ADVERTENCIA: No se recibió Chatbot_Data en la solicitud")
  }

  // ── Guardar el recordatorio como "paso pendiente" (7/9/2026) ──────────────
  //
  // El recordatorio le hace al paciente una pregunta concreta ("por favor,
  // confirme o cancele su asistencia"), pero se envía por sendWhatsAppTemplate,
  // no por sendDirectResponse — que es donde se guarda el paso. Resultado: el
  // dispatcher nunca veía el texto de la pregunta que estaba respondiendo.
  //
  // Ese es el caso Vicente (tel. 1139200357, 19/8/2026): contestó "Si mucha
  // gracias" al recordatorio y se leyó como un agradecimiento suelto, porque
  // sin la pregunta a la vista "gracias" es cortesía. Con el texto del
  // recordatorio en el contexto, ese "Si" es inequívocamente la respuesta.
  //
  // Se guarda el contenido legible reconstruido (extractTemplateContent), no el
  // JSON del template: es lo que el paciente efectivamente leyó.
  if (config?.id && cleanPhoneNumber) {
    try {
      const textoRecordatorio = extractTemplateContent(Body, Chatbot_Data)
      if (textoRecordatorio && !textoRecordatorio.startsWith("Plantilla enviada")) {
        const { saveStepPrompt } = await import("../appointment-flow-state")
        await saveStepPrompt(cleanPhoneNumber, config.id, textoRecordatorio)
        console.log("[REMINDERS] ✅ Recordatorio guardado como paso pendiente para el dispatcher")
      }
    } catch (e) {
      // Nunca puede romper el envío del recordatorio: es sólo contexto extra.
      console.error("[REMINDERS] ⚠️ No se pudo guardar el recordatorio como paso (continuando):", e)
    }
  }

  // Registrar en el contexto de la conversación que se envió esta plantilla.
  //
  // 31/8/2026: esto llamaba a getThreadForUser + safelyAddMessageToThread (la
  // Assistants API de OpenAI). Desde el sunset del 26/8 devolvía 404 en CADA
  // envío de plantilla — 774 llamadas fallidas registradas en los logs de
  // Vercel, todas inútiles. Cuando migré este archivo saqué el guardado de
  // contexto de este try/catch pero dejé la notificación intacta.
  // Ahora la nota va al historial propio (lib/openai-responses.ts), que es lo
  // que el motor actual lee.
  try {
    console.log("[REMINDERS] Registrando contexto de plantilla enviada...")

    // Analizar plantilla
    const templateAnalysis = {
      name: "plantilla_desconocida",
      content: "Plantilla enviada",
      appointmentInfo: appointmentInfo,
    }

    try {
      const templateData = typeof Body === "string" ? JSON.parse(Body) : Body

      if (templateData.template && templateData.template.name) {
        templateAnalysis.name = templateData.template.name
      } else if (templateData.name) {
        templateAnalysis.name = templateData.name
      }

      if (templateData.template && templateData.template.components) {
        const components = templateData.template.components
        let textContent = ""

        for (const component of components) {
          if (component.type === "body" && component.parameters) {
            textContent = `Plantilla ${templateAnalysis.name} con parámetros enviada`
            break
          }
        }

        if (textContent) {
          templateAnalysis.content = textContent
        }
      }
    } catch (e) {
      console.log("[REMINDERS] Error al parsear template data:", e)
    }

    // chatbotDataParsed ya se calculó y se usó para guardar el contexto ANTES
    // de este try/catch (ver más arriba) — se reutiliza acá, no se vuelve a parsear.

    let notificationMessage = `[SISTEMA_PLANTILLA]
Plantilla_Nombre: ${templateAnalysis.name}
Plantilla_Contenido: ${templateAnalysis.content}`

    if (appointmentInfo && (appointmentInfo.fecha || appointmentInfo.hora || appointmentInfo.profesional)) {
      const fechaFormateada = appointmentInfo.fecha ? extractAndFormatDate(appointmentInfo.fecha) : "No especificada"

      notificationMessage += `
Turno_Fecha: ${fechaFormateada}
Turno_Hora: ${appointmentInfo.hora || "No especificada"}
Turno_Profesional: ${appointmentInfo.profesional || "No especificado"}
Turno_Lugar: ${appointmentInfo.lugar || "No especificado"}`
    }

    if (chatbotDataParsed) {
      notificationMessage += `

[CONTEXTO_COMPLETO_TURNO]`

      if (chatbotDataParsed.paciente) {
        const paciente = chatbotDataParsed.paciente

        if (!paciente.mail || paciente.mail.trim() === "") {
          console.warn("[REMINDERS] ⚠️ ADVERTENCIA: El campo 'mail' está vacío en Chatbot_Data")
        }

        notificationMessage += `
Paciente_Nombres: ${paciente.nombres || ""}
Paciente_Apellido: ${paciente.apellido || ""}
Paciente_DNI: ${paciente.dni || ""}
Paciente_Telefono: ${paciente.telefono || ""}
Paciente_Mail: ${paciente.mail || ""}
Paciente_Obra_Social_ID: ${paciente.obra_social_id || ""}
Paciente_Obra_Social: ${paciente.obra_social_nombre || ""}`
      }

      if (chatbotDataParsed.turnos && Array.isArray(chatbotDataParsed.turnos)) {
        notificationMessage += `

Cantidad_Turnos: ${chatbotDataParsed.cantidad_turnos || chatbotDataParsed.turnos.length}`

        chatbotDataParsed.turnos.forEach((turno: any, index: number) => {
          const fechaFormateada = turno.fecha ? extractAndFormatDate(turno.fecha) : ""

          notificationMessage += `

Turno_${index + 1}:
  - Fecha: ${fechaFormateada}
  - Fecha_Formateada: ${turno.fecha_formateada || ""}
  - Hora: ${turno.hora || ""}
  - Hora_Formateada: ${turno.hora_formateada || ""}
  - Profesional: ${turno.profesional || ""}
  - Profesional_ID: ${turno.profesional_id || ""}
  - Sede: ${turno.sede || ""}
  - Dirección: ${turno.direccion || ""}
  - Agenda_ID: ${turno.agenda_id || ""}`
        })
      }

      if (chatbotDataParsed.clinica) {
        notificationMessage += `

Clinica: ${chatbotDataParsed.clinica}`
      }

      if (chatbotDataParsed.tipo_mensaje) {
        notificationMessage += `
Tipo_Mensaje: ${chatbotDataParsed.tipo_mensaje}`
      }

      if (Sede_Id) {
        notificationMessage += `
Sede_ID: ${Sede_Id}`
      }

      notificationMessage += `
[/CONTEXTO_COMPLETO_TURNO]`
    } else {
      console.warn("[REMINDERS] ⚠️ ADVERTENCIA: No se recibió Chatbot_Data en la solicitud")

      if (Sede_Id) {
        notificationMessage += `
Sede_ID: ${Sede_Id}`
      }
    }

    notificationMessage += `
[/SISTEMA_PLANTILLA]`

    const { appendResponsesContextNote } = await import("../openai-responses")
    await appendResponsesContextNote(config.id, cleanPhoneNumber, notificationMessage)

    console.log("[REMINDERS] ✅ Contexto de plantilla registrado en el historial")
  } catch (error: any) {
    console.error("[REMINDERS] Error registrando el contexto de la plantilla:", error)
    console.error("[REMINDERS] Stack trace:", error.stack)
  }

  return whatsappResponse
}
