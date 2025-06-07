import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getAllWhatsAppConfigs, getThreadForUser } from "@/lib/db"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp-api"
import OpenAI from "openai"

export async function POST(request: Request) {
  try {
    console.log("[PROXYLISTENER] Iniciando procesamiento de solicitud")

    // Obtener los parámetros de la solicitud
    const data = await request.json()
    const { Cliente_Id, Phone_Number_Id, Phone, Type, Body } = data

    console.log("[PROXYLISTENER] Parámetros recibidos:", {
      Cliente_Id,
      Phone_Number_Id,
      Phone,
      Type,
      bodyType: typeof Body,
      bodyLength: typeof Body === "string" ? Body.length : JSON.stringify(Body).length,
    })

    // Validar que se proporcionaron los parámetros necesarios
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

    // Usar "text" como valor predeterminado si no se proporciona Type
    const messageType = Type || "text"

    console.log("[PROXYLISTENER] Buscando configuración de WhatsApp...")

    // Buscar la configuración de WhatsApp correspondiente
    let config = null

    // Primero intentamos buscar por Phone_Number_Id si está disponible
    if (Phone_Number_Id) {
      config = await getWhatsAppConfigByPhoneId(Phone_Number_Id)
    }

    // Si no encontramos la configuración por Phone_Number_Id o no se proporcionó,
    // buscamos todas las configuraciones que coincidan con el Cliente_Id
    if (!config) {
      const allConfigs = await getAllWhatsAppConfigs()
      const matchingConfigs = allConfigs.filter((c) => c.cliente_id === Cliente_Id && c.active)

      if (matchingConfigs.length === 0) {
        return NextResponse.json(
          { success: false, error: `No se encontró una configuración activa para el Cliente_Id: ${Cliente_Id}` },
          { status: 404 },
        )
      }

      // Usamos la primera configuración que coincida
      config = matchingConfigs[0]
    }

    console.log("[PROXYLISTENER] Configuración encontrada:", {
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      active: config.active,
      hasToken: !!config.accessToken,
    })

    // Verificar que la configuración esté activa
    if (!config.active) {
      return NextResponse.json(
        { success: false, error: "La configuración de WhatsApp no está activa" },
        { status: 400 },
      )
    }

    // Determinar el número de teléfono del destinatario
    let destinationPhone = Phone

    // Si no se proporcionó un número de teléfono específico, usamos el último número
    // de teléfono registrado en la configuración
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

    // Asegurarse de que el número de teléfono tenga el formato correcto (con código de país)
    if (!destinationPhone.startsWith("+")) {
      // Si no tiene el prefijo +, asumimos que es un número de Argentina
      destinationPhone = `+${destinationPhone}`
    }

    // Limpiar el número para usarlo como clave (sin el +)
    const cleanPhoneNumber = destinationPhone.replace("+", "")

    console.log("[PROXYLISTENER] Número de teléfono formateado:", destinationPhone)
    console.log("[PROXYLISTENER] Enviando mensaje tipo:", messageType)

    // Variable para capturar la respuesta de WhatsApp
    let whatsappResponse = null

    // Enviar el mensaje según el tipo
    if (messageType === "text") {
      // Enviar mensaje de texto normal
      whatsappResponse = await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, destinationPhone, Body)
    } else {
      // Enviar mensaje de plantilla
      whatsappResponse = await sendWhatsAppTemplate(
        config.phoneNumberId,
        config.accessToken,
        destinationPhone,
        Body,
        config.wabaId,
      )

      // NUEVO: Notificar a OpenAI sobre la plantilla enviada con información detallada
      if (messageType === "template") {
        try {
          console.log("[PROXYLISTENER] Analizando plantilla enviada para notificar a OpenAI...")

          // Obtener o crear thread para este usuario
          const threadResult = await getThreadForUser(cleanPhoneNumber, config.id)
          console.log("[PROXYLISTENER] Thread obtenido:", threadResult.threadId)

          // Analizar la plantilla para extraer información básica
          const templateAnalysis = {
            name: "plantilla_desconocida",
            content: "Plantilla enviada",
          }

          try {
            const templateData = typeof Body === "string" ? JSON.parse(Body) : Body
            console.log("[PROXYLISTENER] Datos de plantilla parseados:", JSON.stringify(templateData, null, 2))

            // Extraer nombre de la plantilla
            if (templateData.template && templateData.template.name) {
              templateAnalysis.name = templateData.template.name
            } else if (templateData.name) {
              templateAnalysis.name = templateData.name
            }

            // Extraer contenido básico si está disponible
            if (templateData.template && templateData.template.components) {
              const components = templateData.template.components
              let textContent = ""

              for (const component of components) {
                if (component.type === "body" && component.parameters) {
                  // Construir contenido básico con los parámetros
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
            console.log("[PROXYLISTENER] Body recibido:", Body)
          }

          // Crear mensaje de notificación simplificado para OpenAI
          const notificationMessage = `[SISTEMA_PLANTILLA]
Plantilla_Nombre: ${templateAnalysis.name}
Plantilla_Contenido: ${templateAnalysis.content}
[/SISTEMA_PLANTILLA]`

          // Enviar notificación a OpenAI
          const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
          })

          await openai.beta.threads.messages.create(threadResult.threadId, {
            role: "user",
            content: notificationMessage,
          })

          console.log("[PROXYLISTENER] Notificación detallada enviada a OpenAI exitosamente")
          console.log("[PROXYLISTENER] Contenido de notificación:", notificationMessage)
        } catch (error) {
          console.error("[PROXYLISTENER] Error al notificar a OpenAI:", error)
          // No fallar el envío de la plantilla por este error
        }
      }
    }

    console.log("[PROXYLISTENER] Respuesta de WhatsApp:", whatsappResponse)

    // Devolver la respuesta exacta de WhatsApp
    return NextResponse.json(whatsappResponse)
  } catch (error) {
    console.error("[PROXYLISTENER] Error al enviar mensaje:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al enviar mensaje",
      },
      { status: 500 },
    )
  }
}
