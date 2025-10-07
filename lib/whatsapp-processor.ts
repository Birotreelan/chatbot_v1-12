import {
  getThreadForUser,
  updateWhatsAppStats,
  getWhatsAppConfig,
  getOrCreateConversation,
  addMessageToConversation,
} from "./db"
import OpenAI from "openai"
import { createWhatsAppSystemBlock as createSystemBlock } from "./openai-tools"
import { sendWhatsAppMessage } from "./whatsapp-api"
import { logError } from "./monitoring"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Sistema de logs simplificado
class ProcessorLogger {
  private context: string
  private startTime: number

  constructor(context: string) {
    this.context = context
    this.startTime = Date.now()
  }

  log(level: "INFO" | "ERROR" | "WARN" | "DEBUG", message: string, data?: any) {
    const timestamp = new Date().toISOString()
    const elapsed = Date.now() - this.startTime
    const prefix = `[${this.context}] [${level}] [${elapsed}ms]`

    if (data) {
      console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2))
    } else {
      console.log(`${prefix} ${message}`)
    }
  }

  info(message: string, data?: any) {
    this.log("INFO", message, data)
  }
  error(message: string, data?: any) {
    this.log("ERROR", message, data)
  }
  warn(message: string, data?: any) {
    this.log("WARN", message, data)
  }
  debug(message: string, data?: any) {
    this.log("DEBUG", message, data)
  }
  success(message: string, data?: any) {
    this.log("INFO", `✅ ${message}`, data)
  }
}

// Función para hacer llamadas robustas a OpenAI API con diagnósticos
async function makeRobustOpenAICall<T>(
  operation: () => Promise<T>,
  operationName: string,
  logger: ProcessorLogger,
  maxRetries = 5,
): Promise<T> {
  const startTime = Date.now()

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`${operationName} - Intento ${attempt}/${maxRetries}`)
      const result = await operation()
      const duration = Date.now() - startTime

      logger.success(`${operationName} - Exitoso en intento ${attempt}`, { duration })

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const errorDetails = {
        attempt,
        maxRetries,
        duration,
        operationName,
        errorName: error?.constructor?.name || "Unknown",
        errorMessage: error?.message || "No message",
        errorCode: error?.code || "No code",
        errorType: error?.type || "No type",
        errorStatus: error?.status || "No status",
        isRateLimit: error?.message?.includes("rate limit") || error?.code === "rate_limit_exceeded",
        isTimeout: error?.message?.includes("timeout") || error?.code === "ECONNRESET",
        isNetworkError: error?.message?.includes("network") || error?.code === "ECONNRESET",
        fullError: error,
      }

      logger.error(`${operationName} - Error en intento ${attempt}:`, errorDetails)

      if (attempt === maxRetries) {
        logger.error(`${operationName} - Todos los intentos fallaron`)
        await logError(
          `openai_${operationName.toLowerCase()}`,
          error instanceof Error ? error : new Error(String(error)),
        )
        throw error
      }

      // Determinar delay basado en tipo de error
      let delay = Math.pow(2, attempt) * 1000 // Backoff exponencial base

      if (errorDetails.isRateLimit) {
        delay = Math.max(delay, 30000) // Mínimo 30 segundos para rate limit
        logger.warn(`Rate limit detectado, esperando ${delay}ms`)
      } else if (errorDetails.isTimeout) {
        delay = Math.max(delay, 10000) // Mínimo 10 segundos para timeout
        logger.warn(`Timeout detectado, esperando ${delay}ms`)
      } else if (errorDetails.isNetworkError) {
        delay = Math.max(delay, 5000) // Mínimo 5 segundos para errores de red
        logger.warn(`Error de red detectado, esperando ${delay}ms`)
      }

      const jitter = Math.random() * 1000
      delay += jitter

      logger.warn(`${operationName} - Esperando ${Math.round(delay)}ms antes del siguiente intento...`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error(`Unexpected error in makeRobustOpenAICall for ${operationName}`)
}

