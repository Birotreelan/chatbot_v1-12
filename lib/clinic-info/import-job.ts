/**
 * Orquestación del job de importación (scrape + extracción por IA), 10/7/2026.
 *
 * Se separa de las rutas de API para poder correr el mismo código tanto desde
 * el callback de QStash (async, recomendado) como de forma sincrónica en la
 * misma request si QStash no está configurado (fallback, ver
 * app/api/dashboard/clinic-info/import/route.ts).
 */

import { nanoid } from "nanoid"
import { logger } from "@/lib/logger"
import { getClinicInfoImportJob, saveClinicInfoImportJob } from "@/lib/db"
import type { ClinicInfoImportJob } from "@/lib/types"
import { scrapeUrl, ScrapeError } from "./scraper"
import { extractClinicInfoFromText } from "./extractor"
import { hashContent } from "./context"

export async function createImportJob(clienteId: string, url: string): Promise<ClinicInfoImportJob> {
  const now = new Date().toISOString()
  const job: ClinicInfoImportJob = {
    id: nanoid(),
    clienteId,
    sourceUrl: url,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }
  await saveClinicInfoImportJob(job)
  return job
}

/**
 * Corre el scrape + extracción para un job ya creado, y va guardando el
 * progreso (pending → scraping → extracting → done/error) para que el
 * dashboard pueda mostrar un estado mientras espera.
 */
export async function runImportJob(jobId: string): Promise<ClinicInfoImportJob | null> {
  let job = await getClinicInfoImportJob(jobId)
  if (!job) {
    logger.warn("CLINIC-INFO-IMPORT-JOB", `Job ${jobId} no encontrado (¿expiró el TTL de 1 día?)`)
    return null
  }

  logger.info("CLINIC-INFO-IMPORT-JOB", `Job ${jobId} (cliente ${job.clienteId}): iniciando para ${job.sourceUrl}`)

  try {
    job = { ...job, status: "scraping", updatedAt: new Date().toISOString() }
    await saveClinicInfoImportJob(job)

    const scraped = await scrapeUrl(job.sourceUrl)
    logger.info("CLINIC-INFO-IMPORT-JOB", `Job ${jobId}: scrape OK, ${scraped.text.length} chars extraídos`)

    job = { ...job, status: "extracting", updatedAt: new Date().toISOString() }
    await saveClinicInfoImportJob(job)

    const extracted = await extractClinicInfoFromText(scraped.text)
    logger.info("CLINIC-INFO-IMPORT-JOB", `Job ${jobId}: extracción OK`, {
      camposConDatos: Object.keys(extracted).filter((k) => {
        const v = (extracted as any)[k]
        return Array.isArray(v) ? v.length > 0 : !!v
      }),
    })

    job = {
      ...job,
      status: "done",
      draft: {
        clienteId: job.clienteId,
        ...extracted,
        sourceUrl: scraped.url,
        sourceContentHash: hashContent(scraped.text),
        updatedAt: new Date().toISOString(),
        updatedBy: "import",
      },
      updatedAt: new Date().toISOString(),
    }
    await saveClinicInfoImportJob(job)
    return job
  } catch (error) {
    const message =
      error instanceof ScrapeError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Error desconocido al importar"

    logger.error("CLINIC-INFO-IMPORT-JOB", `Job ${jobId}: falló en fase "${job.status}" — ${message}`, error)

    job = { ...job, status: "error", error: message, updatedAt: new Date().toISOString() }
    await saveClinicInfoImportJob(job)
    return job
  }
}
