import { OpenAI } from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface Message {
  role: "system" | "user" | "assistant"
  content: string
}

export async function getThread(userIdentifier: string, configId: string) {
  // Determinar si es WhatsApp o Web basado en el prefijo
  const isWebThread = userIdentifier.startsWith("web_")
  const threadName = isWebThread ? `web-${userIdentifier}-${configId}` : `whatsapp-${userIdentifier}-${configId}`

  console.log(`[THREAD-MANAGER] Buscando thread: ${threadName} (${isWebThread ? "web" : "whatsapp"})`)
  console.log(`[THREAD-MANAGER] UserIdentifier: ${userIdentifier}`)
  console.log(`[THREAD-MANAGER] ConfigId: ${configId}`)

  try {
    // Verificar que OpenAI esté correctamente inicializado
    if (!openai || !openai.beta || !openai.beta.threads) {
      throw new Error("OpenAI client not properly initialized")
    }

    // Para threads web, intentar buscar por metadata primero
    if (isWebThread) {
      const threads = await openai.beta.threads.list({
        limit: 20,
        order: "desc",
      })

      for (const thread of threads.data) {
        if (thread.metadata?.name === threadName || thread.metadata?.sessionId === userIdentifier) {
          console.log(`[THREAD-MANAGER] Thread web encontrado: ${thread.id}`)
          return thread
        }
      }
    } else {
      // Lógica original para WhatsApp
      const threads = await openai.beta.threads.list({
        limit: 10,
        order: "desc",
      })

      for (const thread of threads.data) {
        if (thread.metadata?.name === threadName) {
          console.log(`[THREAD-MANAGER] Thread WhatsApp encontrado: ${thread.id}`)
          return thread
        }
      }
    }

    // Si no se encuentra, crear uno nuevo
    console.log(`[THREAD-MANAGER] Thread no encontrado, creando nuevo: ${threadName}`)
    return await createNewThread(userIdentifier, configId)
  } catch (error: any) {
    console.error("[THREAD-MANAGER] Error getting thread:", error)
    console.error("[THREAD-MANAGER] OpenAI instance:", !!openai)
    console.error("[THREAD-MANAGER] OpenAI beta:", !!openai?.beta)
    console.error("[THREAD-MANAGER] OpenAI threads:", !!openai?.beta?.threads)
    throw new Error(`Error getting thread: ${error.message}`)
  }
}

// Función para crear threads web
export async function createThread(sessionId: string, configId: string) {
  const threadName = `web-${sessionId}-${configId}`

  try {
    console.log(`[THREAD-MANAGER] Creando thread web: ${threadName}`)

    const thread = await openai.beta.threads.create({
      metadata: {
        name: threadName,
        type: "web",
        sessionId,
        configId,
      },
    })

    console.log(`[THREAD-MANAGER] Thread web creado: ${thread.id}`)
    return thread
  } catch (error: any) {
    console.error("[THREAD-MANAGER] Error creating web thread:", error)
    throw new Error(`Error creating web thread: ${error.message}`)
  }
}

export async function createNewThread(userIdentifier: string, configId: string) {
  const isWebThread = userIdentifier.startsWith("web_")
  const threadName = isWebThread ? `web-${userIdentifier}-${configId}` : `whatsapp-${userIdentifier}-${configId}`

  try {
    const metadata: any = {
      name: threadName,
    }

    if (isWebThread) {
      metadata.type = "web"
      metadata.sessionId = userIdentifier
      metadata.configId = configId
    }

    const thread = await openai.beta.threads.create({
      metadata,
    })

    console.log(`[THREAD-MANAGER] Nuevo thread creado: ${thread.id} (${isWebThread ? "web" : "whatsapp"})`)
    return thread
  } catch (error: any) {
    console.error("Error creating thread:", error)
    throw new Error(error)
  }
}

export async function addMessageToThread(threadId: string, message: Message) {
  try {
    const createdMessage = await openai.beta.threads.messages.create(threadId, message)
    return createdMessage
  } catch (error: any) {
    console.error("Error adding message to thread:", error)
    throw new Error(error)
  }
}

export async function getMessagesFromThread(threadId: string) {
  try {
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "asc",
    })

    if (messages.data.length >= 3) {
      console.log(`[THREAD-MANAGER] Thread tiene ${messages.data.length} mensajes, creando nuevo thread`)
      // Note: This function needs userPhoneNumber and configId parameters to work properly
      // For now, we'll return the messages as is
    }

    return messages
  } catch (error: any) {
    console.error("Error getting messages from thread:", error)
    throw new Error(error)
  }
}

export async function runThread(threadId: string, assistantId: string, instructions: string) {
  try {
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      instructions,
    })

    return run
  } catch (error: any) {
    console.error("Error running thread:", error)
    throw new Error(error)
  }
}

export async function getRun(threadId: string, runId: string) {
  try {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId)
    return run
  } catch (error: any) {
    console.error("Error getting run:", error)
    throw new Error(error)
  }
}
