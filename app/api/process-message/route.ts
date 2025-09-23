import { NextResponse } from "next/server"
import { processWhatsAppMessage } from "@/lib/whatsapp-processor"
import { logError, incrementMetric } from "@/lib/monitoring"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"

// Permitir que la función se ejecute durante más tiempo
export const maxDuration = 60

// Función para procesar mensajes
async function processMessage(req: Request) {
  console.log("[PROCESS-MESSAGE] Iniciando procesamiento de mensaje")

  try {
    // Obtener el cuerpo de la solicitud
    const body = await req.json()
    console.log("[PROCESS-MESSAGE] Datos recibidos:", JSON.stringify(body, null, 2))

    // Incrementar métrica de mensajes procesados
    await incrementMetric("messages_processed_async")

    if (!body.messages || !body.messages[0]) {
      throw new Error("No message data found")
    }

    const message = body.messages[0]
    const phoneNumber = message.from
    const messageText = message.text?.body || ""

    const phoneNumberId = body.metadata?.phone_number_id

    if (!phoneNumberId) {
      throw new Error("Phone number ID not found in webhook data")
    }

    console.log(`[PROCESS-MESSAGE] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)

    if (!config) {
      throw new Error(`WhatsApp configuration not found for phoneNumberId: ${phoneNumberId}`)
    }

    console.log(`[PROCESS-MESSAGE] Configuración encontrada: ${config.displayName} (${config.id})`)

    // Process the message with correct parameters
    const response = await processWhatsAppMessage({
      message: messageText,
      phoneNumber: phoneNumber,
      config: config,
    })

    console.log("[PROCESS-MESSAGE] Mensaje procesado exitosamente")
    return NextResponse.json({ success: true, response })
  } catch (error) {
    console.error("[PROCESS-MESSAGE] Error al procesar mensaje:", error)
    await logError("process_message", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}

// Función para verificar si QStash está configurado
function isQStashConfigured() {
  return !!(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
}

// Exportar la función POST
export async function POST(req: Request) {
  console.log("[PROCESS-MESSAGE] Recibida solicitud POST")

  // Si QStash está configurado, intentar verificar la firma
  if (isQStashConfigured() && process.env.VERCEL_ENV === "production") {
    try {
      console.log("[PROCESS-MESSAGE] Verificando firma QStash...")

      // Importar dinámicamente la función de verificación
      const { verifySignature } = await import("@upstash/qstash/nextjs")

      // Obtener los headers necesarios
      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      if (!signature || !timestamp) {
        console.log("[PROCESS-MESSAGE] Headers de QStash faltantes, procesando sin verificación")
        return processMessage(req)
      }

      // Verificar la firma manualmente
      const body = await req.text()
      const isValid = await verifySignature({
        signature,
        body,
        timestamp,
        signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
      })

      if (!isValid) {
        console.error("[PROCESS-MESSAGE] Firma QStash inválida")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      console.log("[PROCESS-MESSAGE] Firma verificada exitosamente")

      // Recrear el request con el body parseado
      const newReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: body,
      })

      return processMessage(newReq)
    } catch (error) {
      console.error("[PROCESS-MESSAGE] Error al verificar firma QStash:", error)
      console.log("[PROCESS-MESSAGE] Procesando mensaje sin verificación como fallback")
      return processMessage(req)
    }
  } else {
    console.log("[PROCESS-MESSAGE] Procesando mensaje sin verificación de firma")
    return processMessage(req)
  }
}
