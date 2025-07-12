import { validateDNI, searchTurnos, reserveTurno } from "@/lib/clinic-api"
import { getArgentinaDateTime } from "@/lib/utils/date-utils"
import { getRedisClient as getRedisClientFromLib } from "@/lib/redis"

interface WebChatConfig {
  id: string
  displayName: string
  widgetAssistantId: string
  enabled: boolean
  widgetEnabled: boolean
  cliente_id?: string
}

interface WebChatMessage {
  message: string
  cliente_id: string
  session_id: string
  source: string
}

interface WebChatResponse {
  success: boolean
  response: string
  error?: string
}

// Funciones para manejar el cache de threads web
async function getThreadFromCache(threadKey: string): Promise<string | null> {
  const redis = getRedisClientFromLib()
  if (redis) {
    try {
      const threadId = await redis.get(`web_thread:${threadKey}`)
      return threadId as string | null
    } catch (error) {
      console.error("[WEB-CHAT-FINAL] Error obteniendo thread de Redis:", error)
      return null
    }
  }
  return null
}

async function setThreadInCache(threadKey: string, threadId: string): Promise<void> {
  const redis = getRedisClientFromLib()
  if (redis) {
    try {
      // Guardar con TTL de 24 horas
      await redis.setex(`web_thread:${threadKey}`, 86400, threadId)
    } catch (error) {
      console.error("[WEB-CHAT-FINAL] Error guardando thread en Redis:", error)
    }
  }
}

// Función helper para obtener fechas dinámicas
function getDefaultDateRange(): string {
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)

  const formatDate = (date: Date): string => {
    return date.toISOString().split("T")[0] // YYYY-MM-DD
  }

  return `${formatDate(today)} a ${formatDate(nextWeek)}`
}

// Función para crear el bloque [SISTEMA]
function createSystemBlock(clinicName: string): string {
  const fechaHora = getArgentinaDateTime()

  return `[SISTEMA]
Nombre: ${clinicName}
FechaHora: ${fechaHora}
CelularPaciente: No disponible (consulta web)
[/SISTEMA]`
}

// Función principal para procesar mensajes del widget web
export async function processWebChatMessage(data: WebChatMessage): Promise<WebChatResponse> {
  console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO MENSAJE WEB ==========`)
  console.log(`[WEB-CHAT-FINAL] Session ID: ${data.session_id}`)
  console.log(`[WEB-CHAT-FINAL] Cliente ID: ${data.cliente_id}`)
  console.log(`[WEB-CHAT-FINAL] IP: unknown`)
  console.log(`[WEB-CHAT-FINAL] Mensaje: ${data.message}`)
  console.log(`[WEB-CHAT-FINAL] ================================================`)

  try {
    // Obtener configuración del cliente
    const { getWhatsAppConfigByClienteId } = await import("@/lib/db")
    const config = await getWhatsAppConfigByClienteId(data.cliente_id)

    if (!config) {
      throw new Error(`No se encontró configuración para cliente_id: ${data.cliente_id}`)
    }

    console.log(`[WEB-CHAT-FINAL] Cliente: ${config.displayName}`)
    console.log(`[WEB-CHAT-FINAL] Cliente ID: ${config.id}`)

    // Crear clave única para el thread basada en session_id y config_id
    const threadKey = `${data.session_id}_${config.id}`
    console.log(`[WEB-CHAT-FINAL] Thread key: ${threadKey}`)

    // Buscar thread existente en cache
    const redisClient = getRedisClientFromLib()
    let threadId = null

    if (redisClient) {
      try {
        const cachedThread = await redisClient.get(`web_thread:${threadKey}`)
        if (cachedThread) {
          threadId = cachedThread
          console.log(`[WEB-CHAT-FINAL] 🔍 Thread en cache: ${threadId}`)
        }
      } catch (error) {
        console.error(`[WEB-CHAT-FINAL] Error al buscar thread en cache:`, error)
      }
    }

    // Crear nuevo thread si no existe
    if (!threadId) {
      const openai = new (await import("openai")).default({
        apiKey: process.env.OPENAI_API_KEY,
      })

      const thread = await openai.beta.threads.create()
      threadId = thread.id
      console.log(`[WEB-CHAT-FINAL] 🆕 Nuevo thread creado: ${threadId}`)

      // Guardar en cache
      if (redisClient) {
        try {
          await redisClient.setex(`web_thread:${threadKey}`, 3600, threadId) // 1 hora de TTL
          console.log(`[WEB-CHAT-FINAL] 💾 Thread guardado en cache`)
        } catch (error) {
          console.error(`[WEB-CHAT-FINAL] Error al guardar thread en cache:`, error)
        }
      }
    } else {
      console.log(`[WEB-CHAT-FINAL] ♻️ Reutilizando thread existente: ${threadId}`)
    }

    console.log(`[WEB-CHAT-FINAL] 🌐 Usando thread: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Preparar mensaje con contexto del sistema
    const fechaHora = new Date().toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })

    const systemMessage = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
