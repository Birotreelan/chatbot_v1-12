import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { runImportJob } from "@/lib/clinic-info/import-job"

export const maxDuration = 60

// OJO: no llamar "process" a esta función — colisiona con el objeto global
// `process` (process.env) de Node, ya que una function declaration queda
// hoisteada al scope del módulo entero y lo taparía en todo el archivo.
async function processImportJobRequest(req: Request) {
  try {
    const body = await req.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json({ success: false, error: "jobId requerido" }, { status: 400 })
    }

    await runImportJob(jobId)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("CLINIC-INFO-IMPORT-PROCESS", "Error procesando job de importación", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}

function isQStashConfigured() {
  return !!(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
}

// Mismo patrón de verificación de firma que app/api/process-message/route.ts.
export async function POST(req: Request) {
  if (isQStashConfigured() && process.env.VERCEL_ENV === "production") {
    try {
      const { verifySignature } = await import("@upstash/qstash/nextjs")
      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      if (!signature || !timestamp) {
        return processImportJobRequest(req)
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
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      const newReq = new Request(req.url, { method: req.method, headers: req.headers, body })
      return processImportJobRequest(newReq)
    } catch (error) {
      logger.warn("CLINIC-INFO-IMPORT-PROCESS", "Error verificando firma QStash, procesando sin verificar", error)
      return processImportJobRequest(req)
    }
  } else {
    return processImportJobRequest(req)
  }
}
