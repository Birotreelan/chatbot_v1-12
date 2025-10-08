import { Client } from "@upstash/qstash"

let qstashClient: Client | null = null

// Inicializar el cliente de QStash
function getQStashClient() {
  if (qstashClient) return qstashClient

  const token = process.env.QSTASH_TOKEN
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

  console.log("[QUEUE] Verificando configuración de QStash...")
  console.log("[QUEUE] - Token presente:", !!token)
  console.log("[QUEUE] - Current signing key presente:", !!currentSigningKey)
  console.log("[QUEUE] - Next signing key presente:", !!nextSigningKey)

  if (!token) {
    console.error("[QUEUE] ❌ QStash token no configurado")
    return null
  }

  if (!currentSigningKey || !nextSigningKey) {
    console.error("[QUEUE] ❌ QStash signing keys no configuradas")
    return null
  }

  try {
    qstashClient = new Client({ token })
    console.log("[QUEUE] ✅ Cliente QStash inicializado correctamente")
    return qstashClient
  } catch (error) {
    console.error("[QUEUE] ❌ Error al inicializar QStash:", error)
    return null
  }
}

// Encolar un mensaje para procesamiento asíncrono
export async function enqueueMessage(messageData: any): Promise<{ messageId: string | null; success: boolean }> {
  console.log("[QUEUE] Iniciando encolado de mensaje...")

  const client = getQStashClient()
  if (!client) {
    console.error("[QUEUE] ❌ Cliente QStash no disponible")
    return { messageId: null, success: false }
  }

  try {
    const baseUrl =
      process.env.APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      "https://treelan-bot.vercel.app"

    const targetUrl = `${baseUrl}/api/process-message`
    console.log(`[QUEUE] 📤 Enviando mensaje a: ${targetUrl}`)
    console.log(`[QUEUE] 📦 Datos del mensaje:`, JSON.stringify(messageData, null, 2))

    // Enviar el mensaje a la cola
    const response = await client.publishJSON({
      url: targetUrl,
      body: messageData,
      // Configurar reintentos en caso de fallo
      retries: Number(process.env.MAX_RETRIES || 3),
      // Configurar un delay entre reintentos
      delay: Number(process.env.QSTASH_DELAY || 0),
    })

    console.log(`[QUEUE] ✅ Mensaje encolado exitosamente`)
    console.log(`[QUEUE] - Message ID: ${response.messageId}`)
    console.log(`[QUEUE] - Response:`, JSON.stringify(response, null, 2))

    return { messageId: response.messageId, success: true }
  } catch (error) {
    console.error("[QUEUE] ❌ Error al encolar mensaje:", error)
    if (error instanceof Error) {
      console.error("[QUEUE] - Error message:", error.message)
      console.error("[QUEUE] - Error stack:", error.stack)
    }
    return { messageId: null, success: false }
  }
}
