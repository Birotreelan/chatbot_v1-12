import { getArgentinaDateTime } from "./utils/date-utils"
import { openai } from "@/lib/openai"
import { getRedisClient } from "@/lib/redis"
import { logError } from "@/lib/monitoring"
import type { WhatsappConfig } from "@/lib/types"
import {
  buscarPaciente,
  validarObraSocial,
  obtenerSubespecialidades,
  buscarProfesionales,
  obtenerTurnos,
  reservarTurno,
} from "@/lib/api-tools/api-functions"

interface WebChatConfig {
  id: string
  displayName: string
  widgetAssistantId: string
  enabled: boolean
  widgetEnabled: boolean
  cliente_id?: string
}

interface ProcessWebMessageParams {
  message: string
  sessionId: string
  config: WebChatConfig
  ip: string
}

interface ProcessWebChatMessageParams {
  message: string
  sessionId: string
  config: WhatsappConfig
  ip: string
}

// Cache simple para threads web - MEJORADO con persistencia
const webThreadsCache = new Map<string, string>()

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

// Configuración de timeouts y reintentos
const MAX_ATTEMPTS = 60 // Aumentado para tool calls pesadas
const WAIT_TIME = 2000 // 2 segundos entre intentos
const THREAD_CACHE_TTL = 3600 // 1 hora

export async function processWebChatMessage({
  message,
  sessionId,
  config,
  ip,
}: ProcessWebChatMessageParams): Promise<string> {
  console.log("[WEB-CHAT-FINAL] ========== PROCESANDO MENSAJE WEB ==========")
  console.log("[WEB-CHAT-FINAL] Session ID:", sessionId)
  console.log("[WEB-CHAT-FINAL] Cliente:", config.displayName)
  console.log("[WEB-CHAT-FINAL] Cliente ID:", config.id)
  console.log("[WEB-CHAT-FINAL] IP:", ip)
  console.log("[WEB-CHAT-FINAL] Mensaje:", message)
  console.log("[WEB-CHAT-FINAL] ================================================")

  try {
    // Generar clave de thread simplificada para mantener contexto
    const cleanSessionId = sessionId.replace(/^web_/, "").split("_")[0]
    const threadKey = `web_${cleanSessionId}`

    console.log("[WEB-CHAT-FINAL] Thread key:", threadKey)

    // Obtener o crear thread
    const threadId = await getOrCreateThread(threadKey)
    console.log("[WEB-CHAT-FINAL] 🌐 Usando thread:", threadId)

    // Garantía: NO enviar a WhatsApp
    console.log("[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp")

    // Crear bloque de sistema con información del cliente
    const now = new Date()
    const fechaHora = now.toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    })

    const sistemaBlock = `[SISTEMA] Nombre: ${config.displayName} FechaHora: ${fechaHora} CelularPaciente: No disponible (consulta web) [/SISTEMA]`

    console.log("[WEB-CHAT-FINAL] 📋 Bloque [SISTEMA] creado:")
    console.log(sistemaBlock)

    // Procesar con OpenAI
    const response = await processWithOpenAI({
      threadId,
      message: `${sistemaBlock}\n\n${message}`,
      assistantId: config.assistantId || process.env.OPENAI_ASSISTANT_ID!,
      clienteId: config.clienteId,
    })

    console.log("[WEB-CHAT-FINAL] ✅ Respuesta:", response.length, "caracteres")
    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error procesando mensaje:", error)
    await logError("WEB_CHAT_ERROR", error instanceof Error ? error.message : "Error desconocido", {
      sessionId,
      clienteId: config.id,
      message: message.substring(0, 100),
    })

    return "Disculpá, hubo un problema procesando tu mensaje. Por favor, intentá nuevamente."
  }
}

