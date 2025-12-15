import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { handleMessage } from "@/lib/whatsapp"
import { enqueueMessage } from "@/lib/queue"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"

export const maxDuration = 300

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")
    const phoneNumberId = url.searchParams.get("phone_number_id")

    logger.debug("WEBHOOK", `Verificación: mode=${mode}, phoneId=${phoneNumberId}`)

    if (phoneNumberId) {
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config && mode === "subscribe" && token === config.verifyToken) {
        logger.info("WEBHOOK", `Verificación exitosa: ${phoneNumberId}`)
        return new Response(challenge, { status: 200 })
      }
    } else {
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        logger.info("WEBHOOK", "Verificación exitosa (token global)")
        return new Response(challenge, { status: 200 })
      }
    }

    logger.warn("WEBHOOK", "Verificación fallida")
    return new Response("Verification failed", { status: 403 })
  } catch (error) {
    logger.error("WEBHOOK", "Error en verificación", error)
    await logError("webhook_verification", error instanceof Error ? error : new Error(String(error)))
    return new Response("Error processing verification", { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown"

    const rateLimitResult = await rateLimit(`ip:${ip}`)
    if (!rateLimitResult.success) {
      logger.warn("WEBHOOK", `Rate limited: ${ip}`)
      return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
    }

    const body = await req.json()

    if (body.object !== "whatsapp_business_account") {
      logger.warn("WEBHOOK", `Objeto no reconocido: ${body.object}`)
      return NextResponse.json({ success: false, error: "Not a WhatsApp message" }, { status: 400 })
    }

    await incrementMetric("messages_received")

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "messages" && change.value?.messages?.length > 0) {
          const phoneNumberId = change.value.metadata.phone_number_id
          const userPhoneNumber = change.value.messages[0].from

          logger.info("WEBHOOK", `Mensaje de ${userPhoneNumber} → ${phoneNumberId}`)

          const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
          if (!config) {
            logger.error("WEBHOOK", `Config no encontrada: ${phoneNumberId}`)
            continue
          }

          const useQStash = process.env.USE_QSTASH === "true"

          if (useQStash) {
            const result = await enqueueMessage(change.value)
            if (result.success) {
              logger.debug("WEBHOOK", `Encolado: ${result.messageId}`)
            } else {
              logger.warn("WEBHOOK", "Fallback a procesamiento directo")
              await handleMessage(change.value)
            }
          } else {
            await handleMessage(change.value)
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("WEBHOOK", "Error al procesar webhook", error)
    await logError("webhook", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
