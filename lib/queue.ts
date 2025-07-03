import { Client } from "@upstash/qstash"

const qstash = new Client({
  token: process.env.QSTASH_TOKEN!,
})

export async function enqueueMessage(messageData: any) {
  try {
    const targetUrl = `${process.env.APP_URL || process.env.VERCEL_URL}/api/process-message`

    const delay = process.env.QSTASH_DELAY ? Number.parseInt(process.env.QSTASH_DELAY, 10) : 0

    const result = await qstash.publishJSON({
      url: targetUrl,
      body: messageData,
      delay: delay,
    })

    return {
      success: true,
      messageId: result.messageId,
    }
  } catch (error) {
    console.error("[QUEUE] Error encolando mensaje:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

export async function getQueueStatus() {
  try {
    // QStash no tiene una API directa para obtener el estado de la cola
    // Pero podemos devolver información básica
    return {
      success: true,
      status: "operational",
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error("[QUEUE] Error obteniendo estado de cola:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}
