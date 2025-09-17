import {
  getWhatsAppConfig,
  getThreadForUser,
  updateWhatsAppStats,
  getOrCreateConversation,
  addMessageToConversation,
} from "./db"
import OpenAI from "openai"
import { createWhatsAppSystemBlock as createSystemBlock } from "./openai-tools"
import { sendWhatsAppMessage } from "./whatsapp-api"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Sistema de logs mejorado
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
}

// Función principal para procesar mensajes de WhatsApp
export async function processWhatsAppMessage(
  phoneNumber: string,
  message: string,
  userName: string,
  messageId: string,
  whatsappConfigId: string,
): Promise<string> {
  const logger = new ProcessorLogger("WHATSAPP-PROCESSOR")

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
    const threadMessage = await openai.beta.threads.messages.create(threadInfo.threadId, {
      role: "user",
      content: message,
    })
    logger.info("Mensaje agregado al thread:", { messageId: threadMessage.id })

    // Preparar instrucciones adicionales si es necesario
    let additionalInstructions = ""
    if (threadInfo.isNewThread || threadInfo.isResetThread) {
      logger.info("Thread nuevo/reseteado - agregando información del sistema")
      if (config.cliente_id && config.sede_id) {
        try {
          const systemBlock = await createSystemBlock(config.displayName, config.cliente_id, config.sede_id)
          additionalInstructions = systemBlock
          logger.info("Información del sistema agregada")
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
    const runStartTime = Date.now()

    const run = await openai.beta.threads.runs.create(threadInfo.threadId, {
      assistant_id: config.whatsappAssistantId,
      additional_instructions: additionalInstructions || undefined,
    })

    const runCreationTime = Date.now() - runStartTime
    logger.info("Run creado exitosamente:", {
      runId: run.id,
      status: run.status,
      creationTime: `${runCreationTime}ms`,
    })

    // CRÍTICO: Verificar que tanto threadId como runId estén definidos
    if (!threadInfo.threadId || !run.id) {
      throw new Error(`Parámetros inválidos - threadId: ${threadInfo.threadId}, runId: ${run.id}`)
    }

    // Esperar completación del run
    logger.info("Esperando completación del run...")
    const completedRun = await waitForRunCompletion(threadInfo.threadId, run.id, config.cliente_id, logger)

    if (completedRun.status === "completed") {
      logger.info("Run completado exitosamente")

      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadInfo.threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length > 0) {
        const lastMessage = messages.data[0]
        if (lastMessage.role === "assistant" && lastMessage.content[0]?.type === "text") {
          const response = lastMessage.content[0].text.value
          logger.info("Respuesta generada:", { length: response.length })

          // Agregar respuesta del asistente a la conversación
          await addMessageToConversation(conversation.id, "assistant", response, lastMessage.id)

          // Enviar respuesta por WhatsApp
          logger.info("Enviando respuesta por WhatsApp...")
          await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, phoneNumber, response)
          logger.info("Respuesta enviada exitosamente")

          // Actualizar estadísticas
          await updateWhatsAppStats(whatsappConfigId, { messagesProcessed: 1 })

          logger.info("========== PROCESAMIENTO COMPLETADO ==========")
          return response
        }
      }
    }

    throw new Error(`Run no completado correctamente: ${completedRun.status}`)
  } catch (error) {
    logger.error("Error crítico en procesamiento:", error)

    // Actualizar estadísticas de error
    await updateWhatsAppStats(whatsappConfigId, { errors: 1 })

    throw error
  }
}

// Función mejorada para cancelar runs activos
async function cancelActiveRuns(threadId: string, logger: ProcessorLogger): Promise<void> {
  try {
    logger.info("Verificando runs activos...", { threadId })

    const runs = await openai.beta.threads.runs.list(threadId, {
      limit: 10,
      order: "desc",
    })

    logger.info("Runs encontrados:", { count: runs.data.length })

    for (const run of runs.data) {
      logger.info("Run encontrado:", {
        runId: run.id,
        status: run.status,
        createdAt: run.created_at,
      })

      if (run.status === "in_progress" || run.status === "queued") {
        logger.warn("Cancelando run activo:", { runId: run.id, status: run.status })
        try {
          await openai.beta.threads.runs.cancel(threadId, run.id)
          logger.info("Run cancelado exitosamente:", { runId: run.id })
        } catch (cancelError) {
          logger.error("Error cancelando run:", { runId: run.id, error: cancelError })
        }
      }
    }
  } catch (error) {
    logger.error("Error verificando runs activos:", error)
  }
}

// Función corregida para esperar completación del run
async function waitForRunCompletion(
  threadId: string,
  runId: string,
  clienteId?: string,
  logger?: ProcessorLogger,
  maxAttempts = 60,
): Promise<any> {
  const log = logger || new ProcessorLogger("RUN-COMPLETION")

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

      // CRÍTICO: Parámetros en el orden correcto (threadId PRIMERO, runId SEGUNDO)
      log.debug("Llamando a OpenAI API:", {
        method: "openai.beta.threads.runs.retrieve",
        threadId,
        runId,
        parameterOrder: "threadId FIRST, runId SECOND",
      })

      const run = await openai.beta.threads.runs.retrieve(threadId, runId)

      log.debug("Respuesta de OpenAI:", {
        runId: run.id,
        status: run.status,
        threadId: run.thread_id,
      })

      if (run.status === "completed") {
        log.info("Run completado exitosamente")
        return run
      }

      if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        log.error("Run falló:", { status: run.status, lastError: run.last_error })
        throw new Error(`Run falló: ${run.status}`)
      }

      if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
        log.info("Run requiere ejecución de herramientas")

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        for (const toolCall of toolCalls) {
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

            log.info("Herramienta ejecutada exitosamente:", { toolName: toolCall.function.name })
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

        // Enviar outputs de herramientas
        log.info("Enviando outputs de herramientas...")
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        })
        log.info("Outputs enviados exitosamente")
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, 2000))
    } catch (error) {
      log.error(`Error en intento ${attempt}:`, error)

      if (attempt === maxAttempts) {
        throw error
      }

      // Esperar antes de reintentar
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  throw new Error(`Timeout esperando completación del run después de ${maxAttempts} intentos`)
}
