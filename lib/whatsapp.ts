import { saveConversationMessage } from "./db"

// Assuming the rest of the code for lib/whatsapp.ts is here

async function processIndividualMessage(userPhoneNumber, config, userMessage, threadId, userName) {
  // Existing code here

  console.log("[WHATSAPP] Mensaje preparado para OpenAI:", systemMessage)

  // Guardar mensaje del usuario
  await saveConversationMessage(
    userPhoneNumber,
    config.id,
    config.cliente_id,
    userMessage,
    "incoming",
    threadId,
    userName,
  )

  // Existing code here
}

// Assuming the rest of the code for lib/whatsapp.ts is here
