import { saveConversationMessage, type ConversationMessage } from "./db"
import { nanoid } from "nanoid"

// Assuming the rest of the code for lib/whatsapp.ts is here

async function processIndividualMessage(phoneNumber: string, userMessage: string, config: any, threadId: string) {
  // Existing code here
  console.log(`[WHATSAPP] Mensaje preparado para OpenAI: ${systemMessage}`)

  // Guardar el mensaje entrante
  const incomingMessage: ConversationMessage = {
    id: nanoid(),
    phoneNumber: phoneNumber,
    configId: config.id,
    clienteId: config.cliente_id || "",
    message: userMessage,
    messageType: "incoming",
    timestamp: new Date().toISOString(),
    threadId: threadId,
    userName: phoneNumber, // Se puede mejorar con el nombre del contacto
    isFromUser: true,
  }

  try {
    await saveConversationMessage(incomingMessage)
  } catch (error) {
    console.error("[WHATSAPP] Error guardando mensaje entrante:", error)
  }

  // Existing code here
}

// Assuming the rest of the code for lib/whatsapp.ts is here