async function getOrCreateThread(threadKey: string): Promise<string> {
  const redis = getRedisClient()

  try {
    // Intentar obtener thread existente
    if (redis) {
      const cachedThreadId = await redis.get(`thread:${threadKey}`)
      if (cachedThreadId) {
        console.log("[WEB-CHAT-FINAL] 🔍 Thread en cache:", cachedThreadId)
        console.log("[WEB-CHAT-FINAL] ♻️ Reutilizando thread existente:", cachedThreadId)
        return cachedThreadId as string
      }
    }

    console.log("[WEB-CHAT-FINAL] 🔍 Thread en cache: NO ENCONTRADO")
    console.log("[WEB-CHAT-FINAL] 📝 Creando nuevo thread para:", threadKey)

    // Crear nuevo thread
    console.log("[WEB-CHAT-FINAL] 🔧 Creando thread para:", threadKey)
    const thread = await openai.beta.threads.create()
    console.log("[WEB-CHAT-FINAL] ✅ Thread creado exitosamente:", thread.id)

    // Guardar en caché
    if (redis) {
      await redis.setex(`thread:${threadKey}`, THREAD_CACHE_TTL, thread.id)
      console.log("[WEB-CHAT-FINAL] 💾 Thread guardado en cache con key:", threadKey)
    }

    console.log("[WEB-CHAT-FINAL] ✅ Thread creado y guardado en cache:", thread.id)
    return thread.id
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error creando/obteniendo thread:", error)
    throw error
  }
}

async function processWithOpenAI({
  threadId,
  message,
  assistantId,
  clienteId,
}: {
  threadId: string
  message: string
  assistantId: string
  clienteId: string
}): Promise<string> {
  console.log("[WEB-CHAT-FINAL] ========== PROCESANDO CON OPENAI ==========")
  console.log("[WEB-CHAT-FINAL] Thread ID:", threadId)
  console.log("[WEB-CHAT-FINAL] Assistant ID:", assistantId)
  console.log("[WEB-CHAT-FINAL] Cliente ID:", clienteId)
  console.log("[WEB-CHAT-FINAL] ================================================")

  try {
    // Añadir mensaje al thread
    console.log("[WEB-CHAT-FINAL] Añadiendo mensaje al thread:", threadId)
    const messageObj = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })
    console.log("[WEB-CHAT-FINAL] Mensaje añadido:", messageObj.id)

    // Crear run
    console.log("[WEB-CHAT-FINAL] Creando run con assistant:", assistantId)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })
    console.log("[WEB-CHAT-FINAL] Run creado:", run.id)

    // Esperar completación
    const finalResponse = await waitForCompletion(run.id, threadId, clienteId)
    console.log("[WEB-CHAT-FINAL] ✅ Respuesta final:", finalResponse.length, "caracteres")

    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error en processWithOpenAI:", error)
    throw error
  }
}

