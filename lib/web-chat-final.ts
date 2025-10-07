import OpenAI from "openai"
import { getWhatsAppConfigByClienteId } from "./db"
import { obtenerDatosSede, formatearDatosSede } from "./api-tools/api-functions"
import { getArgentinaDateTime } from "./utils/date-utils"
import { obtenerObrasSociales, obtenerTurnosDisponibles, reservarTurno } from "./openai-tools"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Función para crear el bloque SISTEMA con datos de sede
async function createSystemBlock(clinicName: string, clienteId?: string, sedeId?: string): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let systemBlock = `[SISTEMA]
Nombre: ${clinicName}
FechaHora: ${fechaHora}
CelularPaciente: No disponible (consulta web)`

  // Si tenemos clienteId y sedeId, obtener datos de sede
  if (clienteId && sedeId) {
    try {
      console.log(`[SISTEMA] 🏥 Obteniendo datos de sede para cliente: ${clienteId}, sede: ${sedeId}`)
      const sedeData = await obtenerDatosSede(clienteId, sedeId)

      if (sedeData && sedeData.success && sedeData.sede) {
        const datosSede = formatearDatosSede(sedeData.sede)
        systemBlock += `\n${datosSede}`
        console.log(`[SISTEMA] ✅ Datos de sede agregados al bloque SISTEMA`)
      } else {
        console.log(`[SISTEMA] ⚠️ No se pudieron obtener datos de sede`)
      }
    } catch (error) {
      console.error(`[SISTEMA] ❌ Error al obtener datos de sede:`, error)
    }
  }

  systemBlock += `\n[/SISTEMA]`

  return systemBlock
}

