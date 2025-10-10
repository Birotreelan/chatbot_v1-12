import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getAllWhatsAppConfigs, getThreadForUser } from "@/lib/db"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp-api"
import { safelyAddMessageToThread } from "@/lib/thread-manager"

export async function POST(request: Request) {
  try {
    console.log("[PROXYLISTENER] ===== INICIO DE SOLICITUD =====")

    console.log("[v0] 📥 REQUEST DETAILS:")
    console.log("[v0] Method:", request.method)
    console.log("[v0] URL:", request.url)
    console.log("[v0] Headers:", JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2))

    // Obtener los parámetros de la solicitud
    const data = await request.json()

    console.log("[v0] Body (parsed JSON):", JSON.stringify(data, null, 2))
    console.log("[v0] Body keys:", Object.keys(data))
    console.log("[v0] Body type:", typeof data)
    console.log("[PROXYLISTENER] ===== FIN DE DETALLES DE REQUEST =====")

    console.log("[PROXYLISTENER] Datos recibidos:", JSON.stringify(data, null, 2))

    // Detectar si es envío de template o respuesta de botón
    const isTemplateResponse = data.action === "template_response"

    if (isTemplateResponse) {
      console.log("[PROXYLISTENER] ===== PROCESANDO RESPUESTA DE BOTÓN =====")
      return await handleButtonResponse(data)
    } else {
      console.log("[PROXYLISTENER] ===== PROCESANDO ENVÍO DE TEMPLATE =====")
      return await handleTemplateSend(data)
    }
  } catch (error) {
    console.error("[PROXYLISTENER] Error general:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Función para manejar respuestas de botones
async function handleButtonResponse(data: any) {
  try {
    const { Cliente_Id, Phone_Number_Id, messages } = data

    if (!messages || messages.length === 0) {
      return NextResponse.json({ success: false, error: "No se encontraron mensajes" }, { status: 400 })
    }

    const message = messages[0]
    const userPhoneNumber = message.from
    const buttonResponse = message.button?.text || message.button?.payload || ""

    console.log("[PROXYLISTENER] Usuario:", userPhoneNumber)
    console.log("[PROXYLISTENER] Respuesta del botón:", buttonResponse)
    console.log("[PROXYLISTENER] Tipo de mensaje:", message.type)

    // Buscar configuración
    const config = await getWhatsAppConfigByPhoneId(Phone_Number_Id)
    if (!config) {
      return NextResponse.json(
        { success: false, error: `No se encontró configuración para Phone_Number_Id: ${Phone_Number_Id}` },
        { status: 404 },
      )
    }

    // Simular validación del estado del turno
    // En un sistema real, aquí consultarías la base de datos para verificar el estado actual del turno
    const buttonLower = buttonResponse.toLowerCase()

    // Simular diferentes tipos de errores que puede devolver el sistema real
    if (buttonLower.includes("cancelar")) {
      // Simular que el turno ya fue confirmado y no se puede cancelar
      return NextResponse.json({
        success: false,
        error: "CANNOT_CANCEL",
        message: "No se puede cancelar un turno que ya fue confirmado",
        action_type: "error_cancelacion",
        user_action: buttonResponse,
        suggested_action: "contact_clinic",
      })
    }

    if (buttonLower.includes("confirmar")) {
      // Simular que el turno ya fue cancelado y no se puede confirmar
      // (esto podría pasar si alguien cancela y luego intenta confirmar)
      const isAlreadyCancelled = Math.random() > 0.7 // 30% de probabilidad para testing

      if (isAlreadyCancelled) {
        return NextResponse.json({
          success: false,
          error: "CANNOT_CONFIRM",
          message: "No se puede confirmar un turno que ya fue cancelado",
          action_type: "error_confirmacion",
          user_action: buttonResponse,
          suggested_action: "contact_clinic",
        })
      }
    }

    // Procesar según el tipo de respuesta (casos exitosos)
    let responseData = {
      success: true,
      action: "button_response",
      button_text: buttonResponse,
      user_phone: userPhoneNumber,
      timestamp: new Date().toISOString(),
    }

    if (buttonLower.includes("confirmar") || buttonLower === "sí" || buttonLower === "si") {
      responseData = {
        ...responseData,
        action_type: "confirmacion_turno",
        message: "Turno confirmado exitosamente",
        status: "confirmed",
        next_steps: "El turno ha sido confirmado. Te esperamos en la fecha y hora programada.",
      }

      console.log("[PROXYLISTENER] ✅ Turno confirmado por usuario:", userPhoneNumber)
    } else if (buttonLower.includes("cancelar") || buttonLower === "no") {
      responseData = {
        ...responseData,
        action_type: "cancelacion_turno",
        message: "Turno cancelado exitosamente",
        status: "cancelled",
        next_steps: "El turno ha sido cancelado. Si deseas reagendar, puedes solicitar un nuevo turno.",
      }

      console.log("[PROXYLISTENER] ❌ Turno cancelado por usuario:", userPhoneNumber)
    } else if (buttonLower.includes("reprogramar") || buttonLower.includes("reagendar")) {
      responseData = {
        ...responseData,
        action_type: "reprogramacion_turno",
        message: "Solicitud de reprogramación recibida",
        status: "rescheduling_requested",
        next_steps:
          "Tu solicitud de reprogramación ha sido recibida. Nos comunicaremos contigo para coordinar una nueva fecha.",
      }

      console.log("[PROXYLISTENER] 🔄 Reprogramación solicitada por usuario:", userPhoneNumber)
    } else {
      // Respuesta genérica para otros botones
      responseData = {
        ...responseData,
        action_type: "respuesta_generica",
        message: `Respuesta "${buttonResponse}" procesada`,
        status: "processed",
        next_steps: "Tu respuesta ha sido registrada exitosamente.",
      }

      console.log("[PROXYLISTENER] ℹ️ Respuesta genérica procesada:", buttonResponse)
    }

    console.log("[PROXYLISTENER] Respuesta preparada:", JSON.stringify(responseData, null, 2))
    return NextResponse.json(responseData)
  } catch (error) {
    console.error("[PROXYLISTENER] Error procesando respuesta de botón:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Error procesando respuesta de botón",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Función para extraer información del turno desde el template
function extractAppointmentInfo(templateBody: any): any {
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
          // Los parámetros suelen estar en orden: fecha, hora, profesional, lugar
          const params = component.parameters

          if (params.length >= 1 && params[0].text) {
            // Primer parámetro suele ser la fecha
            appointmentInfo.fecha = params[0].text
          }

          if (params.length >= 2 && params[1].text) {
            // Segundo parámetro suele ser la hora
            appointmentInfo.hora = params[1].text
          }

          if (params.length >= 3 && params[2].text) {
            // Tercer parámetro suele ser el profesional
            appointmentInfo.profesional = params[2].text
          }

          if (params.length >= 4 && params[3].text) {
            // Cuarto parámetro suele ser el lugar
            appointmentInfo.lugar = params[3].text
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

    console.log("[PROXYLISTENER] Información del turno extraída:", appointmentInfo)
    return appointmentInfo
  } catch (error) {
    console.error("[PROXYLISTENER] Error al extraer información del turno:", error)
    return null
  }
}

// Función para manejar envío de templates
async function handleTemplateSend(data: any) {
  try {
    const { Cliente_Id, Phone_Number_Id, Phone, Type, Body, Chatbot_Data } = data

    console.log("[PROXYLISTENER] Parámetros extraídos:")
    console.log("[PROXYLISTENER] - Cliente_Id:", Cliente_Id)
    console.log("[PROXYLISTENER] - Phone_Number_Id:", Phone_Number_Id)
    console.log("[PROXYLISTENER] - Phone:", Phone)
    console.log("[PROXYLISTENER] - Type:", Type)
    console.log("[PROXYLISTENER] - Body:", typeof Body === "object" ? JSON.stringify(Body, null, 2) : Body)
    console.log("[PROXYLISTENER] - Chatbot_Data:", Chatbot_Data)

    // Validaciones
    if (!Cliente_Id) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Cliente_Id" }, { status: 400 })
    }

    if (!Body) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Body" }, { status: 400 })
    }

    if (!Phone_Number_Id && !Phone) {
      return NextResponse.json(
        { success: false, error: "Se requiere al menos uno de los parámetros: Phone_Number_Id o Phone" },
        { status: 400 },
      )
    }

    // Validar el tipo de mensaje
    if (Type && Type !== "text" && Type !== "template") {
      return NextResponse.json(
        { success: false, error: "El parámetro Type debe ser 'text' o 'template'" },
        { status: 400 },
      )
    }

    const messageType = Type || "text"

    // Buscar configuración de WhatsApp
    let config = null

    if (Phone_Number_Id) {
      config = await getWhatsAppConfigByPhoneId(Phone_Number_Id)
    }

    if (!config) {
      const allConfigs = await getAllWhatsAppConfigs()
      const matchingConfigs = allConfigs.filter((c) => c.cliente_id === Cliente_Id && c.active)

      if (matchingConfigs.length === 0) {
        return NextResponse.json(
          { success: false, error: `No se encontró una configuración activa para el Cliente_Id: ${Cliente_Id}` },
          { status: 404 },
        )
      }

      config = matchingConfigs[0]
    }

    console.log("[PROXYLISTENER] Configuración encontrada:", {
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      active: config.active,
      hasToken: !!config.accessToken,
    })

    if (!config.active) {
      return NextResponse.json(
        { success: false, error: "La configuración de WhatsApp no está activa" },
        { status: 400 },
      )
    }

    // Determinar número de teléfono destinatario
    let destinationPhone = Phone

    if (!destinationPhone) {
      if (!config.lastUserPhoneNumber) {
        return NextResponse.json(
          {
            success: false,
            error: "No se proporcionó un número de teléfono y no hay un número registrado en la configuración",
          },
          { status: 400 },
        )
      }
      destinationPhone = config.lastUserPhoneNumber
    }

    // Formatear número de teléfono
    if (!destinationPhone.startsWith("+")) {
      destinationPhone = `+${destinationPhone}`
    }

    const cleanPhoneNumber = destinationPhone.replace("+", "")

    console.log("[PROXYLISTENER] Número de teléfono formateado:", destinationPhone)
    console.log("[PROXYLISTENER] Enviando mensaje tipo:", messageType)

    // Enviar mensaje según el tipo
    let whatsappResponse = null

    if (messageType === "text") {
      whatsappResponse = await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, destinationPhone, Body)
    } else {
      whatsappResponse = await sendWhatsAppTemplate(
        config.phoneNumberId,
        config.accessToken,
        destinationPhone,
        Body,
        config.wabaId,
      )

      // Notificar a OpenAI sobre la plantilla enviada
      if (messageType === "template") {
        try {
          console.log("[PROXYLISTENER] Notificando a OpenAI sobre plantilla enviada...")

          const threadResult = await getThreadForUser(cleanPhoneNumber, config.id)

          if (!threadResult || !threadResult.threadId) {
            console.error("[PROXYLISTENER] ❌ No se pudo obtener threadId válido")
            console.error("[PROXYLISTENER] threadResult:", threadResult)
            throw new Error("ThreadId no disponible")
          }

          console.log("[PROXYLISTENER] Thread obtenido:", threadResult.threadId)
          console.log("[PROXYLISTENER] Tipo de threadId:", typeof threadResult.threadId)

          // Extraer información del turno desde el template
          const appointmentInfo = extractAppointmentInfo(Body)

          // Analizar plantilla
          const templateAnalysis = {
            name: "plantilla_desconocida",
            content: "Plantilla enviada",
            appointmentInfo: appointmentInfo,
          }

          try {
            const templateData = typeof Body === "string" ? JSON.parse(Body) : Body
            console.log("[PROXYLISTENER] Datos de plantilla parseados:", JSON.stringify(templateData, null, 2))

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

            console.log("[PROXYLISTENER] Análisis de plantilla completado:", templateAnalysis)
          } catch (e) {
            console.log("[PROXYLISTENER] Error al parsear template data:", e)
          }

          let chatbotDataParsed = null
          if (Chatbot_Data) {
            try {
              chatbotDataParsed = typeof Chatbot_Data === "string" ? JSON.parse(Chatbot_Data) : Chatbot_Data
              console.log("[PROXYLISTENER] Chatbot_Data parseado:", JSON.stringify(chatbotDataParsed, null, 2))
            } catch (e) {
              console.error("[PROXYLISTENER] Error al parsear Chatbot_Data:", e)
            }
          }

          let notificationMessage = `[SISTEMA_PLANTILLA]
Plantilla_Nombre: ${templateAnalysis.name}
Plantilla_Contenido: ${templateAnalysis.content}`

          // Agregar información del turno si está disponible
          if (appointmentInfo && (appointmentInfo.fecha || appointmentInfo.hora || appointmentInfo.profesional)) {
            notificationMessage += `
Turno_Fecha: ${appointmentInfo.fecha || "No especificada"}
Turno_Hora: ${appointmentInfo.hora || "No especificada"}
Turno_Profesional: ${appointmentInfo.profesional || "No especificado"}
Turno_Lugar: ${appointmentInfo.lugar || "No especificado"}`
          }

          if (chatbotDataParsed) {
            notificationMessage += `

[CONTEXTO_COMPLETO_TURNO]`

            // Información del paciente
            if (chatbotDataParsed.paciente) {
              notificationMessage += `
Paciente_Nombres: ${chatbotDataParsed.paciente.nombres || ""}
Paciente_Apellido: ${chatbotDataParsed.paciente.apellido || ""}
Paciente_DNI: ${chatbotDataParsed.paciente.dni || ""}
Paciente_Telefono: ${chatbotDataParsed.paciente.telefono || ""}`
            }

            // Información de los turnos
            if (chatbotDataParsed.turnos && Array.isArray(chatbotDataParsed.turnos)) {
              notificationMessage += `
Cantidad_Turnos: ${chatbotDataParsed.cantidad_turnos || chatbotDataParsed.turnos.length}`

              chatbotDataParsed.turnos.forEach((turno: any, index: number) => {
                notificationMessage += `

Turno_${index + 1}:
  - Fecha: ${turno.fecha || ""}
  - Fecha_Formateada: ${turno.fecha_formateada || ""}
  - Hora: ${turno.hora || ""}
  - Hora_Formateada: ${turno.hora_formateada || ""}
  - Profesional: ${turno.profesional || ""}
  - Profesional_ID: ${turno.profesional_id || ""}
  - Sede: ${turno.sede || ""}
  - Direccion: ${turno.direccion || ""}
  - Agenda_ID: ${turno.agenda_id || ""}`
              })
            }

            // Información de la clínica y tipo de mensaje
            if (chatbotDataParsed.clinica) {
              notificationMessage += `
Clinica: ${chatbotDataParsed.clinica}`
            }

            if (chatbotDataParsed.tipo_mensaje) {
              notificationMessage += `
Tipo_Mensaje: ${chatbotDataParsed.tipo_mensaje}`
            }

            notificationMessage += `
[/CONTEXTO_COMPLETO_TURNO]`
          }

          notificationMessage += `
[/SISTEMA_PLANTILLA]`

          console.log("[PROXYLISTENER] 🔍 Validando threadId antes de agregar mensaje:", threadResult.threadId)

          if (!threadResult.threadId || typeof threadResult.threadId !== "string") {
            throw new Error(`ThreadId inválido: ${threadResult.threadId} (tipo: ${typeof threadResult.threadId})`)
          }

          console.log("[v0] 🚀 ===== ENVIANDO MENSAJE A OPENAI =====")
          console.log("[v0] ThreadID:", threadResult.threadId)
          console.log("[v0] Mensaje completo que se enviará:")
          console.log(notificationMessage)
          console.log("[v0] ==========================================")

          await safelyAddMessageToThread(threadResult.threadId, {
            role: "user",
            content: notificationMessage,
          })

          console.log("[v0] ✅ MENSAJE ENVIADO A OPENAI EXITOSAMENTE")
          console.log("[PROXYLISTENER] Notificación enviada a OpenAI exitosamente")
          console.log("[PROXYLISTENER] 📤 Mensaje enviado a OpenAI:")
          console.log(notificationMessage)
        } catch (error: any) {
          console.error("[PROXYLISTENER] Error al notificar a OpenAI:", error)
          console.error("[PROXYLISTENER] Stack trace:", error.stack)
        }
      }
    }

    console.log("[PROXYLISTENER] Respuesta de WhatsApp:", whatsappResponse)
    return NextResponse.json(whatsappResponse)
  } catch (error) {
    console.error("[PROXYLISTENER] Error enviando template:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al enviar mensaje",
      },
      { status: 500 },
    )
  }
}
