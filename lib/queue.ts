import { Client } from "@upstash/qstash"

let qstashClient: Client | null = null

// Inicializar el cliente de QStash
function getQStashClient() {
  if (qstashClient) return qstashClient

  const token = process.env.QSTASH_TOKEN
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

  if (!token) {
    console.warn("QStash token no configurado")
    return null
  }

  if (!currentSigningKey || !nextSigningKey) {
    console.warn("QStash signing keys no configuradas")
    return null
  }

  try {
    qstashClient = new Client({ token })
    return qstashClient
  } catch (error) {
    console.error("Error al inicializar QStash:", error)
    return null
  }
}

// Encolar un mensaje para procesamiento asíncrono
export async function enqueueMessage(messageData: any): Promise<{ messageId: string | null; success: boolean }> {
  const client = getQStashClient()
  if (!client) {
    console.error("[QUEUE] Cliente QStash no disponible")
    return { messageId: null, success: false }
  }

  try {
    // Usar explícitamente la URL de producción
    const baseUrl = "https://treelan-bot.vercel.app"

    console.log(`[QUEUE] Enviando mensaje a: ${baseUrl}/api/process-message`)

    // Enviar el mensaje a la cola
    const response = await client.publishJSON({
      url: `${baseUrl}/api/process-message`,
      body: messageData,
      // Configurar reintentos en caso de fallo
      retries: Number(process.env.MAX_RETRIES || 3),
      // Configurar un delay entre reintentos
      delay: Number(process.env.QSTASH_DELAY || 0),
    })

    console.log(`[QUEUE] Mensaje encolado exitosamente con ID: ${response.messageId}`)
    return { messageId: response.messageId, success: true }
  } catch (error) {
    console.error("[QUEUE] Error al encolar mensaje:", error)
    return { messageId: null, success: false }
  }
}
