import OpenAI from "openai"
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
import { getThreadForUser, createThread } from "./thread-manager"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Función para crear el bloque SISTEMA con datos de sede
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

    const effectiveSedeId = sedeId || config.sede_id
    console.log(`[WEB-CHAT] Sede ID efectivo:`, effectiveSedeId, sedeId ? "(del request)" : "(del config)")

    let threadData
    let threadId: string

    try {
      threadData = await getThreadForUser(sessionId, config.id)
      threadId = threadData.thread_id
      console.log(`[WEB-CHAT] ✅ Thread existente recuperado: ${threadId}`)
    } catch (error) {
      console.log(`[WEB-CHAT] 📝 Creando nuevo thread para session: ${sessionId}`)
      threadData = await createThread(sessionId, config.id)
      threadId = threadData.thread_id
      console.log(`[WEB-CHAT] ✅ Thread creado: ${threadId}`)
    }

    // Validar que threadId no sea undefined
    if (!threadId) {
      console.error(`[WEB-CHAT] ❌ Error crítico: threadId is undefined`)
      console.error(`[WEB-CHAT] threadData:`, JSON.stringify(threadData))
      throw new Error("Thread ID is undefined")
    }

    console.log(`[WEB-CHAT] 🔍 Thread ID validado: ${threadId} (tipo: ${typeof threadId})`)

    const systemBlock = await createSystemBlock(
      config.displayName,
      config.cliente_id,
      effectiveSedeId,
      config.escalationPhoneNumber,
    )

    console.log(`[WEB-CHAT] 📋 Bloque SISTEMA creado:`)
    console.log(systemBlock)

    console.log(`[WEB-CHAT] 📝 Agregando mensaje al thread: ${threadId}`)
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: `${systemBlock}\n\n${message}`,
    })

    console.log(`[WEB-CHAT] ✅ Mensaje agregado al thread`)

    const assistantId = config.widgetAssistantId || config.whatsappAssistantId
    console.log(`[WEB-CHAT] 🤖 Ejecutando asistente: ${assistantId}`)

    console.log(`[WEB-CHAT] 🔧 Creando run en thread: ${threadId}`)
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
              properties: {},
              required: [],
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
              properties: {},
              required: [],
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
                especialidad_id: {
                  type: "string",
                  description: "ID de la especialidad médica",
                },
                obra_social_id: {
                  type: "string",
                  description: "ID de la obra social",
                },
              },
              required: ["especialidad_id", "obra_social_id"],
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
              required: ["rango_fechas"],
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
              required: ["turno_id", "paciente_datos"],
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
                sede_id: {
                  type: "string",
                  description: "ID de la sede",
                },
              },
              required: ["sede_id"],
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
                busqueda: {
                  type: "string",
                  description: "Nombre de la obra social a buscar",
                },
              },
              required: ["busqueda"],
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
                busqueda: {
                  type: "string",
                  description: "Criterio de búsqueda",
                },
              },
              required: ["busqueda"],
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
                dni: {
                  type: "string",
                  description: "DNI del paciente",
                },
              },
              required: ["dni"],
            },
          },
        },
      ],
    })

    console.log(`[WEB-CHAT] 🔄 Run creado: ${run.id}`)

    console.log(
      `[v0] BEFORE RETRIEVE - threadId: "${threadId}" (type: ${typeof threadId}), run.id: "${run.id}" (type: ${typeof run.id})`,
    )
    if (!threadId || threadId === "undefined") {
      throw new Error(`Invalid threadId before retrieve: ${threadId}`)
    }

    let runStatus = await openai.beta.threads.runs.retrieve(run.id, {
      thread_id: threadId,
    })
    console.log(`[WEB-CHAT] 📊 Estado inicial del run: ${runStatus.status}`)

    const maxAttempts = 30
    let attempts = 0

    const maxToolRounds = 10 // Máximo de rondas de tool execution para evitar loops infinitos
    let toolRound = 0

    while (toolRound < maxToolRounds) {
      // Esperar a que el run complete o requiera acción
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
          thread_id: threadId,
        })
        console.log(`[WEB-CHAT] 📊 Estado del run (intento ${attempts}): ${runStatus.status}`)
      }

      // Si el run está completado, salir del loop
      if (runStatus.status === "completed") {
        console.log(`[WEB-CHAT] ✅ Run completado exitosamente`)
        break
      }

      // Si el run requiere acción, procesar tool calls
      if (runStatus.status === "requires_action") {
        toolRound++
        console.log(`[WEB-CHAT] 🔧 Run requiere acción - procesando tool calls (ronda ${toolRound})`)

        const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || []
        const toolOutputs = []

        for (const toolCall of toolCalls) {
          console.log(`[WEB-CHAT] 🛠️ Ejecutando tool: ${toolCall.function.name}`)

          try {
            const args = JSON.parse(toolCall.function.arguments)
            let result = null

            switch (toolCall.function.name) {
              case "obtener_obras_sociales":
                result = await obtenerObrasSociales(clienteId)
                break
              case "obtener_subespecialidades":
                const subespecialidadesResult = await obtenerSubespecialidades(clienteId)
                result = subespecialidadesResult.exito
                  ? JSON.stringify({
                      exito: true,
                      especialidades: subespecialidadesResult.datos,
                      total: subespecialidadesResult.datos?.length || 0,
                    })
                  : JSON.stringify({ exito: false, mensaje: "No se encontraron especialidades" })
                break
              case "obtener_turnos_disponibles":
                result = await obtenerTurnosDisponibles(clienteId, args.especialidad_id, args.obra_social_id)
                break
              case "buscar_turnos_disponibles":
                result = await buscarTurnosDisponiblesHerramienta(
                  clienteId,
                  args.rango_fechas,
                  args.profesional,
                  args.especialidad,
                  args.profesional_id,
                )
                break
              case "reservar_turno":
                result = await reservarTurno(clienteId, args.turno_id, args.paciente_datos)
                break
              case "obtener_datos_sede":
                const sedeData = await obtenerDatosSede(clienteId, args.sede_id)
                result = sedeData ? formatearDatosSede(sedeData.sede) : "No se pudieron obtener los datos de la sede"
                break
              case "validar_obra_social":
                result = await validarObraSocialHerramienta(clienteId, args.busqueda)
                break
              case "buscar_profesionales":
                result = await buscarProfesionalesHerramienta(clienteId, args.busqueda)
                break
              case "validar_dni":
                result = await validarDni(clienteId, args.dni)
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

        // Enviar los resultados de los tools
        await openai.beta.threads.runs.submitToolOutputs(run.id, {
          thread_id: threadId,
          tool_outputs: toolOutputs,
        })

        // Obtener el nuevo estado después de enviar los tool outputs
        runStatus = await openai.beta.threads.runs.retrieve(run.id, {
          thread_id: threadId,
        })

        // Resetear el contador de intentos para la siguiente ronda
        attempts = 0
        console.log(`[WEB-CHAT] 📊 Estado después de tool outputs (ronda ${toolRound}): ${runStatus.status}`)

        // Continuar el loop para procesar más tool calls si es necesario
        continue
      }

      // Si el run falló o tiene otro estado, salir del loop
      console.error(`[WEB-CHAT] ❌ Run falló con estado: ${runStatus.status}`)
      return {
        response: "Lo siento, ocurrió un error al procesar tu consulta.",
        error: `Run failed with status: ${runStatus.status}`,
      }
    }

    // Si llegamos aquí después del loop de tool rounds, verificar si completó
    if (toolRound >= maxToolRounds) {
      console.error(`[WEB-CHAT] ❌ Demasiadas rondas de tool execution (${toolRound})`)
      return {
        response: "Lo siento, la consulta requirió demasiadas operaciones. Por favor, reformula tu pregunta.",
        error: "Too many tool rounds",
      }
    }

    if (runStatus.status === "completed") {
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
