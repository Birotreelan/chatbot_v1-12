import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { incrementMetric, logError } from "@/lib/monitoring"
import { executeOpenAITool } from "@/lib/openai-tools"

// Función para obtener una instancia de OpenAI
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

// Función para esperar un tiempo determinado
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Tiempo máximo de espera para la respuesta de OpenAI (en milisegundos)
const OPENAI_TIMEOUT = Number.parseInt(process.env.OPENAI_TIMEOUT || "60000", 10)

// Número máximo de reintentos
const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || "3", 10)

// Tiempo de espera entre reintentos (en milisegundos)
const RETRY_DELAY = Number.parseInt(process.env.RETRY_DELAY || "2000", 10)

// Mensajes predefinidos para cada función
const FUNCTION_MESSAGES = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  default: "Estoy procesando tu solicitud, dame un momento por favor.",
}

export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
) {
  console.log(`[ASSISTANT] ========== INICIANDO GETASSISTANTRESPONSE ==========`)
  console.log(`[ASSISTANT] Thread ID: ${threadId}`)
  console.log(`[ASSISTANT] Phone Number ID: ${phoneNumberId}`)
  console.log(`[ASSISTANT] Assistant ID: ${assistantId}`)
  console.log(`[ASSISTANT] Mensaje original recibido (${message.length} caracteres):`)
  console.log(`[ASSISTANT] "${message}"`)
  console.log(`[ASSISTANT] ================================================`)

  const openai = getOpenAIClient()

  try {
    // Obtener la configuración de WhatsApp
    console.log(`[ASSISTANT] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[ASSISTANT] No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }
    console.log(`[ASSISTANT] Configuración encontrada: ${config.displayName}`)
    console.log(`[ASSISTANT] Cliente ID: ${config.cliente_id}`)

    // Añadir el mensaje al thread
    console.log(`[ASSISTANT] ========== ENVIANDO MENSAJE A OPENAI ==========`)
    console.log(`[ASSISTANT] Mensaje que se enviará a OpenAI (${message.length} caracteres):`)
    console.log(`[ASSISTANT] "${message}"`)
    console.log(`[ASSISTANT] Tokens estimados del mensaje: ${Math.ceil(message.length / 4)}`)
    console.log(`[ASSISTANT] ================================================`)

    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[ASSISTANT] Mensaje añadido al thread con ID: ${messageResponse.id}`)

    // Crear un run con el asistente
    console.log(`[ASSISTANT] ========== CREANDO RUN ==========`)
    console.log(`[ASSISTANT] Creando run con asistente ${assistantId}`)

    const runStartTime = Date.now()
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[ASSISTANT] Run creado con ID: ${run.id}`)
    console.log(`[ASSISTANT] Run status inicial: ${run.status}`)
    console.log(`[ASSISTANT] ================================================`)

    // Procesar el run
    console.log(`[ASSISTANT] ========== PROCESANDO RUN ==========`)
    console.log(`[ASSISTANT] Procesando run ${run.id}`)
    await processRunWithCorrectFlow(
      openai,
      threadId,
      run.id,
      config.accessToken,
      phoneNumberId,
      config.lastUserPhoneNumber || "",
      config.cliente_id || "",
    )

    const runEndTime = Date.now()
    const runDuration = runEndTime - runStartTime
    console.log(`[ASSISTANT] Run procesado exitosamente en ${runDuration}ms`)
    console.log(`[ASSISTANT] ================================================`)

    return { success: true }
  } catch (error) {
    console.error("[ASSISTANT] Error en getAssistantResponse:", error)
    await logError("openai", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

async function processRunWithCorrectFlow(
  openai: OpenAI,
  threadId: string,
  runId: string,
  accessToken: string,
  phoneNumberId: string,
  userPhoneNumber: string,
  clienteId: string,
  retryCount = 0,
) {
  console.log(`[ASSISTANT] ========== PROCESANDO RUN ${runId} ==========`)
  console.log(`[ASSISTANT] Parámetros de entrada:`)
  console.log(`[ASSISTANT] - threadId: "${threadId}" (tipo: ${typeof threadId})`)
  console.log(`[ASSISTANT] - runId: "${runId}" (tipo: ${typeof runId})`)
  console.log(`[ASSISTANT] - phoneNumberId: "${phoneNumberId}"`)
  console.log(`[ASSISTANT] - userPhoneNumber: "${userPhoneNumber}"`)
  console.log(`[ASSISTANT] - clienteId: "${clienteId}"`)
  console.log(`[ASSISTANT] - retryCount: ${retryCount}`)

  // Validar parámetros críticos
  if (!threadId || threadId === "undefined") {
    console.error(`[ASSISTANT] ❌ threadId inválido en processRunWithCorrectFlow: "${threadId}"`)
    throw new Error(`threadId inválido en processRunWithCorrectFlow: "${threadId}"`)
  }

  if (!runId || runId === "undefined") {
    console.error(`[ASSISTANT] ❌ runId inválido en processRunWithCorrectFlow: "${runId}"`)
    throw new Error(`runId inválido en processRunWithCorrectFlow: "${runId}"`)
  }

  console.log(
    `[ASSISTANT] Iniciando processRunWithCorrectFlow para run ${runId}, intento ${retryCount + 1}/${MAX_RETRIES + 1}`,
  )

  try {
    // Esperar a que el run se complete o requiera acción
    console.log(`[ASSISTANT] Esperando completación del run...`)
    const completedRun = await waitForRunCompletionOrAction(openai, threadId, runId)
    console.log(`[ASSISTANT] Run completado con estado: ${completedRun.status}`)

    if (completedRun.status === "completed") {
      // Obtener los mensajes del asistente
      console.log(`[ASSISTANT] ========== OBTENIENDO RESPUESTA ==========`)
      console.log(`[ASSISTANT] Obteniendo mensajes del thread ${threadId}`)
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      // Verificar si hay mensajes
      if (messages.data.length === 0) {
        console.warn("[ASSISTANT] No se encontraron mensajes en el thread")
        throw new Error("No se encontraron mensajes en el thread")
      }

      // Obtener el último mensaje del asistente
      const lastMessage = messages.data[0]
      if (lastMessage.role !== "assistant") {
        console.warn(`[ASSISTANT] El último mensaje no es del asistente: ${lastMessage.role}`)
        throw new Error(`El último mensaje no es del asistente: ${lastMessage.role}`)
      }

      // Extraer el contenido del mensaje
      let messageContent = ""
      for (const content of lastMessage.content) {
        if (content.type === "text") {
          messageContent += content.text.value
        }
      }

      console.log(`[ASSISTANT] ========== RESPUESTA DEL ASISTENTE ==========`)
      console.log(`[ASSISTANT] Mensaje del asistente (${messageContent.length} caracteres):`)
      console.log(`[ASSISTANT] "${messageContent}"`)
      console.log(`[ASSISTANT] Tokens estimados de la respuesta: ${Math.ceil(messageContent.length / 4)}`)
      console.log(`[ASSISTANT] ================================================`)

      // Enviar el mensaje a WhatsApp
      console.log(`[ASSISTANT] Enviando mensaje a WhatsApp para usuario ${userPhoneNumber}`)
      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, messageContent)
      console.log(`[ASSISTANT] Mensaje enviado exitosamente a WhatsApp`)

      // Incrementar métrica de mensajes enviados
      await incrementMetric("messages_sent")

      return { success: true }
    } else if (completedRun.status === "requires_action") {
      console.log(`[ASSISTANT] ========== PROCESANDO HERRAMIENTAS ==========`)
      console.log(`[ASSISTANT] El run requiere acción - procesando herramientas`)

      if (completedRun.required_action?.type === "submit_tool_outputs") {
        const toolCalls = completedRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        console.log(`[ASSISTANT] Procesando ${toolCalls.length} llamadas a herramientas`)

        // Procesar cada llamada a herramienta
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[ASSISTANT] ========== PROCESANDO HERRAMIENTA ==========`)
          console.log(`[ASSISTANT] Función: ${functionName}`)
          console.log(`[ASSISTANT] Argumentos:`, JSON.stringify(functionArgs, null, 2))
          console.log(`[ASSISTANT] Tool Call ID: ${toolCall.id}`)

          // Enviar mensaje de espera al usuario
          const waitingMessage = FUNCTION_MESSAGES[functionName] || FUNCTION_MESSAGES.default
          console.log(`[ASSISTANT] Enviando mensaje de espera: "${waitingMessage}"`)

          try {
            await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, waitingMessage)
            console.log(`[ASSISTANT] Mensaje de espera enviado exitosamente`)
          } catch (error) {
            console.error(`[ASSISTANT] Error al enviar mensaje de espera:`, error)
            // Continuar con la ejecución aunque falle el mensaje de espera
          }

          // Ejecutar la función
          console.log(`[ASSISTANT] Ejecutando función ${functionName}...`)
          const toolStartTime = Date.now()
          const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)
          const toolEndTime = Date.now()
          const toolDuration = toolEndTime - toolStartTime

          console.log(`[ASSISTANT] ========== RESULTADO DE HERRAMIENTA ==========`)
          console.log(`[ASSISTANT] Función: ${functionName}`)
          console.log(`[ASSISTANT] Duración: ${toolDuration}ms`)
          console.log(`[ASSISTANT] Resultado:`, JSON.stringify(toolResult, null, 2))

          const resultString = JSON.stringify(toolResult)
          console.log(`[ASSISTANT] Tamaño del resultado: ${resultString.length} caracteres`)
          console.log(`[ASSISTANT] Tokens estimados del resultado: ${Math.ceil(resultString.length / 4)}`)
          console.log(`[ASSISTANT] ================================================`)

          // Preparar el resultado para enviarlo de vuelta al asistente
          const toolOutput = {
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          }

          toolOutputs.push(toolOutput)
        }

        // Enviar los resultados de las herramientas al asistente
        console.log(`[ASSISTANT] ========== ENVIANDO TODOS LOS RESULTADOS ==========`)
        console.log(`[ASSISTANT] Enviando resultados de ${toolOutputs.length} herramientas al asistente`)

        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        })

        console.log(`[ASSISTANT] Resultados enviados exitosamente`)
        console.log(`[ASSISTANT] ================================================`)

        // Continuar procesando el run después de enviar los resultados
        console.log(`[ASSISTANT] Continuando procesamiento del run después de ejecutar herramientas`)
        return await processRunWithCorrectFlow(
          openai,
          threadId,
          runId,
          accessToken,
          phoneNumberId,
          userPhoneNumber,
          clienteId,
          retryCount,
        )
      } else {
        console.error(`[ASSISTANT] Tipo de acción requerida no soportado: ${completedRun.required_action?.type}`)
        throw new Error(`Tipo de acción requerida no soportado: ${completedRun.required_action?.type}`)
      }
    } else if (completedRun.status === "failed") {
      console.error(`[ASSISTANT] ❌ Run falló: ${completedRun.last_error?.message}`)
      console.error(`[ASSISTANT] Detalles del error:`, JSON.stringify(completedRun.last_error, null, 2))
      throw new Error(`Run falló: ${completedRun.last_error?.message}`)
    } else {
      console.warn(`[ASSISTANT] Estado inesperado del run: ${completedRun.status}`)
      throw new Error(`Estado inesperado del run: ${completedRun.status}`)
    }
  } catch (error) {
    console.error(`[ASSISTANT] ❌ Error en processRunWithCorrectFlow:`, error)

    // Reintentar si no hemos alcanzado el número máximo de reintentos
    if (retryCount < MAX_RETRIES) {
      let waitTime = RETRY_DELAY
      if (error.message && error.message.includes("Please try again in")) {
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000 // +1s de buffer
        }
      }
      console.log(`[ASSISTANT] Reintentando en ${waitTime}ms...`)
      await wait(waitTime)
      return processRunWithCorrectFlow(
        openai,
        threadId,
        runId,
        accessToken,
        phoneNumberId,
        userPhoneNumber,
        clienteId,
        retryCount + 1,
      )
    }

    // Si hemos agotado los reintentos, lanzar el error
    await logError("openai_run", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  console.log(`[ASSISTANT] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[ASSISTANT] Esperando a que el run ${runId} se complete o requiera acción...`)

  const startTime = Date.now()
  let run = await openai.beta.threads.runs.retrieve(threadId, runId)
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++

    // Verificar si hemos excedido el timeout
    const elapsed = Date.now() - startTime
    if (elapsed > OPENAI_TIMEOUT) {
      console.error(`[ASSISTANT] ❌ Timeout esperando a que el run se complete: ${OPENAI_TIMEOUT}ms`)
      throw new Error(`Timeout esperando a que el run se complete: ${OPENAI_TIMEOUT}ms`)
    }

    // Log cada 10 polls para no saturar
    if (pollCount % 10 === 0) {
      console.log(`[ASSISTANT] Poll ${pollCount}: Estado actual del run: ${run.status} (${elapsed}ms transcurridos)`)
    }

    // Esperar un poco antes de verificar de nuevo
    await wait(1000)

    // Obtener el estado actualizado del run
    run = await openai.beta.threads.runs.retrieve(threadId, runId)
  }

  const totalTime = Date.now() - startTime
  console.log(`[ASSISTANT] ✅ Run completado en ${totalTime}ms con estado: ${run.status} (${pollCount} polls)`)
  console.log(`[ASSISTANT] ================================================`)
  return run
}
