import { OpenAI } from "openai"

const MAX_MESSAGES_PER_THREAD = 5 // Reducido de 10

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface Message {
  role: "system" | "user" | "assistant"
  content: string
}

export async function getThread(userPhoneNumber: string, configId: string) {
  const threadName = `whatsapp-${userPhoneNumber}-${configId}`

  try {
    const threads = await openai.beta.threads.list({
      limit: 10,
      order: "desc",
    })

    for (const thread of threads.data) {
      if (thread.metadata?.name === threadName) {
        return thread
      }
    }

    return await createNewThread(userPhoneNumber, configId)
  } catch (error: any) {
    console.error("Error getting thread:", error)
    throw new Error(error)
  }
}

export async function createNewThread(userPhoneNumber: string, configId: string) {
  const threadName = `whatsapp-${userPhoneNumber}-${configId}`

  try {
    const thread = await openai.beta.threads.create({
      metadata: {
        name: threadName,
      },
    })

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
      return await createNewThread(userPhoneNumber, configId)
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