// Función principal para procesar mensajes de WhatsApp con diagnósticos completos
export async function processWhatsAppMessage(
  phoneNumber: string,
  message: string,
  userName: string,
  messageId: string,
  whatsappConfigId: string,
): Promise<string> {
  const logger = new ProcessorLogger("WHATSAPP-PROCESSOR")
  const processingStartTime = Date.now()

  logger.info("========== INICIANDO PROCESAMIENTO ==========")
  logger.info("Parámetros de entrada:", {
    phoneNumber,
    message: message.substring(0, 100),
    userName,
    messageId,
    whatsappConfigId,
  })

  try {
    // Obtener configuración
    logger.info("Obteniendo configuración...")
    const config = await getWhatsAppConfig(whatsappConfigId)
    if (!config) {
      throw new Error(`Configuración no encontrada: ${whatsappConfigId}`)
    }

    logger.info("Configuración obtenida:", {
      displayName: config.displayName,
      clienteId: config.cliente_id,
      sedeId: config.sede_id,
      assistantId: config.whatsappAssistantId,
    })

    // Obtener o crear thread
    logger.info("Obteniendo thread...")
    const threadInfo = await getThreadForUser(phoneNumber, whatsappConfigId)
    logger.info("Thread obtenido:", {
      threadId: threadInfo.threadId,
      isNewThread: threadInfo.isNewThread,
      isResetThread: threadInfo.isResetThread,
    })

    // CRÍTICO: Verificar que el threadId no sea undefined
    if (!threadInfo.threadId) {
      throw new Error("ThreadId es undefined - esto causará el error de parámetros")
    }

    // Verificar y cancelar runs activos
    logger.info("Verificando runs activos...")
    await cancelActiveRuns(threadInfo.threadId, logger)

    // Obtener o crear conversación
    logger.info("Gestionando conversación...")
    const conversation = await getOrCreateConversation(
      phoneNumber,
      userName,
      whatsappConfigId,
      config.cliente_id || "",
      config.displayName,
      threadInfo.threadId,
    )

    // Agregar mensaje del usuario a la conversación
    await addMessageToConversation(conversation.id, "user", message, messageId)
    logger.info("Mensaje agregado a conversación")

    // Agregar mensaje al thread de OpenAI
    logger.info("Agregando mensaje al thread de OpenAI...")
    const threadMessage = await makeRobustOpenAICall(
      () =>
        openai.beta.threads.messages.create(threadInfo.threadId, {
          role: "user",
          content: message,
        }),
      "CREATE_MESSAGE",
      logger,
    )
    logger.success("Mensaje agregado al thread:", { messageId: threadMessage.id })

    // Preparar instrucciones adicionales si es necesario
    let additionalInstructions = ""
    if (threadInfo.isNewThread || threadInfo.isResetThread) {
      logger.info("Thread nuevo/reseteado - agregando información del sistema")
      if (config.cliente_id && config.sede_id) {
        try {
          const systemBlock = await createSystemBlock(config.displayName, config.cliente_id, config.sede_id)
          additionalInstructions = systemBlock
          logger.success("Información del sistema agregada")
        } catch (error) {
          logger.error("Error obteniendo información del sistema:", error)
        }
      }
    }

    // Crear run con el assistant
    logger.info("Creando run con assistant...")
    logger.debug("Parámetros para crear run:", {
      threadId: threadInfo.threadId,
      assistantId: config.whatsappAssistantId,
      hasAdditionalInstructions: !!additionalInstructions,
      additionalInstructionsLength: additionalInstructions?.length || 0,
    })

    // CRÍTICO: Verificar que los parámetros estén definidos antes de crear el run
    if (!threadInfo.threadId) {
      throw new Error("ThreadId es undefined - no se puede crear el run")
    }
    if (!config.whatsappAssistantId) {
      throw new Error("AssistantId es undefined - no se puede crear el run")
    }

    logger.info("Llamando a OpenAI para crear run...")
    const run = await makeRobustOpenAICall(
      () =>
        openai.beta.threads.runs.create(threadInfo.threadId, {
          assistant_id: config.whatsappAssistantId,
          additional_instructions: additionalInstructions || undefined,
        }),
      "CREATE_RUN",
      logger,
    )

    logger.success("Run creado exitosamente:", {
      runId: run.id,
      status: run.status,
    })

    // CRÍTICO: Verificar que tanto threadId como runId estén definidos
    if (!threadInfo.threadId || !run.id) {
      throw new Error(`Parámetros inválidos - threadId: ${threadInfo.threadId}, runId: ${run.id}`)
    }

    // Esperar completación del run
    logger.info("Esperando completación del run...")
    const completedRun = await waitForRunCompletion(threadInfo.threadId, run.id, config.cliente_id, logger)

    if (completedRun.status === "completed") {
      logger.success("Run completado exitosamente")

      // Obtener los mensajes del thread
      const messages = await makeRobustOpenAICall(
        () =>
          openai.beta.threads.messages.list(threadInfo.threadId, {
            order: "desc",
            limit: 1,
          }),
        "LIST_MESSAGES",
        logger,
      )

      if (messages.data.length > 0) {
        const lastMessage = messages.data[0]
        if (lastMessage.role === "assistant" && lastMessage.content[0]?.type === "text") {
          const response = lastMessage.content[0].text.value
          logger.success("Respuesta generada:", { length: response.length })

          // Agregar respuesta del asistente a la conversación
          await addMessageToConversation(conversation.id, "assistant", response, lastMessage.id)

          // Enviar respuesta por WhatsApp
          logger.info("Enviando respuesta por WhatsApp...")
          await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, response)
          logger.success("Respuesta enviada exitosamente")

          // Actualizar estadísticas
          await updateWhatsAppStats(whatsappConfigId, { messagesProcessed: 1 })

          const totalProcessingTime = Date.now() - processingStartTime
          logger.success("========== PROCESAMIENTO COMPLETADO ==========", {
            totalTime: totalProcessingTime,
            responseLength: response.length,
          })

          return response
        }
      }
    }

    throw new Error(`Run no completado correctamente: ${completedRun.status}`)
  } catch (error) {
    const totalProcessingTime = Date.now() - processingStartTime

    logger.error("Error crítico en procesamiento:", {
      errorName: error?.constructor?.name || "Unknown",
      errorMessage: error?.message || "No message",
      errorStack: error?.stack || "No stack",
      totalTime: totalProcessingTime,
      fullError: error,
    })

    // Actualizar estadísticas de error
    await updateWhatsAppStats(whatsappConfigId, { errors: 1 })

    throw error
  }
}

