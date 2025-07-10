import { NextResponse } from "next/server"
import { handleMessage } from "@/lib/whatsapp"
import { logError, incrementMetric } from "@/lib/monitoring"

export const maxDuration = 60

async function processMessage(req: Request) {
  console.log(`[MSG] 📨 Procesando mensaje`)

  try {
    const body = await req.json()
    await incrementMetric("messages_processed_async")
    await handleMessage(body)

    console.log(`[MSG] ✅ Mensaje procesado`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(`[MSG] ❌ Error:`, error)
    await logError("process_message", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}

function isQStashConfigured() {
  return !!(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
}

export async function POST(req: Request) {
  console.log(`[MSG] 📥 POST recibido`)

  if (isQStashConfigured() && process.env.VERCEL_ENV === "production") {
    try {
      console.log(`[MSG] 🔐 Verificando QStash`)

      const { verifySignature } = await import("@upstash/qstash/nextjs")

      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      if (!signature || !timestamp) {
        console.log(`[MSG] ⚠️ Sin headers QStash`)
        return processMessage(req)
      }

      const body = await req.text()
      const isValid = await verifySignature({
        signature,
        body,
        timestamp,
        signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
      })

      if (!isValid) {
        console.error(`[MSG] ❌ Firma QStash inválida`)
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      console.log(`[MSG] ✅ Firma verificada`)

      const newReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: body,
      })

      return processMessage(newReq)
    } catch (error) {
      console.error(`[MSG] ❌ Error QStash:`, error)
      console.log(`[MSG] 🔄 Fallback sin verificación`)
      return processMessage(req)
    }
  } else {
    console.log(`[MSG] 🔄 Sin verificación QStash`)
    return processMessage(req)
  }
}