export async function processWebChatMessage(
  message: string,
  threadId: string,
  clienteId: string,
): Promise<{ response: string; error?: string }> {
  try {
    console.log(`[WEB-CHAT] 💬 Procesando mensaje para cliente: ${clienteId}`)
    console.log(`[WEB-CHAT] Thread ID: ${threadId}`)
    console.log(`[WEB-CHAT] Mensaje: ${message}`)

    // Obtener configuración del cliente
    const config = await getWhatsAppConfigByClienteId(clienteId)
    if (!config) {
      console.error(`[WEB-CHAT] ❌ No se encontró configuración para cliente: ${clienteId}`)
      return {
        response: "Lo siento, no se pudo procesar tu consulta en este momento.",
        error: "Configuración no encontrada",
      }
    }

    console.log(`[WEB-CHAT] ✅ Configuración encontrada: ${config.displayName}`)

    // Crear bloque SISTEMA con datos de sede si están disponibles
    const systemBlock = await createSystemBlock(config.displayName, config.cliente_id, config.sede_id)

    console.log(`[WEB-CHAT] 📋 Bloque SISTEMA creado:`)
    console.log(systemBlock)

    // Agregar el mensaje del usuario al thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: `${systemBlock}\n\n${message}`,
    })

    console.log(`[WEB-CHAT] ✅ Mensaje agregado al thread`)

    // Ejecutar el asistente
    const assistantId = config.widgetAssistantId || config.whatsappAssistantId
    console.log(`[WEB-CHAT] 🤖 Ejecutando asistente: ${assistantId}`)

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      tools: [
        {
          type: "function",
          function: {
            name: "obtener_obras_sociales",
            description: "Obtiene la lista de obras sociales disponibles",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
              },
              required: ["cliente_id"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "obtener_turnos_disponibles",
            description: "Obtiene los turnos disponibles para una especialidad y obra social",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                especialidad_id: {
                  type: "string",
                  description: "ID de la especialidad médica",
                },
                obra_social_id: {
                  type: "string",
                  description: "ID de la obra social",
                },
              },
              required: ["cliente_id", "especialidad_id", "obra_social_id"],
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
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                turno_id: {
                  type: "string",
                  description: "ID del turno a reservar",
                },
                paciente_datos: {
                  type: "object",
                  description: "Datos del paciente",
                  properties: {
                    nombre: { type: "string" },
                    apellido: { type: "string" },
                    dni: { type: "string" },
                    telefono: { type: "string" },
                    email: { type: "string" },
                  },
                  required: ["nombre", "apellido", "dni", "telefono"],
                },
              },
              required: ["cliente_id", "turno_id", "paciente_datos"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "obtener_datos_sede",
            description: "Obtiene información detallada de una sede específica",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                sede_id: {
                  type: "string",
                  description: "ID de la sede",
                },
              },
              required: ["cliente_id", "sede_id"],
            },
          },
        },
      ],
    })

    console.log(`[WEB-CHAT] 🔄 Run creado: ${run.id}`)

    // Esperar a que el run se complete
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
    console.log(`[WEB-CHAT] 📊 Estado inicial del run: ${runStatus.status}`)

    const maxAttempts = 30
    let attempts = 0

    while (runStatus.status === "in_progress" || runStatus.status === "queued") {
      attempts++
      if (attempts > maxAttempts) {
        console.error(`[WEB-CHAT] ❌ Timeout esperando respuesta del asistente`)
        return {
          response: "Lo siento, la consulta está tomando más tiempo del esperado. Por favor, intenta nuevamente.",
          error: "Timeout",
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
      console.log(`[WEB-CHAT] 📊 Estado del run (intento ${attempts}): ${runStatus.status}`)
    }

    // Manejar tool calls si es necesario
    if (runStatus.status === "requires_action") {
      console.log(`[WEB-CHAT] 🔧 Run requiere acción - procesando tool calls`)

      const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || []
      const toolOutputs = []

      for (const toolCall of toolCalls) {
        console.log(`[WEB-CHAT] 🛠️ Ejecutando tool: ${toolCall.function.name}`)

        try {
          const args = JSON.parse(toolCall.function.arguments)
          let result = null

          switch (toolCall.function.name) {
            case "obtener_obras_sociales":
              result = await obtenerObrasSociales(args.cliente_id)
              break
            case "obtener_turnos_disponibles":
              result = await obtenerTurnosDisponibles(args.cliente_id, args.especialidad_id, args.obra_social_id)
              break
            case "reservar_turno":
              result = await reservarTurno(args.cliente_id, args.turno_id, args.paciente_datos)
              break
            case "obtener_datos_sede":
              const sedeData = await obtenerDatosSede(args.cliente_id, args.sede_id)
              result = sedeData ? formatearDatosSede(sedeData.sede) : "No se pudieron obtener los datos de la sede"
              break
            default:
              result = "Función no reconocida"
          }

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: typeof result === "string" ? result : JSON.stringify(result),
          })

          console.log(`[WEB-CHAT] ✅ Tool ${toolCall.function.name} ejecutado exitosamente`)
        } catch (error) {
          console.error(`[WEB-CHAT] ❌ Error ejecutando tool ${toolCall.function.name}:`, error)
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: "Error al ejecutar la función",
          })
        }
      }

      // Enviar los resultados de las tools
      await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
        tool_outputs: toolOutputs,
      })

      // Esperar a que el run se complete después de las tool calls
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
      attempts = 0

      while (runStatus.status === "in_progress" || runStatus.status === "queued") {
        attempts++
        if (attempts > maxAttempts) {
          console.error(`[WEB-CHAT] ❌ Timeout después de tool calls`)
          return {
            response: "Lo siento, la consulta está tomando más tiempo del esperado.",
            error: "Timeout after tool calls",
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
        runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id)
        console.log(`[WEB-CHAT] 📊 Estado post-tools (intento ${attempts}): ${runStatus.status}`)
      }
    }

    if (runStatus.status === "completed") {
      console.log(`[WEB-CHAT] ✅ Run completado exitosamente`)

      // Obtener los mensajes del thread
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length > 0) {
        const lastMessage = messages.data[0]
        if (lastMessage.role === "assistant" && lastMessage.content[0]?.type === "text") {
          const response = lastMessage.content[0].text.value
          console.log(`[WEB-CHAT] 📤 Respuesta del asistente: ${response.substring(0, 100)}...`)
          return { response }
        }
      }

      console.error(`[WEB-CHAT] ❌ No se encontró respuesta del asistente`)
      return {
        response: "Lo siento, no pude generar una respuesta.",
        error: "No assistant response found",
      }
    } else {
      console.error(`[WEB-CHAT] ❌ Run falló con estado: ${runStatus.status}`)
      return {
        response: "Lo siento, ocurrió un error al procesar tu consulta.",
        error: `Run failed with status: ${runStatus.status}`,
      }
    }
  } catch (error) {
    console.error(`[WEB-CHAT] ❌ Error crítico:`, error)
    return {
      response: "Lo siento, ocurrió un error inesperado. Por favor, intenta nuevamente.",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
