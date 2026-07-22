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
 * Cancela mensajes de QStash aún no entregados, en una sola llamada (bulk).
 * Si un mensaje ya fue entregado o no existe más, QStash lo ignora sin fallar
 * el resto del batch — por eso es seguro llamarlo aunque alguno ya haya salido.
 */
export async function cancelQStashMessages(messageIds: string[]): Promise<boolean> {
  if (messageIds.length === 0) return true

  const client = getQStashClient()
  if (!client) {
    logger.warn("QUEUE", "Cliente QStash no disponible, no se pueden cancelar mensajes")
    return false
  }

  try {
    await client.messages.cancel(messageIds)
    logger.info("QUEUE", `Cancelados ${messageIds.length} mensaje(s) de QStash`)
    return true
  } catch (error) {
    logger.error("QUEUE", "Error cancelando mensajes de QStash", error)
    return false
  }
}
