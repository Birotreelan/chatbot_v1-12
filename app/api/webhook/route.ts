import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { handleMessage } from "@/lib/whatsapp"
import { enqueueMessage } from "@/lib/queue"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"

export const maxDuration = 60

// Manejar la verificación del webhook (GET)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")
    const phoneNumberId = url.searchParams.get("phone_number_id")

    console.log(
      `[WEBHOOK] Verificación recibida: mode=${mode}, token=${token?.substring(0, 3)}***, phoneNumberId=${phoneNumberId}`,
    )

    // Si se proporciona un phoneNumberId, verificar con la configuración específica
    if (phoneNumberId) {
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config && mode === "subscribe" && token === config.verifyToken) {
        console.log(`[WEBHOOK] Verificación exitosa para phoneNumberId=${phoneNumberId}`)
        return new Response(challenge, { status: 200 })
      }
    } else {
      // Si no se proporciona phoneNumberId, verificar con el token global
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log(`[WEBHOOK] Verificación exitosa con token global`)
        return new Response(challenge, { status: 200 })
      }
    }

    console.log(`[WEBHOOK] Verificación fallida`)
    return new Response("Verification failed", { status: 403 })
  } catch (error) {
    console.error("[WEBHOOK] Error en verificación:", error)
    await logError("webhook_verification", error instanceof Error ? error : new Error(String(error)))
    return new Response("Error processing verification", { status: 500 })
  }
}

// Manejar los mensajes entrantes (POST)
export async function POST(req: Request) {
  console.log("[WEBHOOK] Recibida solicitud POST")

  try {
    // Obtener la IP del cliente
    const ip = req.headers.get("x-forwarded-for") || "unknown"
    console.log(`[WEBHOOK] IP del cliente: ${ip}`)

    // Aplicar rate limiting, pero permitir IPs de Meta/WhatsApp
    const rateLimitResult = await rateLimit(`ip:${ip}`)
    if (!rateLimitResult.success) {
      console.warn(`[WEBHOOK] Solicitud limitada por tasa para IP: ${ip}`)
      return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
    }

    // Procesar el cuerpo de la solicitud
    const body = await req.json()
    console.log(`[WEBHOOK] Objeto recibido: ${body.object}`)

    // Verificar si es un mensaje de WhatsApp
    if (body.object !== "whatsapp_business_account") {
      console.warn(`[WEBHOOK] Objeto no reconocido: ${body.object}`)
      return NextResponse.json({ success: false, error: "Not a WhatsApp message" }, { status: 400 })
    }

    // Incrementar métrica de mensajes recibidos
    await incrementMetric("messages_received")

    // Esto evita el timeout de 60 segundos

    // Procesar cada entrada y cambio de forma asíncrona
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "messages" && change.value && change.value.messages && change.value.messages.length > 0) {
          const phoneNumberId = change.value.metadata.phone_number_id
          const userPhoneNumber = change.value.messages[0].from

          console.log(`[WEBHOOK] Mensaje recibido de ${userPhoneNumber} para phoneNumberId=${phoneNumberId}`)

          // Obtener la configuración de WhatsApp
          const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
          if (!config) {
            console.error(`[WEBHOOK] Configuración no encontrada para phoneNumberId=${phoneNumberId}`)
            continue
          }

          // Usar Promise.resolve().then() para ejecutar después de responder
          Promise.resolve().then(async () => {
            try {
              console.log(`[WEBHOOK-BG] Iniciando procesamiento en background para ${userPhoneNumber}`)

              // Determinar si debemos usar QStash o procesar directamente
              const useQStash = process.env.USE_QSTASH === "true"
              console.log(`[WEBHOOK-BG] Usando QStash: ${useQStash}`)

              if (useQStash) {
                // Encolar el mensaje para procesamiento asíncrono
                console.log(`[WEBHOOK-BG] Encolando mensaje para procesamiento asíncrono`)
                try {
                  const result = await enqueueMessage(change.value)
                  if (result.success && result.messageId) {
                    console.log(`[WEBHOOK-BG] Mensaje encolado con ID: ${result.messageId}`)
                  } else {
                    console.error(`[WEBHOOK-BG] Error al encolar mensaje, procesando directamente como fallback`)
                    await handleMessage(change.value)
                  }
                } catch (error) {
                  console.error(`[WEBHOOK-BG] Error al encolar mensaje:`, error)
                  // Si falla el encolamiento, procesar de forma directa como fallback
                  console.log(`[WEBHOOK-BG] Procesando mensaje directamente como fallback`)
                  await handleMessage(change.value)
                }
              } else {
                // Procesar el mensaje directamente
                console.log(`[WEBHOOK-BG] Procesando mensaje directamente`)
                await handleMessage(change.value)
              }

              console.log(`[WEBHOOK-BG] Procesamiento completado para ${userPhoneNumber}`)
            } catch (error) {
              console.error(`[WEBHOOK-BG] Error en procesamiento background:`, error)
              await logError("webhook_background", error instanceof Error ? error : new Error(String(error)))
            }
          })
        }
      }
    }

    console.log("[WEBHOOK] Respondiendo inmediatamente con 200 OK")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[WEBHOOK] Error al procesar webhook:", error)
    await logError("webhook", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
