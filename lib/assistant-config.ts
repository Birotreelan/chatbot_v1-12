import OpenAI from "openai"

export async function configureAssistant(): Promise<string> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    // Verificar si existe un ID de asistente
    const assistantId = process.env.OPENAI_ASSISTANT_ID

    if (!assistantId) {
      throw new Error("OPENAI_ASSISTANT_ID no está configurado en las variables de entorno")
    }

    // Solo verificar que el asistente existe, NO actualizar las instrucciones
    const assistant = await openai.beta.assistants.retrieve(assistantId)

    console.log(`[ASSISTANT_CONFIG] Asistente ID: ${assistantId}`)
    console.log(`[ASSISTANT_CONFIG] Nombre del asistente: ${assistant.name}`)
    console.log(`[ASSISTANT_CONFIG] Modelo: ${assistant.model}`)
    console.log(`[ASSISTANT_CONFIG] Usando instrucciones del panel de OpenAI`)

    return assistantId
  } catch (error) {
    console.error("Error al verificar asistente:", error)
    throw error
  }
}
