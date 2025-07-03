import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { handleMessage } from "@/lib/whatsapp"
import { enqueueMessage } from "@/lib/queue"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"

export const maxDuration = 60

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")
    const phoneNumberId = url.searchParams.get("phone_number_id")

    if (phoneNumberId) {
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config && mode === "subscribe" && token === config.verifyToken) {
        console.log(`[WEBHOOK] ✅ Verificación exitosa: ${phoneNumberId.slice(-4)}`)
        return new Response(challenge, { status: 200 })
      }
    } else {
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log(`[WEBHOOK] ✅ Verificación global exitosa`)
        return new Response(challenge, { status: 200 })
      }
    }

    console.log(`[WEBHOOK] ❌ Verificación fallida`)
    return new Response("Verification failed", { status: 403 })
  } catch (error) {
    console.error("[WEBHOOK] ❌ Error verificación:", error.message)
    await logError("webhook_verification", error instanceof Error ? error : new Error(String(error)))
    return new Response("Error processing verification", { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown"

    const rateLimitResult = await rateLimit(`ip:${ip}`)
    if (!rateLimitResult.success) {
      return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
    }

    const body = await req.json()

    if (body.object !== "whatsapp_business_account") {
      return NextResponse.json({ success: false, error: "Not a WhatsApp message" }, { status: 400 })
    }

    await incrementMetric("messages_received")

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "messages" && change.value && change.value.messages && change.value.messages.length > 0) {
          const phoneNumberId = change.value.metadata.phone_number_id
          const userPhoneNumber = change.value.messages[0].from

          console.log(`[WEBHOOK] 📱 Mensaje de ${userPhoneNumber.slice(-4)} para ${phoneNumberId.slice(-4)}`)

          const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
          if (!config) {
            console.error(`[WEBHOOK] ❌ Config no encontrada: ${phoneNumberId.slice(-4)}`)
            continue
          }

          const useQStash = process.env.USE_QSTASH === "true"

          if (useQStash) {
            try {
              const result = await enqueueMessage(change.value)
              if (result.success && result.messageId) {
                console.log(`[WEBHOOK] ✅ Mensaje encolado: ${result.messageId.slice(-8)}`)
              } else {
                await handleMessage(change.value)
              }
            } catch (error) {
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
    console.error("[WEBHOOK] ❌ Error:", error.message)
    await logError("webhook", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