// Función mejorada para cancelar runs activos con diagnósticos
async function cancelActiveRuns(threadId: string, logger: ProcessorLogger): Promise<void> {
  try {
    logger.info("Verificando runs activos...", { threadId })

    const runs = await makeRobustOpenAICall(
      () =>
        openai.beta.threads.runs.list(threadId, {
          limit: 10,
          order: "desc",
        }),
      "LIST_RUNS",
      logger,
    )

    logger.info("Runs encontrados:", { count: runs.data.length })

    let cancelledCount = 0
    for (const run of runs.data) {
      logger.info("Run encontrado:", {
        runId: run.id,
        status: run.status,
        createdAt: run.created_at,
      })

      if (run.status === "in_progress" || run.status === "queued" || run.status === "requires_action") {
        logger.warn("Cancelando run activo:", { runId: run.id, status: run.status })
        try {
          await makeRobustOpenAICall(
            () => openai.beta.threads.runs.cancel(threadId, run.id),
            "CANCEL_RUN",
            logger,
            3, // Menos reintentos para cancelación
          )
          logger.success("Run cancelado exitosamente:", { runId: run.id })
          cancelledCount++
        } catch (cancelError) {
          logger.error("Error cancelando run:", { runId: run.id, error: cancelError })
        }
      }
    }

    if (cancelledCount > 0) {
      logger.info(`${cancelledCount} runs activos cancelados`, {
        threadId,
        cancelledCount,
        totalRuns: runs.data.length,
      })
    }
  } catch (error) {
    logger.error("Error verificando runs activos:", error)
  }
}

