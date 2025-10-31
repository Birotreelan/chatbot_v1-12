import { OpenAI } from "openai"
import { getRedisClient } from "./redis"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface Message {
  role: "system" | "user" | "assistant"
  content: string
}

export async function getThread(userIdentifier: string, configId: string) {
  const isWebThread = userIdentifier.startsWith("web_")
  const threadName = isWebThread ? `web-${userIdentifier}-${configId}` : `whatsapp-${userIdentifier}-${configId}`
  const cacheKey = `thread:${threadName}`

  console.log(`[THREAD-MANAGER] Buscando thread: ${threadName} (${isWebThread ? "web" : "whatsapp"})`)
  console.log(`[THREAD-MANAGER] UserIdentifier: ${userIdentifier}`)
  console.log(`[THREAD-MANAGER] ConfigId: ${configId}`)

  try {
    // Verificar que OpenAI esté correctamente inicializado
    if (!openai || !openai.beta || !openai.beta.threads) {
      throw new Error("OpenAI client not properly initialized")
    }

    // Intentar obtener el thread ID desde Redis
    const redis = getRedisClient()
    const cachedThreadId = await redis.get(cacheKey)

    if (cachedThreadId) {
      console.log(`[THREAD-MANAGER] Thread encontrado en caché: ${cachedThreadId}`)
      try {
        // Verificar que el thread aún existe en OpenAI
        const thread = await openai.beta.threads.retrieve(cachedThreadId)
        console.log(`[THREAD-MANAGER] Thread verificado en OpenAI: ${thread.id}`)
        return thread
      } catch (error) {
        console.log(`[THREAD-MANAGER] Thread en caché no existe en OpenAI, creando nuevo`)
        // Si el thread no existe, eliminar de caché y crear uno nuevo
        await redis.del(cacheKey)
      }
    }

    // Si no se encuentra en caché, crear uno nuevo
    console.log(`[THREAD-MANAGER] Thread no encontrado, creando nuevo: ${threadName}`)
    const newThread = await createNewThread(userIdentifier, configId)

    // Guardar en caché (expira en 30 días)
    await redis.set(cacheKey, newThread.id, { ex: 30 * 24 * 60 * 60 })

    return newThread
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
  const cacheKey = `thread:${threadName}`

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

    // Guardar en caché
    const redis = getRedisClient()
    await redis.set(cacheKey, thread.id, { ex: 30 * 24 * 60 * 60 })

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

export async function safelyAddMessageToThread(
  threadId: string,
  message: Message,
  maxRetries = 5,
  retryDelay = 2000,
): Promise<any> {
  if (!threadId) {
    throw new Error("[THREAD-MANAGER] threadId is required but was undefined")
  }

  console.log(`[THREAD-MANAGER] 🔍 Iniciando safelyAddMessageToThread para thread: ${threadId}`)

  let attempts = 0

  while (attempts < maxRetries) {
    try {
      // Check if there are any active runs on this thread
      console.log(`[THREAD-MANAGER] 🔎 Verificando runs activos en thread ${threadId}`)
      const runs = await openai.beta.threads.runs.list(threadId, {
        limit: 10,
        order: "desc",
      })

      // Find any active or in-progress runs
      const activeRun = runs.data.find(
        (run) =>
          run.status === "in_progress" ||
          run.status === "queued" ||
          run.status === "requires_action" ||
          run.status === "cancelling",
      )

      if (activeRun) {
        console.log(
          `[THREAD-MANAGER] ⚠️ Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando...`,
        )

        // Wait for the run to complete
        let runStatus = activeRun.status
        let waitAttempts = 0
        const maxWaitAttempts = 30 // 30 seconds max wait

        while (
          (runStatus === "in_progress" ||
            runStatus === "queued" ||
            runStatus === "requires_action" ||
            runStatus === "cancelling") &&
          waitAttempts < maxWaitAttempts
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1000))

          console.log(`[THREAD-MANAGER] 🔄 Recuperando estado del run. ThreadId: ${threadId}, RunId: ${activeRun.id}`)

          if (!threadId || !activeRun.id) {
            throw new Error(`[THREAD-MANAGER] Parámetros inválidos - threadId: ${threadId}, runId: ${activeRun.id}`)
          }

          const updatedRun = await openai.beta.threads.runs.retrieve(threadId, activeRun.id)
          runStatus = updatedRun.status
          waitAttempts++
          console.log(
            `[THREAD-MANAGER] 🔄 Esperando run ${activeRun.id} (estado: ${runStatus}, intento ${waitAttempts}/${maxWaitAttempts})`,
          )
        }

        // If still active after max wait, try to cancel it
        if (
          runStatus === "in_progress" ||
          runStatus === "queued" ||
          runStatus === "requires_action" ||
          runStatus === "cancelling"
        ) {
          console.log(`[THREAD-MANAGER] ⏱️ Timeout esperando run. Intentando cancelar...`)
          try {
            await openai.beta.threads.runs.cancel(threadId, activeRun.id)
            console.log(`[THREAD-MANAGER] ✅ Run cancelado exitosamente`)
            // Wait a bit for cancellation to complete
            await new Promise((resolve) => setTimeout(resolve, 2000))
          } catch (cancelError: any) {
            console.error(`[THREAD-MANAGER] ❌ Error al cancelar run:`, cancelError.message)
          }
        } else {
          console.log(`[THREAD-MANAGER] ✅ Run completado con estado: ${runStatus}`)
        }
      } else {
        console.log(`[THREAD-MANAGER] ✅ No hay runs activos en el thread`)
      }

      // Now try to add the message
      console.log(`[THREAD-MANAGER] 📝 Agregando mensaje al thread ${threadId}`)
      const createdMessage = await openai.beta.threads.messages.create(threadId, message)
      console.log(`[THREAD-MANAGER] ✅ Mensaje agregado exitosamente (ID: ${createdMessage.id})`)
      return createdMessage
    } catch (error: any) {
      attempts++
      console.error(
        `[THREAD-MANAGER] ❌ Error agregando mensaje (intento ${attempts}/${maxRetries}):`,
        error.message || error,
      )

      if (error.message?.includes("Path parameters")) {
        console.error(`[THREAD-MANAGER] ❌ Error de parámetros detectado. ThreadId actual: ${threadId}`)
        console.error(`[THREAD-MANAGER] ❌ Tipo de threadId: ${typeof threadId}`)
        console.error(`[THREAD-MANAGER] ❌ ThreadId es undefined: ${threadId === undefined}`)
      }

      // If it's still the "run is active" error and we have retries left, wait and try again
      if (error.message?.includes("while a run") && error.message?.includes("is active") && attempts < maxRetries) {
        console.log(`[THREAD-MANAGER] ⏳ Esperando ${retryDelay}ms antes de reintentar...`)
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      // For other errors or if we're out of retries, throw
      if (attempts >= maxRetries) {
        console.error(`[THREAD-MANAGER] ❌ Se agotaron los ${maxRetries} intentos`)
      }
      throw error
    }
  }

  throw new Error(`No se pudo agregar el mensaje después de ${maxRetries} intentos`)
}

export async function addMessageToThread(threadId: string, message: Message) {
  return safelyAddMessageToThread(threadId, message)
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
