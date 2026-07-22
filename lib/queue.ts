import { Client } from "@upstash/qstash"
import { logger } from "./logger"

let qstashClient: Client | null = null

export function getQStashClient() {
  if (qstashClient) return qstashClient

  const token = process.env.QSTASH_TOKEN
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

  if (!token) {
    logger.warn("QUEUE", "QStash token no configurado")
    return null
  }

  if (!currentSigningKey || !nextSigningKey) {
    logger.warn("QUEUE", "QStash signing keys no configuradas")
    return null
  }

  try {
    qstashClient = new Client({ token })
    return qstashClient
  } catch (error) {
    logger.error("QUEUE", "Error inicializando QStash", error)
    return null
  }
}

export async function enqueueMessage(messageData: any): Promise<{ messageId: string | null; success: boolean }> {
  const client = getQStashClient()
  if (!client) {
    logger.error("QUEUE", "Cliente QStash no disponible")
    return { messageId: null, success: false }
  }

  try {
    const baseUrl = "https://treelan-bot.vercel.app"

    logger.debug("QUEUE", `Encolando mensaje`)

    const response = await client.publishJSON({
      url: `${baseUrl}/api/process-message`,
      body: messageData,
      retries: Number(process.env.MAX_RETRIES || 3),
      delay: Number(process.env.QSTASH_DELAY || 0),
    })

    logger.info("QUEUE", `Mensaje encolado ✓: ${response.messageId}`)
    return { messageId: response.messageId, success: true }
  } catch (error) {
    logger.error("QUEUE", "Error encolando mensaje", error)
    return { messageId: null, success: false }
  }
}

/**
 * Publica un mensaje para ser entregado en un instante futuro EXACTO (notBefore,
 * timestamp unix en segundos, UTC). A diferencia de enqueueMessage (pensado para
 * procesamiento casi inmediato), esto se usa para programar recordatorios de
 * turno con horario preciso (ej: recordatorio 24hs antes del turno).
 *
 * Se usa publish con notBefore (no "Schedules"/cron): cada recordatorio es un
 * evento único, y así solo se paga por mensaje entregado, sin el costo
 * adicional de mantener un schedule activo.
 */
export async function scheduleMessage(
  url: string,
  body: any,
  notBeforeUnix: number,
): Promise<{ messageId: string | null; success: boolean }> {
  const client = getQStashClient()
  if (!client) {
    logger.error("QUEUE", "Cliente QStash no disponible para scheduleMessage")
    return { messageId: null, success: false }
  }

  try {
    const response = await client.publishJSON({
      url,
      body,
      notBefore: notBeforeUnix,
      retries: Number(process.env.MAX_RETRIES || 3),
    })

    logger.info(
      "QUEUE",
      `Mensaje programado ✓: ${response.messageId} (notBefore: ${new Date(notBeforeUnix * 1000).toISOString()})`,
    )
    return { messageId: response.messageId, success: true }
  } catch (error) {
    logger.error("QUEUE", "Error programando mensaje", error)
    return { messageId: null, success: false }
  }
}

/**
 * Cancela mensajes de QStash aún no entregados.
 *
 * Nota (22/7/2026): la versión instalada del SDK (@upstash/qstash@2.8.4) no
 * tiene `messages.cancel()` (eso es de una versión más nueva del paquete) —
 * solo `messages.delete(messageId)`, que toma UN id a la vez. Se dispara en
 * paralelo con Promise.allSettled para no perder tiempo esperando cada uno
 * en secuencia. Si un mensaje ya fue entregado o no existe más, QStash
 * rechaza esa promesa puntual pero no afecta al resto del batch.
 */
export async function cancelQStashMessages(messageIds: string[]): Promise<boolean> {
  if (messageIds.length === 0) return true

  const client = getQStashClient()
  if (!client) {
    logger.warn("QUEUE", "Cliente QStash no disponible, no se pueden cancelar mensajes")
    return false
  }

  const results = await Promise.allSettled(messageIds.map((id) => client.messages.delete(id)))

  const fallidos = results.filter((r) => r.status === "rejected")
  const exitosos = results.length - fallidos.length

  if (fallidos.length > 0) {
    logger.warn(
      "QUEUE",
      `Cancelados ${exitosos}/${messageIds.length} mensaje(s) de QStash (${fallidos.length} ya entregados o inexistentes)`,
    )
  } else {
    logger.info("QUEUE", `Cancelados ${exitosos} mensaje(s) de QStash`)
  }

  // Éxito si al menos se pudo cancelar alguno, o si todos los fallos son
  // "esperables" (mensaje ya entregado) — no bloqueamos el flujo por esto.
  return true
}