// Función corregida para esperar completación del run con diagnósticos completos
async function waitForRunCompletion(
  threadId: string,
  runId: string,
  clienteId?: string,
  logger?: ProcessorLogger,
  maxAttempts = 60,
): Promise<any> {
  const log = logger || new ProcessorLogger("RUN-COMPLETION")
  const completionStartTime = Date.now()

  log.info("Iniciando espera de completación:", { threadId, runId, maxAttempts })

  // VALIDACIÓN CRÍTICA: Verificar parámetros antes de usar
  if (!threadId || threadId === "undefined") {
    throw new Error(`ThreadId inválido: ${threadId}`)
  }
  if (!runId || runId === "undefined") {
    throw new Error(`RunId inválido: ${runId}`)
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log.debug(`Intento ${attempt}/${maxAttempts} - Verificando run...`)

      // El SDK espera: retrieve(runId, { thread_id: threadId })
      const run = await makeRobustOpenAICall(
        () => openai.beta.threads.runs.retrieve(runId, { thread_id: threadId }),
        "RETRIEVE_RUN",
        log,
        3, // Menos reintentos por intento individual
      )

      log.debug("Respuesta de OpenAI:", {
        runId: run.id,
        status: run.status,
        threadId: run.thread_id,
      })

      if (run.status === "completed") {
        const completionTime = Date.now() - completionStartTime
        log.success("Run completado exitosamente", { completionTime })
        return run
      }

      if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        const errorMessage = `Run falló: ${run.status} - ${run.last_error?.message || "Sin detalles"}`
        log.error("Run falló:", { status: run.status, lastError: run.last_error })
        throw new Error(errorMessage)
      }

      if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
        log.info("Run requiere ejecución de herramientas")

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          log.info("Ejecutando herramienta:", {
            toolName: toolCall.function.name,
            toolId: toolCall.id,
          })

          try {
            let output = ""

            // Ejecutar herramientas según el tipo
            if (toolCall.function.name === "getSedes" && clienteId) {
              const { getSedes } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await getSedes(clienteId, args.sede_id)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "getTurnos" && clienteId) {
              const { getTurnos } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await getTurnos(clienteId, args.sede_id, args.fecha_desde, args.fecha_hasta)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "crearTurno" && clienteId) {
              const { crearTurno } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await crearTurno(clienteId, args)
              output = JSON.stringify(result)
            } else if (toolCall.function.name === "buscarPaciente" && clienteId) {
              const { buscarPaciente } = await import("./api-tools/api-functions")
              const args = JSON.parse(toolCall.function.arguments)
              const result = await buscarPaciente(clienteId, args.dni)
              output = JSON.stringify(result)
            } else {
              output = JSON.stringify({ error: "Función no disponible o cliente no configurado" })
            }

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: output,
            })

            log.success("Herramienta ejecutada exitosamente:", { toolName: toolCall.function.name })
          } catch (toolError) {
            log.error("Error ejecutando herramienta:", {
              toolName: toolCall.function.name,
              error: toolError,
            })
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ error: "Error ejecutando herramienta" }),
            })
          }
        }

        // Enviar outputs de herramientas usando función robusta
        log.info("Enviando outputs de herramientas...")
        await makeRobustOpenAICall(
          () =>
            openai.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, {
              tool_outputs: toolOutputs,
            }),
          "SUBMIT_TOOL_OUTPUTS",
          log,
        )
        log.success("Outputs enviados exitosamente")
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } catch (error) {
      log.error(`Error en intento ${attempt}:`, {
        errorName: error?.constructor?.name || "Unknown",
        errorMessage: error?.message || "No message",
        errorCode: error?.code || "No code",
        fullError: error,
      })

      if (attempt === maxAttempts) {
        const totalTime = Date.now() - completionStartTime
        log.error("Timeout esperando completación", {
          runId,
          totalTime,
          maxAttempts,
        })
        throw new Error(`Timeout esperando completación del run después de ${totalTime}ms`)
      }
    }
  }

  throw new Error("No se pudo completar el run")
}
