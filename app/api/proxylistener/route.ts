import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getAllWhatsAppConfigs, getThreadForUser } from "@/lib/db"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp-api"
import OpenAI from "openai"

export async function POST(request: Request) {
  try {
    console.log("[PROXYLISTENER] ===== INICIO DE SOLICITUD =====")

    // Obtener los parámetros de la solicitud
    const data = await request.json()
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

    // Procesar según el tipo de respuesta
    let responseData = {
      success: true,
      action: "button_response",
      button_text: buttonResponse,
      user_phone: userPhoneNumber,
      timestamp: new Date().toISOString(),
    }

    // Determinar el tipo de acción basado en la respuesta del botón
    const buttonLower = buttonResponse.toLowerCase()

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

// Función para manejar envío de templates
async function handleTemplateSend(data: any) {
  try {
    const { Cliente_Id, Phone_Number_Id, Phone, Type, Body } = data

    console.log("[PROXYLISTENER] Parámetros extraídos:")
    console.log("[PROXYLISTENER] - Cliente_Id:", Cliente_Id)
    console.log("[PROXYLISTENER] - Phone_Number_Id:", Phone_Number_Id)
    console.log("[PROXYLISTENER] - Phone:", Phone)
    console.log("[PROXYLISTENER] - Type:", Type)
    console.log("[PROXYLISTENER] - Body:", typeof Body === "object" ? JSON.stringify(Body, null, 2) : Body)

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
          console.log("[PROXYLISTENER] Thread obtenido:", threadResult.threadId)

          // Analizar plantilla
          const templateAnalysis = {
            name: "plantilla_desconocida",
            content: "Plantilla enviada",
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

          // Crear notificación para OpenAI
          const notificationMessage = `[SISTEMA_PLANTILLA]
Plantilla_Nombre: ${templateAnalysis.name}
Plantilla_Contenido: ${templateAnalysis.content}
[/SISTEMA_PLANTILLA]`

          const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
          })

          await openai.beta.threads.messages.create(threadResult.threadId, {
            role: "user",
            content: notificationMessage,
          })

          console.log("[PROXYLISTENER] Notificación enviada a OpenAI exitosamente")
        } catch (error) {
          console.error("[PROXYLISTENER] Error al notificar a OpenAI:", error)
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
