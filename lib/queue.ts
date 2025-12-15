import { Client } from "@upstash/qstash"
import { logger } from "./logger"

let qstashClient: Client | null = null

function getQStashClient() {
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