CelularPaciente: No disponible (consulta web)
[/SISTEMA]`

    const fullMessage = `${systemMessage}\n\n${data.message}`

    console.log(`[WEB-CHAT-FINAL] 📋 Bloque [SISTEMA] creado:${systemMessage}`)

    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO CON OPENAI ==========`)
    console.log(`[WEB-CHAT-FINAL] Thread ID: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] Assistant ID: ${config.widgetAssistantId || config.assistantId}`)
    console.log(`[WEB-CHAT-FINAL] Cliente ID: ${data.cliente_id}`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)

    // Procesar con OpenAI usando función específica para web
    const response = await processWebChatWithTools(
      threadId,
      fullMessage,
      config.widgetAssistantId || config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
      data.cliente_id,
    )

    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta: ${response.length} caracteres`)

    return {
      success: true,
      response: response,
    }
  } catch (error) {
    console.error(`[WEB-CHAT-FINAL] ❌ Error:`, error)
    return {
      success: false,
      response: "Lo siento, ha ocurrido un error. Por favor, intenta de nuevo.",
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Función específica para procesar mensajes web con herramientas
async function processWebChatWithTools(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  const openai = new (await import("openai")).default({
    apiKey: process.env.OPENAI_API_KEY,
  })

  try {
    console.log(`[WEB-CHAT-FINAL] Añadiendo mensaje al thread: ${threadId}`)

    // Añadir el mensaje al thread
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[WEB-CHAT-FINAL] Mensaje añadido: ${messageResponse.id}`)

    // Crear un run con el asistente
    console.log(`[WEB-CHAT-FINAL] Creando run con assistant: ${assistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[WEB-CHAT-FINAL] Run creado: ${run.id}`)

    // Procesar el run con herramientas
    await processWebRunWithTools(openai, threadId, run.id, clienteId)

    // Obtener la respuesta final
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    if (messages.data.length === 0 || messages.data[0].role !== "assistant") {
      throw new Error("No se pudo obtener respuesta del asistente")
    }

    let messageContent = ""
    for (const content of messages.data[0].content) {
      if (content.type === "text") {
        messageContent += content.text.value
      }
    }

    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta final: ${messageContent.length} caracteres`)
    return messageContent
  } catch (error) {
    console.error(`[WEB-CHAT-FINAL] ❌ Error en processWebChatWithTools:`, error)
    throw error
  }
}

// Función para procesar run web con herramientas
async function processWebRunWithTools(openai: any, threadId: string, runId: string, clienteId: string): Promise<void> {
  console.log(`[WEB-CHAT-FINAL] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[WEB-CHAT-FINAL] Run ID: ${runId}`)
  console.log(`[WEB-CHAT-FINAL] Cliente ID: ${clienteId}`)
  console.log(`[WEB-CHAT-FINAL] ================================================`)

  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    attempts++
    console.log(`[WEB-CHAT-FINAL] Verificando run ${runId} (intento ${attempts}/${maxAttempts})`)

    const run = await openai.beta.threads.runs.retrieve(threadId, runId)
    console.log(`[WEB-CHAT-FINAL] Estado del run: ${run.status}`)

    if (run.status === "completed") {
      console.log(`[WEB-CHAT-FINAL] ✅ Run completado exitosamente`)
      return
    } else if (run.status === "failed") {
      throw new Error(`Run falló: ${run.last_error?.message}`)
    } else if (run.status === "requires_action") {
      console.log(`[WEB-CHAT-FINAL] Run requiere acción - procesando tool calls`)

      if (run.required_action?.type === "submit_tool_outputs") {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls

        console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO TOOL CALLS ==========`)
        console.log(`[WEB-CHAT-FINAL] Cantidad: ${toolCalls.length}`)
        console.log(`[WEB-CHAT-FINAL] Cliente ID: ${clienteId}`)
        console.log(`[WEB-CHAT-FINAL] ================================================`)

        const toolOutputs = []

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[WEB-CHAT-FINAL] ========== TOOL CALL ==========`)
          console.log(`[WEB-CHAT-FINAL] Función: ${functionName}`)
          console.log(`[WEB-CHAT-FINAL] Argumentos: ${JSON.stringify(functionArgs)}`)
          console.log(`[WEB-CHAT-FINAL] ================================`)

          let toolResult

          try {
            // Ejecutar la función específica
            switch (functionName) {
              case "validar_dni":
                console.log(`[WEB-CHAT-FINAL] 🔍 Validando DNI: ${functionArgs.dni}`)
                const dniResult = await validateDNI(functionArgs.dni, clienteId)
                console.log(`[WEB-CHAT-FINAL] 📋 Resultado DNI:`, dniResult)
                toolResult = {
                  exito: dniResult.success,
                  datos: dniResult.data || null,
                  error: dniResult.error ? { mensaje: dniResult.error } : null,
                }
                break

              case "buscar_turnos_disponibles":
                console.log(`[WEB-CHAT-FINAL] 🔍 Buscando turnos disponibles`)
                console.log(`[WEB-CHAT-FINAL] 📋 Parámetros:`, functionArgs)

                // Procesar rango de fechas
                let fechaDesde, fechaHasta
                if (functionArgs.rango_fechas) {
                  if (functionArgs.rango_fechas.includes(" a ")) {
                    ;[fechaDesde, fechaHasta] = functionArgs.rango_fechas.split(" a ")
                  } else {
                    fechaDesde = functionArgs.rango_fechas
                    fechaHasta = functionArgs.rango_fechas
                  }
                } else {
                  const hoy = new Date()
                  const unMesDespues = new Date(hoy)
                  unMesDespues.setMonth(hoy.getMonth() + 1)
                  fechaDesde = hoy.toISOString().split("T")[0]
                  fechaHasta = unMesDespues.toISOString().split("T")[0]
                }

                const turnosResult = await searchTurnos(
                  {
                    fechaDesde: fechaDesde.trim(),
                    fechaHasta: fechaHasta.trim(),
                    profesionalId: functionArgs.profesional_id ? Number(functionArgs.profesional_id) : undefined,
                    especialidadId: functionArgs.especialidad_id ? Number(functionArgs.especialidad_id) : undefined,
                  },
                  clienteId,
                )

                console.log(`[WEB-CHAT-FINAL] 📋 Resultado turnos:`, turnosResult)
                toolResult = {
                  exito: turnosResult.success,
                  datos: turnosResult.data || [],
                  error: turnosResult.error ? { mensaje: turnosResult.error } : null,
                }
                break

              case "reservar_turno":
                console.log(`[WEB-CHAT-FINAL] 🎯 Reservando turno con cliente: ${clienteId}`)
                console.log(`[WEB-CHAT-FINAL] 📋 Datos de reserva:`, functionArgs)

                // VALIDACIÓN CRÍTICA: Verificar que agendaId esté presente
                if (!functionArgs.agendaId) {
                  console.error(`[WEB-CHAT-FINAL] ❌ CRÍTICO: agendaId faltante`)
                  toolResult = {
                    exito: false,
                    error: {
                      codigo: "AGENDA_ID_FALTANTE",
                      mensaje: "El ID del turno es requerido para realizar la reserva",
                    },
                  }
                  break
                }

                const reservaResult = await reserveTurno(
                  {
                    agendaId: Number(functionArgs.agendaId),
                    fecha: functionArgs.fecha,
                    hora: functionArgs.hora,
                    profesional: functionArgs.profesional,
                    dni: functionArgs.dni,
                    telefono: functionArgs.telefono,
                    email: functionArgs.email,
                    nombre: functionArgs.nombre,
                    apellido: functionArgs.apellido,
                  },
                  clienteId,
                )

                console.log(`[WEB-CHAT-FINAL] 📋 Resultado reserva:`, reservaResult)
                toolResult = {
                  exito: reservaResult.success,
                  datos: reservaResult.data || null,
                  error: reservaResult.error ? { mensaje: reservaResult.error } : null,
                }
                break

              default:
                // Para otras funciones, usar la implementación existente
                const { executeOpenAITool } = await import("@/lib/openai-tools")
                toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)
                break
            }
          } catch (error) {
            console.error(`[WEB-CHAT-FINAL] ❌ Error ejecutando ${functionName}:`, error)
            toolResult = {
              exito: false,
              error: {
                codigo: "ERROR_EJECUCION",
                mensaje: error instanceof Error ? error.message : "Error desconocido",
              },
            }
          }

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          })

          console.log(`[WEB-CHAT-FINAL] ✅ Tool call procesado: ${functionName}`)
        }

        console.log(`[WEB-CHAT-FINAL] ========== ENVIANDO TOOL OUTPUTS ==========`)
        console.log(`[WEB-CHAT-FINAL] Cantidad: ${toolOutputs.length}`)

        // Enviar los resultados de las herramientas
        await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        })

        console.log(`[WEB-CHAT-FINAL] ✅ Tool outputs enviados correctamente`)
        console.log(`[WEB-CHAT-FINAL] ================================================`)

        // Continuar el bucle para verificar el estado del run
        continue
      }
    }

    // Esperar antes del siguiente intento
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Run no se completó después de ${maxAttempts} intentos`)
}