async function waitForCompletion(runId: string, threadId: string, clienteId: string): Promise<string> {
  console.log("[WEB-CHAT-FINAL] ========== ESPERANDO COMPLETACIÓN ==========")
  console.log("[WEB-CHAT-FINAL] Run ID:", runId)
  console.log("[WEB-CHAT-FINAL] Cliente ID:", clienteId)
  console.log("[WEB-CHAT-FINAL] ================================================")

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[WEB-CHAT-FINAL] Verificando run ${runId} (intento ${attempt}/${MAX_ATTEMPTS})`)

      const run = await openai.beta.threads.runs.retrieve(threadId, runId)
      console.log("[WEB-CHAT-FINAL] Estado del run:", run.status)

      switch (run.status) {
        case "completed":
          // Obtener mensajes del thread
          const messages = await openai.beta.threads.messages.list(threadId, {
            order: "desc",
            limit: 1,
          })

          if (messages.data.length > 0) {
            const lastMessage = messages.data[0]
            if (lastMessage.content[0]?.type === "text") {
              return lastMessage.content[0].text.value
            }
          }
          throw new Error("No se pudo obtener la respuesta del asistente")

        case "requires_action":
          console.log("[WEB-CHAT-FINAL] Run requiere acción - procesando tool calls")
          await handleToolCalls(run, threadId, runId, clienteId)
          break

        case "failed":
        case "cancelled":
        case "expired":
          throw new Error(`Run falló con estado: ${run.status}`)

        case "queued":
        case "in_progress":
          // Continuar esperando
          break

        default:
          console.log("[WEB-CHAT-FINAL] Estado desconocido:", run.status)
      }

      // Esperar antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, WAIT_TIME))
    } catch (error) {
      console.error(`[WEB-CHAT-FINAL] ❌ Error en intento ${attempt}:`, error)
      if (attempt === MAX_ATTEMPTS) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_TIME))
    }
  }

  throw new Error("Timeout esperando completación del run")
}

async function handleToolCalls(run: any, threadId: string, runId: string, clienteId: string): Promise<void> {
  console.log("[WEB-CHAT-FINAL] ========== PROCESANDO TOOL CALLS ==========")
  console.log("[WEB-CHAT-FINAL] Cantidad:", run.required_action?.submit_tool_outputs?.tool_calls?.length || 0)
  console.log("[WEB-CHAT-FINAL] Cliente ID:", clienteId)
  console.log("[WEB-CHAT-FINAL] ================================================")

  const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || []
  const toolOutputs = []

  for (const toolCall of toolCalls) {
    console.log("[WEB-CHAT-FINAL] ========== TOOL CALL ==========")
    console.log("[WEB-CHAT-FINAL] Función:", toolCall.function.name)
    console.log("[WEB-CHAT-FINAL] Argumentos:", toolCall.function.arguments)
    console.log("[WEB-CHAT-FINAL] ================================")

    try {
      const result = await executeToolCall(toolCall, clienteId)
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(result),
      })
      console.log("[WEB-CHAT-FINAL] ✅ Tool call procesado:", toolCall.function.name)
    } catch (error) {
      console.error("[WEB-CHAT-FINAL] ❌ Error en tool call:", error)
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({
          exito: false,
          error: {
            codigo: "TOOL_CALL_ERROR",
            mensaje: error instanceof Error ? error.message : "Error desconocido",
          },
        }),
      })
    }
  }

  // Enviar tool outputs
  console.log("[WEB-CHAT-FINAL] ========== ENVIANDO TOOL OUTPUTS ==========")
  console.log("[WEB-CHAT-FINAL] Cantidad:", toolOutputs.length)

  await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
    tool_outputs: toolOutputs,
  })

  console.log("[WEB-CHAT-FINAL] ✅ Tool outputs enviados correctamente")
  console.log("[WEB-CHAT-FINAL] ================================================")
}

async function executeToolCall(toolCall: any, clienteId: string): Promise<any> {
  const functionName = toolCall.function.name
  const args = JSON.parse(toolCall.function.arguments)

  switch (functionName) {
    case "buscar_paciente":
      console.log("[WEB-CHAT-FINAL] 🔍 Buscando paciente con cliente:", clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 DNI:", args.dni)
      const pacienteResult = await buscarPaciente(clienteId, { dni: args.dni })
      console.log("[WEB-CHAT-FINAL] 📋 Resultado paciente:", pacienteResult.exito ? "Encontrado" : "No encontrado")
      return pacienteResult

    case "validar_obra_social":
      console.log("[WEB-CHAT-FINAL] 🏥 Validando obra social con cliente:", clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 Búsqueda:", args.busqueda)
      const obraSocialResult = await validarObraSocial(clienteId, args.busqueda)
      console.log("[WEB-CHAT-FINAL] 📋 Resultado obra social:", obraSocialResult)
      return obraSocialResult

    case "obtener_especialidades":
      console.log("[WEB-CHAT-FINAL] 🏥 Obteniendo especialidades con cliente:", clienteId)
      const especialidadesResult = await obtenerSubespecialidades(clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 Resultado especialidades:", especialidadesResult.exito ? "Obtenidas" : "Error")
      return especialidadesResult

    case "buscar_profesionales":
      console.log("[WEB-CHAT-FINAL] 👨‍⚕️ Buscando profesionales con cliente:", clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 Búsqueda:", args.busqueda)
      const profesionalesResult = await buscarProfesionales(clienteId, args.busqueda)
      console.log("[WEB-CHAT-FINAL] 📋 Resultado profesionales:", profesionalesResult.exito ? "Encontrados" : "Error")
      return profesionalesResult

    case "obtener_turnos":
      console.log("[WEB-CHAT-FINAL] 📅 Obteniendo turnos con cliente:", clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 Parámetros:", args)
      const turnosResult = await obtenerTurnos(
        clienteId,
        args.fechaDesde,
        args.fechaHasta,
        args.profesionalId,
        args.pacienteDni,
      )
      console.log("[WEB-CHAT-FINAL] 📋 Resultado turnos:", turnosResult.exito ? "Obtenidos" : "Error")
      return turnosResult

    case "reservar_turno":
      console.log("[WEB-CHAT-FINAL] 📝 Reservando turno con cliente:", clienteId)
      console.log("[WEB-CHAT-FINAL] 📋 Parámetros:", args)
      const reservaResult = await reservarTurno(clienteId, args.agendaId, args.pacienteData)
      console.log("[WEB-CHAT-FINAL] 📋 Resultado reserva:", reservaResult.exito ? "Reservado" : "Error")
      return reservaResult

    default:
      console.log("[WEB-CHAT-FINAL] ❌ Función desconocida:", functionName)
      throw new Error(`Función desconocida: ${functionName}`)
  }
}
