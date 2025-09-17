import { validateDNI, getSedes, getEspecialidades, getTurnos, reservarTurno } from "./clinic-api"
import { getThreadForUser, updateWhatsAppStats, getOrCreateConversation, addMessageToConversation } from "./db"
import { logError, incrementMetric } from "./monitoring"
import OpenAI from "openai"
import type { WhatsAppConfig } from "./types"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface WhatsAppMessage {
  from: string
  text?: { body: string }
  type: string
  id: string
  timestamp: string
}

interface WhatsAppContact {
  profile: { name: string }
  wa_id: string
}

interface WhatsAppWebhookData {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: WhatsAppContact[]
  messages?: WhatsAppMessage[]
}

interface ProcessWhatsAppMessageParams {
  message: string
  phoneNumber: string
  config: WhatsAppConfig
}

// Función para crear el bloque de información del sistema
async function createWhatsAppSystemBlock(
  clienteId: string,
  sedeId?: string,
  userName?: string,
  phoneNumber?: string,
): Promise<string> {
  console.log(`[WHATSAPP-PROCESSOR] 🏥 Obteniendo datos de sedes para cliente: ${clienteId}`)

  try {
    // Obtener datos de sedes
    const sedesResult = await getSedes(clienteId, sedeId)
    let sedesInfo = ""

    if (sedesResult.success && sedesResult.data && sedesResult.data.length > 0) {
      console.log(`[WHATSAPP-PROCESSOR] ✅ Sedes obtenidas: ${sedesResult.data.length}`)
      sedesInfo = `
SEDES DISPONIBLES:
${sedesResult.data
  .map(
    (sede: any) => `
- ${sede.Nombre} (ID: ${sede.Id})
  Dirección: ${sede.Direccion}
  Teléfono: ${sede.Telefono}
  Email: ${sede.Email}`,
  )
  .join("\n")}
`
    } else {
      console.log(`[WHATSAPP-PROCESSOR] ⚠️ No se pudieron obtener sedes: ${sedesResult.mensaje}`)
      sedesInfo = `
SEDES: No se pudieron cargar las sedes disponibles.
Error: ${sedesResult.mensaje}
`
    }

    // Crear el bloque de sistema
    const systemBlock = `
[SISTEMA] - Información del Cliente y Configuración

CLIENTE ID: ${clienteId}
${sedeId ? `SEDE ID: ${sedeId}` : "SEDE ID: No especificada"}
${userName ? `USUARIO: ${userName}` : ""}
${phoneNumber ? `TELÉFONO: ${phoneNumber}` : ""}

${sedesInfo}

INSTRUCCIONES IMPORTANTES:
- Siempre usa el CLIENTE ID proporcionado para todas las consultas a la API
- ${sedeId ? `Usa la SEDE ID ${sedeId} para consultas específicas de sede` : "Solicita al usuario que seleccione una sede si es necesario"}
- Mantén un tono profesional y amigable
- Si necesitas validar un DNI, usa la función validate_dni
- Para obtener especialidades, usa get_especialidades
- Para obtener turnos disponibles, usa get_turnos
- Para reservar un turno, usa reservar_turno

FECHA Y HORA ACTUAL: ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
`

    console.log(`[WHATSAPP-PROCESSOR] 📋 Bloque [SISTEMA] creado`)
    return systemBlock
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error al crear bloque de sistema:`, error)
    return `
[SISTEMA] - Error al cargar información del cliente

CLIENTE ID: ${clienteId}
ERROR: No se pudo cargar la información del sistema
FECHA Y HORA: ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
`
  }
}

// Función principal para procesar mensajes de WhatsApp
export async function processWhatsAppMessage(
  phoneNumber: string,
  message: string,
  userName: string,
  whatsappConfig: any,
  messageId?: string,
): Promise<string> {
  console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO MENSAJE WHATSAPP ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Teléfono: ${phoneNumber}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente: ${whatsappConfig.displayName}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${whatsappConfig.cliente_id}`)
  console.log(`[WHATSAPP-PROCESSOR] Sede ID: ${whatsappConfig.sede_id}`)
  console.log(`[WHATSAPP-PROCESSOR] Mensaje: ${message}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  try {
    // Obtener o crear thread
    const { threadId, isNewThread, isResetThread } = await getThreadForUser(phoneNumber, whatsappConfig.id)
    console.log(`[WHATSAPP-PROCESSOR] 🌐 Usando thread: ${threadId} (nuevo: ${isNewThread}, reset: ${isResetThread})`)

    // Obtener o crear conversación
    const conversation = await getOrCreateConversation(
      phoneNumber,
      userName,
      whatsappConfig.id,
      whatsappConfig.cliente_id,
      whatsappConfig.displayName,
      threadId,
    )

    // Agregar mensaje del usuario a la conversación
    await addMessageToConversation(conversation.id, "user", message, messageId)

    // Si es un thread nuevo o reseteado, agregar información del sistema
    if (isNewThread || isResetThread) {
      const systemBlock = await createWhatsAppSystemBlock(
        whatsappConfig.cliente_id,
        whatsappConfig.sede_id,
        userName,
        phoneNumber,
      )

      // Agregar mensaje del sistema al thread
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: systemBlock,
      })
    }

    console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO CON OPENAI ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Thread ID: ${threadId}`)
    console.log(`[WHATSAPP-PROCESSOR] Assistant ID: ${whatsappConfig.whatsappAssistantId}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${whatsappConfig.cliente_id}`)
    console.log(`[WHATSAPP-PROCESSOR] ================================================`)

    // Agregar el mensaje del usuario al thread
    console.log(`[WHATSAPP-PROCESSOR] Añadiendo mensaje al thread: ${threadId}`)
    const userMessage = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })
    console.log(`[WHATSAPP-PROCESSOR] Mensaje añadido: ${userMessage.id}`)

    // Crear y ejecutar el run
    console.log(`[WHATSAPP-PROCESSOR] Creando run con assistant: ${whatsappConfig.whatsappAssistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: whatsappConfig.whatsappAssistantId,
      tools: [
        {
          type: "function",
          function: {
            name: "validate_dni",
            description: "Valida un DNI y obtiene información del paciente",
            parameters: {
              type: "object",
              properties: {
                dni: {
                  type: "string",
                  description: "Número de DNI a validar",
                },
              },
              required: ["dni"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_especialidades",
            description: "Obtiene la lista de especialidades médicas disponibles",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_turnos",
            description: "Obtiene turnos disponibles para una especialidad",
            parameters: {
              type: "object",
              properties: {
                especialidad_id: {
                  type: "string",
                  description: "ID de la especialidad",
                },
                fecha_desde: {
                  type: "string",
                  description: "Fecha desde (YYYY-MM-DD)",
                },
                fecha_hasta: {
                  type: "string",
                  description: "Fecha hasta (YYYY-MM-DD)",
                },
              },
              required: ["especialidad_id"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "reservar_turno",
            description: "Reserva un turno médico",
            parameters: {
              type: "object",
              properties: {
                paciente_id: {
                  type: "string",
                  description: "ID del paciente",
                },
                turno_id: {
                  type: "string",
                  description: "ID del turno a reservar",
                },
              },
              required: ["paciente_id", "turno_id"],
            },
          },
        },
      ],
    })
    console.log(`[WHATSAPP-PROCESSOR] Run creado: ${run.id}`)

    // Esperar a que el run se complete
    const response = await waitForRunCompletion(run.id, threadId, whatsappConfig.cliente_id)

    // Agregar respuesta del asistente a la conversación
    await addMessageToConversation(conversation.id, "assistant", response)

    console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta: ${response.length} caracteres`)
    return response
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error al procesar mensaje:`, error)
    await logError("whatsapp_processor", error instanceof Error ? error : new Error(String(error)))
    await incrementMetric("whatsapp_processor_errors")

    // Incrementar contador de errores
    await updateWhatsAppStats(whatsappConfig.id, { errors: 1 })

    return "Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta nuevamente en unos momentos."
  }
}

// Función para esperar a que el run se complete
async function waitForRunCompletion(runId: string, threadId: string, clienteId: string): Promise<string> {
  console.log(`[WHATSAPP-PROCESSOR] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Run ID: ${runId}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  const maxAttempts = 60 // 5 minutos máximo
  let attempts = 0

  while (attempts < maxAttempts) {
    attempts++
    console.log(`[WHATSAPP-PROCESSOR] Verificando run ${runId} (intento ${attempts}/${maxAttempts})`)

    try {
      const run = await openai.beta.threads.runs.retrieve(threadId, runId)
      console.log(`[WHATSAPP-PROCESSOR] Estado del run: ${run.status}`)

      if (run.status === "completed") {
        // Obtener los mensajes del thread
        const messages = await openai.beta.threads.messages.list(threadId, {
          order: "desc",
          limit: 1,
        })

        if (messages.data.length > 0) {
          const lastMessage = messages.data[0]
          if (lastMessage.content[0].type === "text") {
            const response = lastMessage.content[0].text.value
            console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta final: ${response.length} caracteres`)
            return response
          }
        }

        return "No se pudo obtener la respuesta del asistente."
      } else if (run.status === "requires_action") {
        console.log(`[WHATSAPP-PROCESSOR] Run requiere acción - procesando tool calls`)
        await handleToolCalls(run, threadId, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WHATSAPP-PROCESSOR] ❌ Run falló con estado: ${run.status}`)
        return "Lo siento, hubo un error al procesar tu solicitud. Por favor, intenta nuevamente."
      }

      // Esperar 5 segundos antes del siguiente intento
      await new Promise((resolve) => setTimeout(resolve, 5000))
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error al verificar run:`, error)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  console.error(`[WHATSAPP-PROCESSOR] ❌ Timeout esperando completación del run`)
  return "Lo siento, la respuesta está tardando más de lo esperado. Por favor, intenta nuevamente."
}

// Función para manejar tool calls
async function handleToolCalls(run: any, threadId: string, clienteId: string): Promise<void> {
  console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO TOOL CALLS ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Cantidad: ${run.required_action.submit_tool_outputs.tool_calls.length}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  const toolOutputs = []

  for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
    console.log(`[WHATSAPP-PROCESSOR] ========== TOOL CALL ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Función: ${toolCall.function.name}`)
    console.log(`[WHATSAPP-PROCESSOR] Argumentos: ${toolCall.function.arguments}`)
    console.log(`[WHATSAPP-PROCESSOR] ================================`)

    let result: any = { error: "Función no implementada" }

    try {
      const args = JSON.parse(toolCall.function.arguments)

      switch (toolCall.function.name) {
        case "validate_dni":
          console.log(`[WHATSAPP-PROCESSOR] 🔍 Validando DNI: ${args.dni} con cliente: ${clienteId}`)
          result = await validateDNI(args.dni, clienteId)
          console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado DNI:`, result)
          break

        case "get_especialidades":
          console.log(`[WHATSAPP-PROCESSOR] 🏥 Obteniendo especialidades para cliente: ${clienteId}`)
          result = await getEspecialidades(clienteId)
          console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado especialidades:`, result)
          break

        case "get_turnos":
          console.log(
            `[WHATSAPP-PROCESSOR] 📅 Obteniendo turnos para especialidad: ${args.especialidad_id} con cliente: ${clienteId}`,
          )
          result = await getTurnos(clienteId, args.especialidad_id, args.fecha_desde, args.fecha_hasta)
          console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado turnos:`, result)
          break

        case "reservar_turno":
          console.log(
            `[WHATSAPP-PROCESSOR] 📝 Reservando turno: ${args.turno_id} para paciente: ${args.paciente_id} con cliente: ${clienteId}`,
          )
          result = await reservarTurno(clienteId, args.paciente_id, args.turno_id)
          console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado reserva:`, result)
          break

        default:
          console.log(`[WHATSAPP-PROCESSOR] ❌ Función desconocida: ${toolCall.function.name}`)
          result = { error: `Función ${toolCall.function.name} no implementada` }
      }
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error ejecutando tool call:`, error)
      result = { error: `Error ejecutando función: ${error instanceof Error ? error.message : String(error)}` }
    }

    toolOutputs.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify(result),
    })

    console.log(`[WHATSAPP-PROCESSOR] ✅ Tool call procesado: ${toolCall.function.name}`)
  }

  console.log(`[WHATSAPP-PROCESSOR] ========== ENVIANDO TOOL OUTPUTS ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Cantidad: ${toolOutputs.length}`)

  try {
    await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
      tool_outputs: toolOutputs,
    })
    console.log(`[WHATSAPP-PROCESSOR] ✅ Tool outputs enviados correctamente`)
  } catch (error) {
    console.error(`[WHATSAPP-PROCESSOR] ❌ Error enviando tool outputs:`, error)
    throw error
  }

  console.log(`[WHATSAPP-PROCESSOR] ================================================`)
}
