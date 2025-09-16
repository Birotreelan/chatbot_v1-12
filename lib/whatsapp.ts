import { saveConversationMessage } from "./db"

// Assuming the rest of the code is here and processIndividualMessage function exists
async function processIndividualMessage(phoneNumber: string, config: any, userMessage: string, threadId: string) {
  const systemBlock = "System block content" // Placeholder for actual system block content
  console.log(`[WHATSAPP] Mensaje preparado para OpenAI: ${systemBlock} ${userMessage}`)

  // Guardar mensaje del usuario
  await saveConversationMessage(
    phoneNumber,
    config.id,
    config.cliente_id || "",
    userMessage,
    "incoming",
    threadId,
    undefined, // userName se puede obtener del contacto si está disponible
  )

  // Further processing code here
}
