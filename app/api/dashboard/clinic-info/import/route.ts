import { type NextRequest, NextResponse } from "next/server"
import { Client as QStashClient } from "@upstash/qstash"
import { logger } from "@/lib/logger"
import { createImportJob, runImportJob } from "@/lib/clinic-info/import-job"

export const maxDuration = 60

// Mismo dominio hardcodeado que usa lib/queue.ts para publicar en QStash —
// QStash necesita una URL pública a la que hacer el callback, no puede
// apuntar a localhost/preview.
const PUBLIC_BASE_URL = "https://treelan-bot.vercel.app"

function isQStashConfigured() {
  return !!(process.env.QSTASH_TOKEN && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)
}

/**
 * Dispara una importación de info institucional desde una URL.
 *
 * Si QStash está configurado, encola el trabajo (scrape + extracción por IA)
 * y responde enseguida con el job en estado "pending" — el dashboard hace
 * polling a /api/dashboard/clinic-info/import/[jobId] hasta que termine.
 * Si QStash no está disponible (ej. entorno de desarrollo sin esas env vars),
 * corre el trabajo en la misma request como fallback — el scrape + extracción
 * de una sola página tarda unos segundos, entra cómodo en el timeout.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clienteId, url } = body

    if (!clienteId || !url) {
      return NextResponse.json({ success: false, error: "clienteId y url son requeridos" }, { status: 400 })
    }

    const job = await createImportJob(clienteId, url)

    if (isQStashConfigured()) {
      try {
        const client = new QStashClient({ token: process.env.QSTASH_TOKEN! })
        await client.publishJSON({
          url: `${PUBLIC_BASE_URL}/api/dashboard/clinic-info/import/process`,
          body: { jobId: job.id },
          retries: 1,
        })
        return NextResponse.json({ success: true, job })
      } catch (error) {
        logger.warn("CLINIC-INFO-IMPORT", "Error encolando en QStash, se procesa en la misma request", error)
      }
    }

    // Fallback síncrono (QStash no configurado, o falló el encolado).
    const finished = await runImportJob(job.id)
    return NextResponse.json({ success: true, job: finished || job })
  } catch (error) {
    logger.error("CLINIC-INFO-IMPORT", "Error iniciando importación", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
