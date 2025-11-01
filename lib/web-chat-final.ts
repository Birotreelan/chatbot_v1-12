import { obtenerDatosSede, formatearDatosSede, obtenerSubespecialidades } from "./api-tools/api-functions"
import { getArgentinaDateTime } from "./utils/date-utils"
import {
  obtenerObrasSociales,
  obtenerTurnosDisponibles,
  reservarTurno,
  buscarTurnosDisponiblesHerramienta,
  validarObraSocialHerramienta,
  buscarProfesionalesHerramienta,
  validarDni,
} from "./openai-tools"
import { safelyAddMessageToThread } from "./thread-manager"
import { getThreadForUser } from "./db"
import { openai } from "./openai"

async function createSystemBlock(
  clinicName: string,
  clienteId?: string,
  sedeId?: string,
  escalationPhone?: string,
): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let systemBlock = `[SISTEMA]
Nombre: ${clinicName}
FechaHora: ${fechaHora}
CelularPaciente: No disponible (consulta web)`

  if (escalationPhone) {
    systemBlock += `\nNumeroDerivacion: ${escalationPhone}`
  }

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

export async function processWebChatMessage({
  message,
  sessionId,
  config,
  ip,
  sedeId,
}: {
  message: string
  sessionId: string
  config: any
  ip: string
  sedeId?: string
}): Promise<{ response: string; error?: string }> {
  try {
    const clienteId = config.cliente_id

    console.log(`[WEB-CHAT] 💬 Procesando mensaje para cliente: ${clienteId}`)
    console.log(`[WEB-CHAT] Session ID: ${sessionId}`)
    console.log(`[WEB-CHAT] Mensaje: ${message}`)
    console.log(`[WEB-CHAT] Sede ID recibido:`, sedeId)

    if (!config) {
      console.error(`[WEB-CHAT] ❌ No se encontró configuración para cliente: ${clienteId}`)
      return {
        response: "Lo siento, no se pudo procesar tu consulta en este momento.",
        error: "Configuración no encontrada",
      }
    }

    console.log(`[WEB-CHAT] ✅ Configuración encontrada: ${config.displayName}`)

    console.log(`[WEB-CHAT] 🔍 Obteniendo thread para sessionId: ${sessionId}, configId: ${config.id}`)
    const threadResult = await getThreadForUser(sessionId, config.id)

    console.log(`[WEB-CHAT] 📋 Thread result completo:`, JSON.stringify(threadResult, null, 2))

    if (!threadResult) {
      console.error(`[WEB-CHAT] ❌ getThreadForUser devolvió null/undefined`)
      return {
        response: "Lo siento, ocurrió un error al iniciar la conversación.",
        error: "ThreadResult es null",
      }
    }

    if (!threadResult.threadId) {
      console.error(`[WEB-CHAT] ❌ threadResult.threadId es undefined`)
      console.error(`[WEB-CHAT] threadResult keys:`, Object.keys(threadResult))
      console.error(`[WEB-CHAT] threadResult values:`, Object.values(threadResult))
      return {
        response: "Lo siento, ocurrió un error al iniciar la conversación.",
        error: "ThreadId no disponible en threadResult",
      }
    }

    const threadId = threadResult.threadId

    if (typeof threadId !== "string" || !threadId.startsWith("thread_")) {
      console.error(`[WEB-CHAT] ❌ ThreadId tiene formato inválido: ${threadId} (tipo: ${typeof threadId})`)
      return {
        response: "Lo siento, ocurrió un error al iniciar la conversación.",
        error: `ThreadId inválido: ${threadId}`,
      }
    }

    console.log(`[WEB-CHAT] 🧵 Thread obtenido: ${threadId}`)
    console.log(`[WEB-CHAT] - Es nuevo: ${threadResult.isNewThread}`)
    console.log(`[WEB-CHAT] - Es reseteado: ${threadResult.isResetThread || false}`)

    const effectiveSedeId = sedeId || config.sede_id
    console.log(`[WEB-CHAT] Sede ID efectivo:`, effectiveSedeId, sedeId ? "(del request)" : "(del config)")

    const systemBlock = await createSystemBlock(
      config.displayName,
      config.cliente_id,
      effectiveSedeId,
      config.escalationPhoneNumber,
    )

    console.log(`[WEB-CHAT] 📋 Bloque SISTEMA creado:`)
    console.log(systemBlock)

    await safelyAddMessageToThread(threadId, {
      role: "user",
      content: `${systemBlock}\n\n${message}`,
    })

    console.log(`[WEB-CHAT] ✅ Mensaje agregado al thread`)

    const assistantId = config.widgetAssistantId || config.whatsappAssistantId
    console.log(`[WEB-CHAT] 🤖 Ejecutando asistente: ${assistantId}`)

    const validThreadId = threadId
    console.log(`[WEB-CHAT] 🔍 ThreadId almacenado en const: ${validThreadId}`)

    const run = await openai.beta.threads.runs.create(validThreadId, {
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
            name: "obtener_subespecialidades",
            description: "Obtiene la lista de especialidades médicas disponibles",
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
            name: "buscar_turnos_disponibles",
            description: "Busca turnos disponibles según criterios flexibles",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                rango_fechas: {
                  type: "string",
                  description: "Rango de fechas en formato 'YYYY-MM-DD a YYYY-MM-DD'",
                },
                profesional: {
                  type: "string",
                  description: "Nombre del profesional (opcional)",
                },
                especialidad: {
                  type: "string",
                  description: "Nombre de la especialidad (opcional)",
                },
                profesional_id: {
                  type: "string",
                  description: "ID del profesional (opcional)",
                },
              },
              required: ["cliente_id", "rango_fechas"],
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
        {
          type: "function",
          function: {
            name: "validar_obra_social",
            description: "Valida y busca una obra social por nombre",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                busqueda: {
                  type: "string",
                  description: "Nombre de la obra social a buscar",
                },
              },
              required: ["cliente_id", "busqueda"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "buscar_profesionales",
            description: "Busca profesionales médicos según un criterio",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                busqueda: {
                  type: "string",
                  description: "Criterio de búsqueda",
                },
              },
              required: ["cliente_id", "busqueda"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "validar_dni",
            description: "Valida el DNI de un paciente",
            parameters: {
              type: "object",
              properties: {
                cliente_id: {
                  type: "string",
                  description: "ID del cliente",
                },
                dni: {
                  type: "string",
                  description: "DNI del paciente",
                },
              },
              required: ["cliente_id", "dni"],
            },
          },
        },
      ],
    })

    console.log(`[WEB-CHAT] 🔄 Run creado: ${run.id}`)

    console.log(`[WEB-CHAT] 🔍 Llamando retrieve con runId: ${run.id}, thread_id: ${validThreadId}`)
    let runStatus = await openai.beta.threads.runs.retrieve(run.id, {
      thread_id: validThreadId,
    })

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
      runStatus = await openai.beta.threads.runs.retrieve(run.id, {
        thread_id: validThreadId,
      })
      console.log(`[WEB-CHAT] 📊 Estado del run (intento ${attempts}): ${runStatus.status}`)
    }

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
            case "obtener_subespecialidades":
              const subespecialidadesResult = await obtenerSubespecialidades(args.cliente_id)
              result = subespecialidadesResult.exito
                ? JSON.stringify({
                    exito: true,
                    especialidades: subespecialidadesResult.datos,
                    total: subespecialidadesResult.datos?.length || 0,
                  })
                : JSON.stringify({ exito: false, mensaje: "No se encontraron especialidades" })
              break
            case "obtener_turnos_disponibles":
              result = await obtenerTurnosDisponibles(args.cliente_id, args.especialidad_id, args.obra_social_id)
              break
            case "buscar_turnos_disponibles":
              result = await buscarTurnosDisponiblesHerramienta(
                args.cliente_id,
                args.rango_fechas,
                args.profesional,
                args.especialidad,
                args.profesional_id,
              )
              break
            case "reservar_turno":
              result = await reservarTurno(args.cliente_id, args.turno_id, args.paciente_datos)
              break
            case "obtener_datos_sede":
              const sedeData = await obtenerDatosSede(args.cliente_id, args.sede_id)
              result = sedeData ? formatearDatosSede(sedeData.sede) : "No se pudieron obtener los datos de la sede"
              break
            case "validar_obra_social":
              result = await validarObraSocialHerramienta(args.cliente_id, args.busqueda)
              break
            case "buscar_profesionales":
              result = await buscarProfesionalesHerramienta(args.cliente_id, args.busqueda)
              break
            case "validar_dni":
              result = await validarDni(args.cliente_id, args.dni)
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

      await openai.beta.threads.runs.submitToolOutputs(run.id, {
        thread_id: validThreadId,
        tool_outputs: toolOutputs,
      })

      runStatus = await openai.beta.threads.runs.retrieve(run.id, {
        thread_id: validThreadId,
      })
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
        runStatus = await openai.beta.threads.runs.retrieve(run.id, {
          thread_id: validThreadId,
        })
        console.log(`[WEB-CHAT] 📊 Estado post-tools (intento ${attempts}): ${runStatus.status}`)
      }
    }

    if (runStatus.status === "completed") {
      console.log(`[WEB-CHAT] ✅ Run completado exitosamente`)

      const messages = await openai.beta.threads.messages.list(validThreadId, {
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
