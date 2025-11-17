import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getAllWhatsAppConfigs } from "@/lib/db"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getRedisClient } from "@/lib/redis"
import OpenAI from "openai"
import { saveConversationMessage } from "@/lib/conversations"
import { nanoid } from "nanoid"
import { normalizePhoneNumber } from "@/lib/utils"

export async function POST(request: Request) {
  try {
    // Obtener los parámetros de la solicitud
    const data = await request.json()
    const { Cliente_Id, Phone_Number_Id, Telefono, Body, Template_Name, Has_Buttons, Button_Options } = data

    // Validar que se proporcionaron los parámetros necesarios
    if (!Cliente_Id) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Cliente_Id" }, { status: 400 })
    }

    if (!Body) {
      return NextResponse.json({ success: false, error: "Se requiere el parámetro Body" }, { status: 400 })
    }

    if (!Telefono) {
      console.error("[SEND-TEMPLATE] ❌ ERROR CRÍTICO: No se proporcionó el parámetro Telefono")
      console.error("[SEND-TEMPLATE] Este es un error de configuración del sistema externo")
      return NextResponse.json(
        {
          success: false,
          error: "TELEFONO_REQUIRED",
          message:
            "El parámetro 'Telefono' es obligatorio. No se puede enviar mensaje sin número de teléfono explícito.",
          details:
            "Este error previene el envío de mensajes al contacto incorrecto. Verifica la configuración del sistema que envía plantillas.",
        },
        { status: 400 },
      )
    }

    if (!Phone_Number_Id && !Telefono) {
      return NextResponse.json(
        { success: false, error: "Se requiere al menos uno de los parámetros: Phone_Number_Id o Telefono" },
        { status: 400 },
      )
    }

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

    // Verificar que la configuración esté activa
    if (!config.active) {
      return NextResponse.json(
        { success: false, error: "La configuración de WhatsApp no está activa" },
        { status: 400 },
      )
    }

    // NUNCA usar lastUserPhoneNumber como fallback
    const destinationPhone = Telefono.startsWith("+") ? Telefono : `+${Telefono}`

    console.log("[SEND-TEMPLATE] ✅ Número de teléfono validado:", destinationPhone)
    console.log("[SEND-TEMPLATE] ✅ Origen del número: Parámetro 'Telefono' (explícito)")

    const cleanPhoneNumber = normalizePhoneNumber(destinationPhone)
    
    console.log("[SEND-TEMPLATE] 📤 ===== RASTREO DE ENVÍO =====")
    console.log("[SEND-TEMPLATE] Destinatario normalizado:", cleanPhoneNumber)
    console.log("[SEND-TEMPLATE] Destinatario con formato:", destinationPhone)
    console.log("[SEND-TEMPLATE] Config ID:", config.id)
    console.log("[SEND-TEMPLATE] Phone Number ID:", config.phoneNumberId)
    console.log("[SEND-TEMPLATE] Cliente ID:", Cliente_Id)
    console.log("[SEND-TEMPLATE] Template Name:", Template_Name || "N/A")
    console.log("[SEND-TEMPLATE] Timestamp:", new Date().toISOString())
    console.log("[SEND-TEMPLATE] ================================")

    // Enviar el mensaje a través de la API de WhatsApp
    await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, destinationPhone, Body)

    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: Body,
      timestamp: new Date().toISOString(),
      phoneNumber: cleanPhoneNumber,
      configId: config.id,
      messageType: Template_Name ? "template" : "text",
    })
    console.log("[SEND-TEMPLATE] ✅ Mensaje guardado en Redis para monitoreo")

    // Notificar al thread de OpenAI sobre la plantilla enviada
    await notifyOpenAIAboutTemplate({
      userPhoneNumber: destinationPhone,
      configId: config.id,
      templateName: Template_Name || "plantilla_generica",
      templateBody: Body,
      hasButtons: Has_Buttons === true || Has_Buttons === "true",
      buttonOptions: Button_Options || [],
    })

    // Devolver una respuesta exitosa
    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
      details: {
        phoneNumberId: config.phoneNumberId,
        destinationPhone,
        messageLength: Body.length,
        templateNotified: true,
        savedToRedis: true,
      },
    })
  } catch (error) {
    console.error("Error al enviar mensaje de plantilla:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al enviar mensaje",
      },
      { status: 500 },
    )
  }
}

// Función para notificar a OpenAI sobre la plantilla enviada
async function notifyOpenAIAboutTemplate({
  userPhoneNumber,
  configId,
  templateName,
  templateBody,
  hasButtons,
  buttonOptions,
}: {
  userPhoneNumber: string
  configId: string
  templateName: string
  templateBody: string
  hasButtons: boolean
  buttonOptions: string[]
}) {
  try {
    console.log(`[TEMPLATE-NOTIFY] Notificando a OpenAI sobre plantilla enviada a ${userPhoneNumber}`)

    // Obtener el thread ID para este usuario
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.warn("[TEMPLATE-NOTIFY] Redis no disponible, no se puede notificar a OpenAI")
      return
    }

    const threadKey = `thread:${userPhoneNumber}:${configId}`
    const threadData = await redisClient.get(threadKey)

    if (!threadData) {
      console.warn(`[TEMPLATE-NOTIFY] No se encontró thread para usuario ${userPhoneNumber}`)
      return
    }

    const threadInfo = JSON.parse(threadData)
    const threadId = threadInfo.threadId

    console.log(`[TEMPLATE-NOTIFY] Thread encontrado: ${threadId}`)

    // Crear el mensaje de sistema para OpenAI
    let systemMessage = `[SISTEMA_PLANTILLA]
Se ha enviado una plantilla al usuario desde el sistema externo.

Nombre de la plantilla: ${templateName}
Contenido de la plantilla:
"${templateBody}"

Tipo de plantilla: ${hasButtons ? "Plantilla con botones interactivos" : "Plantilla informativa sin botones"}
`

    if (hasButtons && buttonOptions.length > 0) {
      systemMessage += `
Opciones de botones disponibles:
${buttonOptions.map((option, index) => `${index + 1}. ${option}`).join("\n")}

IMPORTANTE: El usuario DEBE responder usando uno de los botones de la plantilla. Si responde con texto libre, debes pedirle que use los botones.
`
    } else {
      systemMessage += `
El usuario puede responder normalmente con texto libre. Responde de manera contextual basándote en el contenido de la plantilla enviada.
`
    }

    systemMessage += `[/SISTEMA_PLANTILLA]`

    console.log(`[TEMPLATE-NOTIFY] Mensaje de sistema preparado:`)
    console.log(systemMessage)

    // Enviar el mensaje al thread de OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: systemMessage,
    })

    console.log(`[TEMPLATE-NOTIFY] Notificación enviada exitosamente al thread ${threadId}`)
  } catch (error) {
    console.error("[TEMPLATE-NOTIFY] Error al notificar a OpenAI sobre la plantilla:", error)
  }
}
