import OpenAI from "openai"
import { wait } from "@/lib/utils"
import { executeOpenAITool } from "@/lib/openai-tools"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function processWebOnlyMessage(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  try {
    console.log(`[OPENAI-WEB] 🌐 PROCESANDO MENSAJE WEB ÚNICAMENTE`)
    console.log(`[OPENAI-WEB] 🚫 GARANTÍA: NO se enviará a WhatsApp`)
    console.log(`[OPENAI-WEB] Thread ID: ${threadId}`)
    console.log(`[OPENAI-WEB] Assistant ID: ${assistantId}`)

    // Validación estricta del thread ID
    if (!threadId || typeof threadId !== "string" || !threadId.startsWith("thread_")) {
      console.error(`[OPENAI-WEB] ❌ Thread ID inválido: "${threadId}"`)
      throw new Error(`Thread ID inválido: "${threadId}"`)
    }

    // Validación del assistant ID
    if (!assistantId || typeof assistantId !== "string" || !assistantId.startsWith("asst_")) {
      console.error(`[OPENAI-WEB] ❌ Assistant ID inválido: "${assistantId}"`)
      throw new Error(`Assistant ID inválido: "${assistantId}"`)
    }

    // 1. Añadir mensaje al thread
    console.log(`[OPENAI-WEB] 📝 Añadiendo mensaje al thread...`)
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })
    console.log(`[OPENAI-WEB] Mensaje añadido al thread: ${messageResponse.id}`)

    // 2. Crear run
    console.log(`[OPENAI-WEB] 🏃 Creando run...`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })
    console.log(`[OPENAI-WEB] Run creado: ${run.id}`)

    // 3. Esperar a que el run se complete con polling optimizado
    console.log(`[OPENAI-WEB] ⏳ Esperando a que el run se complete...`)
    let runStatus = run
    let attempts = 0
    const maxAttempts = 30 // 30 segundos máximo

    while (runStatus.status === "queued" || runStatus.status === "in_progress") {
      if (attempts >= maxAttempts) {
        console.error(`[OPENAI-WEB] ❌ Timeout: Run no completado después de ${maxAttempts} intentos`)
        throw new Error("Timeout: El procesamiento está tomando demasiado tiempo")
      }

      await wait(1000) // Esperar 1 segundo
      attempts++

      console.log(`[OPENAI-WEB] 🔄 Verificando status del run (intento ${attempts}/${maxAttempts})...`)
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
      console.log(`[OPENAI-WEB] Status actual: ${runStatus.status}`)
    }

    // 4. Manejar diferentes estados del run
    if (runStatus.status === "completed") {
      console.log(`[OPENAI-WEB] ✅ Run completado exitosamente`)

      // Obtener mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length > 0) {
        const lastMessage = messages.data[0]
        if (lastMessage.content[0]?.type === "text") {
          const response = lastMessage.content[0].text.value
          console.log(`[OPENAI-WEB] 📤 Respuesta obtenida: ${response.length} caracteres`)
          return response
        }
      }

      console.error(`[OPENAI-WEB] ❌ No se pudo obtener respuesta del thread`)
      return "Lo siento, no pude generar una respuesta."
    } else if (runStatus.status === "requires_action") {
      console.log(`[OPENAI-WEB] 🔧 Run requiere acción - manejando herramientas...`)

      try {
        // Manejar herramientas si es necesario
        const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || []

        if (toolCalls.length > 0) {
          console.log(`[OPENAI-WEB] 🛠️ Procesando ${toolCalls.length} herramientas...`)

          const toolOutputs = []
          for (const toolCall of toolCalls) {
            console.log(`[OPENAI-WEB] 🔨 Procesando herramienta: ${toolCall.function.name}`)

            try {
              // Usar la función executeOpenAITool existente
              const functionName = toolCall.function.name
              const functionArgs = JSON.parse(toolCall.function.arguments)

              const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify(toolResult),
              })
            } catch (toolError) {
              console.error(`[OPENAI-WEB] ❌ Error ejecutando herramienta:`, toolError)

              // Devolver un error como resultado de la herramienta
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                  exito: false,
                  error: {
                    codigo: "ERROR_HERRAMIENTA",
                    mensaje: "Error al ejecutar la herramienta",
                  },
                }),
              })
            }
          }

          // Enviar outputs de herramientas
          await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
            tool_outputs: toolOutputs,
          })

          // Continuar esperando a que se complete
          return await processWebOnlyMessage(threadId, "", assistantId, clienteId)
        }
      } catch (toolError) {
        console.error(`[OPENAI-WEB] ❌ Error procesando herramientas:`, toolError)
        return "Lo siento, hubo un error procesando tu solicitud."
      }
    } else if (runStatus.status === "failed") {
      console.error(`[OPENAI-WEB] ❌ Run falló:`, runStatus.last_error)
      return "Lo siento, hubo un error procesando tu mensaje."
    } else if (runStatus.status === "cancelled") {
      console.error(`[OPENAI-WEB] ❌ Run fue cancelado`)
      return "Lo siento, el procesamiento fue cancelado."
    } else {
      console.error(`[OPENAI-WEB] ❌ Estado inesperado del run: ${runStatus.status}`)
      return "Lo siento, hubo un error inesperado."
    }

    return "Lo siento, no pude procesar tu mensaje."
  } catch (error) {
    console.error("[OPENAI-WEB] ❌ Error en processWebOnlyMessage:", error)

    // Manejo específico de errores de thread_id
    if (error instanceof Error && error.message.includes("thread_id")) {
      console.error("[OPENAI-WEB] ❌ Error específico de thread_id detectado")
      return "Lo siento, hubo un problema técnico. Por favor, recarga la página e intenta nuevamente."
    }

    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}
