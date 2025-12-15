import { NextResponse } from "next/server"
import { handleMessage } from "@/lib/whatsapp"
import { logError, incrementMetric } from "@/lib/monitoring"
import { logger } from "@/lib/logger"

export const maxDuration = 300

async function processMessage(req: Request) {
  try {
    const body = await req.json()

    logger.debug("PROCESS-MSG", "Procesando mensaje", body)

    await incrementMetric("messages_processed_async")
    await handleMessage(body)

    logger.info("PROCESS-MSG", "Mensaje procesado ✓")
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("PROCESS-MSG", "Error al procesar", error)
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
  if (isQStashConfigured() && process.env.VERCEL_ENV === "production") {
    try {
      const { verifySignature } = await import("@upstash/qstash/nextjs")
      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      if (!signature || !timestamp) {
        logger.debug("PROCESS-MSG", "Sin headers QStash, procesando sin verificación")
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
        logger.error("PROCESS-MSG", "Firma QStash inválida")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      const newReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: body,
      })

      return processMessage(newReq)
    } catch (error) {
      logger.warn("PROCESS-MSG", "Error verificando firma, procesando sin verificación")
      return processMessage(req)
    }
  } else {
    return processMessage(req)
  }
}
