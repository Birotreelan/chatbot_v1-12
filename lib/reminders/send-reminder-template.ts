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
import { getThreadForUser } from "../db"
import { safelyAddMessageToThread } from "../thread-manager"
import { extractAndFormatDate } from "../utils/date-utils"
import { saveAppointmentContext } from "../appointment-flow-state"

// Función para extraer información del turno desde el template
export function extractAppointmentInfo(templateBody: any): any {
  try {
    const appointmentInfo = {
      fecha: null,
      hora: null,
      profesional: null,
      especialidad: null,
      lugar: null,
    }

    // Si el Body es string, intentar parsearlo
    const templateData = typeof templateBody === "string" ? JSON.parse(templateBody) : templateBody

    // Buscar en los componentes del template
    if (templateData.template && templateData.template.components) {
      for (const component of templateData.template.components) {
        if (component.type === "body" && component.parameters) {
          // Los parámetros venguen en este orden:
          // [0] = Nombre de la clínica
          // [1] = Fecha
          // [2] = Hora
          // [3] = Profesional
          // [4] = Lugar/Dirección
          const params = component.parameters

          if (params.length >= 2 && params[1].text) {
            // Segundo parámetro es la fecha
            appointmentInfo.fecha = params[1].text
          }

          if (params.length >= 3 && params[2].text) {
            // Tercer parámetro es la hora
            appointmentInfo.hora = params[2].text
          }

          if (params.length >= 4 && params[3].text) {
            // Cuarto parámetro es el profesional
            appointmentInfo.profesional = params[3].text
          }

          if (params.length >= 5 && params[4].text) {
            // Quinto parámetro es el lugar
            appointmentInfo.lugar = params[4].text
          }
        }
      }
    }

    // También buscar en el texto plano si no encontramos en los parámetros
    if (!appointmentInfo.fecha || !appointmentInfo.hora) {
      const bodyText = JSON.stringify(templateData)

      // Buscar patrones de fecha (DD/MM/YYYY)
      const fechaMatch = bodyText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/g)
      if (fechaMatch && fechaMatch.length > 0) {
        appointmentInfo.fecha = fechaMatch[0]
      }

      // Buscar patrones de hora (HH:MM)
      const horaMatch = bodyText.match(/(\d{1,2}:\d{2})/g)
      if (horaMatch && horaMatch.length > 0) {
        appointmentInfo.hora = horaMatch[0]
      }

      // Buscar nombres de profesionales (palabras que empiecen con mayúscula)
      const profesionalMatch = bodyText.match(/([A-Z][a-z]+,?\s+[A-Z][a-z]+)/g)
      if (profesionalMatch && profesionalMatch.length > 0) {
        appointmentInfo.profesional = profesionalMatch[0]
      }
    }

    console.log("[REMINDERS] Información del turno extraída:", appointmentInfo)
    return appointmentInfo
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

  const whatsappResponse = await sendWhatsAppTemplate(config.phoneNumberId, config.accessToken, destinationPhone, Body, config.wabaId)

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

  const appointmentInfo = extractAppointmentInfo(Body)
  console.log(`[REMINDERS] 📊 config.id: ${config.id}`)
  console.log(`[REMINDERS] 📊 config.cliente_id: ${config.cliente_id || "NO DISPONIBLE"}`)

  if (config.cliente_id) {
    console.log(`[REMINDERS] 📊 Trackeando template con cliente_id: ${config.cliente_id}`)
    await trackTemplateSent(config.cliente_id, cleanPhoneNumber, appointmentInfo)
    console.log(`[REMINDERS] ✅ Template tracked para cliente_id: ${config.cliente_id}`)
  } else {
    console.warn(`[REMINDERS] ⚠️ No hay cliente_id para config ${config.id}, no se puede trackear template`)
  }

  // Notificar a OpenAI sobre la plantilla enviada
  try {
    console.log("[REMINDERS] Notificando a OpenAI sobre plantilla enviada...")

    const threadResult = await getThreadForUser(cleanPhoneNumber, config.id)

    if (!threadResult || !threadResult.threadId) {
      console.error("[REMINDERS] ❌ No se pudo obtener threadId válido")
      console.error("[REMINDERS] threadResult:", threadResult)
      throw new Error("ThreadId no disponible")
    }

    console.log("[REMINDERS] Thread obtenido:", threadResult.threadId)

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

    let chatbotDataParsed = null
    if (Chatbot_Data) {
      try {
        chatbotDataParsed = typeof Chatbot_Data === "string" ? JSON.parse(Chatbot_Data) : Chatbot_Data
      } catch (e) {
        console.error("[REMINDERS] ❌ Error al parsear Chatbot_Data:", e)
      }
    }

    // Guardar el Chatbot_Data en Redis para respuestas directas (sin OpenAI)
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
    }

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

    if (!threadResult.threadId || typeof threadResult.threadId !== "string") {
      throw new Error(`ThreadId inválido: ${threadResult.threadId} (tipo: ${typeof threadResult.threadId})`)
    }

    await safelyAddMessageToThread(threadResult.threadId, {
      role: "user",
      content: notificationMessage,
    })

    console.log("[REMINDERS] ✅ MENSAJE ENVIADO A OPENAI EXITOSAMENTE")
  } catch (error: any) {
    console.error("[REMINDERS] Error al notificar a OpenAI:", error)
    console.error("[REMINDERS] Stack trace:", error.stack)
  }

  return whatsappResponse
}
