import { saveConversationMessage } from "./db"

// Assuming the rest of the code is here and getAssistantResponse function is defined
async function getAssistantResponse(phoneNumber: string, config: any, response: string, threadId: string) {
  console.log("[OPENAI] 📱 Enviado a WhatsApp")

  // Guardar respuesta del bot
  if (config?.id && config?.cliente_id) {
    await saveConversationMessage(phoneNumber, config.id, config.cliente_id, response, "outgoing", threadId)
  }

  // The rest of the code here
}
