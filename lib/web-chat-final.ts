import { validateDNI, searchTurnos, reserveTurno } from "./clinic-api"
import { getArgentinaDateTime } from "./utils/date-utils"

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

// Cache simple para threads web - MEJORADO
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

// Simplificar logs de web chat - solo conversaciones
export async function processWebMessage(params: ProcessWebMessageParams): Promise<string> {
  try {
    const { message, sessionId, config, ip } = params
    console.log(`[WEB-CHAT] 🌐 ${sessionId.slice(-8)}: "${message}"`)
    console.log(`[WEB-CHAT] 🏥 Cliente: ${config.displayName}`)

    if (!sessionId || !message || !config?.widgetAssistantId) {
      throw new Error("Parámetros requeridos faltantes")
    }

    const clienteId = config.cliente_id || ""

    if (!clienteId) {
      console.error(`[WEB-CHAT] ❌ Cliente ID faltante`)
      throw new Error("Cliente ID no configurado")
    }

    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }

    const threadKey = `${cleanSessionId}_${config.id}`

    let threadId = webThreadsCache.get(threadKey)

    if (!threadId) {
      console.log(`[WEB-CHAT] 🔧 Creando thread: ${threadKey}`)
      threadId = await createWebThread(threadKey)
      webThreadsCache.set(threadKey, threadId)
      console.log(`[WEB-CHAT] ✅ Thread creado: ${threadId}`)
    }

    const systemBlock = createSystemBlock(config.displayName)
    const fullMessage = `${systemBlock}\n\n${message}`

    const response = await processMessageWithOpenAI(threadId, fullMessage, config.widgetAssistantId, clienteId)
    console.log(`[WEB-CHAT] 🤖 Respuesta: "${response}"`)

    return response
  } catch (error) {
    console.error("[WEB-CHAT] ❌ Error:", error.message)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

async function createWebThread(identifier: string): Promise<string> {
  try {
    const existingThread = webThreadsCache.get(identifier)
    if (existingThread) {
      return existingThread
    }

    const response = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        metadata: {
          identifier,
          type: "web",
          created_at: new Date().toISOString(),
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Error creating thread: ${response.status} ${response.statusText}`)
    }

    const thread = await response.json()
    webThreadsCache.set(identifier, thread.id)

    return thread.id
  } catch (error) {
    console.error("[WEB-CHAT] ❌ Error creando thread:", error.message)
    throw error
  }
}

async function processMessageWithOpenAI(
  threadId: string,
  message: string,
  widgetAssistantId: string,
  clienteId: string,
): Promise<string> {
  try {
    console.log(`[WEB-CHAT] 🔧 Procesando con OpenAI`)

    // Añadir mensaje al thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    })

    if (!messageResponse.ok) {
      throw new Error(`Error adding message: ${messageResponse.status}`)
    }

    // Crear run
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        assistant_id: widgetAssistantId,
        tools: [
          {
            type: "function",
            function: {
              name: "validate_dni",
              description: "Valida un DNI y obtiene información del paciente",
              parameters: {
                type: "object",
                properties: {
                  dni: { type: "string", description: "DNI a validar" },
                },
                required: ["dni"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "obtener_subespecialidades",
              description: "Lista las subespecialidades disponibles",
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
              name: "buscar_profesionales",
              description: "Busca profesionales por nombre o especialidad",
              parameters: {
                type: "object",
                properties: {
                  busqueda: {
                    type: "string",
                    description: "Texto para buscar profesionales por nombre o especialidad",
                  },
                },
                required: ["busqueda"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_turnos",
              description:
                "Busca turnos disponibles. Si no se especifica rangoFechas, usa fechas actuales automáticamente.",
              parameters: {
                type: "object",
                properties: {
                  rangoFechas: {
                    type: "string",
                    description:
                      "Rango de fechas en formato YYYY-MM-DD a YYYY-MM-DD. Si no se especifica, usa fechas actuales.",
                  },
                  profesional: {
                    type: "string",
                    description: "Nombre del profesional (opcional)",
                  },
                  especialidad: {
                    type: "string",
                    description: "Nombre de la especialidad (opcional)",
                  },
                  profesionalId: {
                    type: "string",
                    description: "ID del profesional (opcional)",
                  },
                },
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "reserve_turno",
              description:
                "Reserva un turno específico para un paciente usando los datos recopilados durante la conversación",
              parameters: {
                type: "object",
                properties: {
                  dni: {
                    type: "string",
                    description: "DNI del paciente",
                  },
                  nombre: {
                    type: "string",
                    description: "Nombre del paciente recopilado durante la conversación",
                  },
                  apellido: {
                    type: "string",
                    description: "Apellido del paciente recopilado durante la conversación",
                  },
                  telefono: {
                    type: "string",
                    description: "Teléfono del paciente recopilado durante la conversación",
                  },
                  email: {
                    type: "string",
                    description: "Email del paciente recopilado durante la conversación",
                  },
                  fecha: {
                    type: "string",
                    description: "Fecha del turno en formato YYYY-MM-DD",
                  },
                  hora: {
                    type: "string",
                    description: "Hora del turno en formato HH:MM",
                  },
                  profesional: {
                    type: "string",
                    description: "Nombre del profesional",
                  },
                  agendaId: {
                    type: "string",
                    description: "ID del turno/agenda a reservar",
                  },
                },
                required: [
                  "dni",
                  "nombre",
                  "apellido",
                  "telefono",
                  "email",
                  "fecha",
                  "hora",
                  "profesional",
                  "agendaId",
                ],
              },
            },
          },
        ],
      }),
    })

    if (!runResponse.ok) {
      throw new Error(`Error creating run: ${runResponse.status}`)
    }

    const runData = await runResponse.json()

    const finalResponse = await waitForRunCompletion(threadId, runData.id, clienteId)
    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT] ❌ Error procesando:", error.message)
    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<string> {
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    try {
      const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!runResponse.ok) {
        throw new Error(`Error checking run: ${runResponse.status}`)
      }

      const run = await runResponse.json()

      if (run.status === "completed") {
        const messagesResponse = await fetch(
          `https://api.openai.com/v1/threads/${threadId}/messages?limit=1&order=desc`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
              "OpenAI-Beta": "assistants=v2",
            },
          },
        )

        if (!messagesResponse.ok) {
          throw new Error(`Error getting messages: ${messagesResponse.status}`)
        }

        const messages = await messagesResponse.json()
        if (messages.data.length > 0) {
          const lastMessage = messages.data[0]
          if (lastMessage.content[0]?.type === "text") {
            const response = lastMessage.content[0].text.value
            return response
          }
        }

        return "Respuesta procesada correctamente."
      } else if (run.status === "requires_action") {
        console.log(`[WEB-CHAT] 🔧 Procesando herramientas`)
        await handleToolCalls(threadId, runId, run, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WEB-CHAT] ❌ Run falló: ${run.status}`)
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`[WEB-CHAT] ❌ Error intento ${attempts + 1}:`, error.message)
      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
}

async function handleToolCalls(threadId: string, runId: string, run: any, clienteId: string): Promise<void> {
  try {
    console.log(`[WEB-CHAT] 🔧 Procesando ${run.required_action.submit_tool_outputs.tool_calls.length} herramientas`)

    const toolOutputs = []

    for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
      console.log(`[WEB-CHAT] 🔧 Ejecutando: ${toolCall.function.name}`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WEB-CHAT] 🔍 Validando DNI: ${args.dni}`)

            try {
              const dniResult = await validateDNI(args.dni, clienteId)
              console.log(`[WEB-CHAT] 📋 DNI resultado:`, dniResult)
              output = JSON.stringify(dniResult)
            } catch (error) {
              console.error(`[WEB-CHAT] ❌ Error DNI:`, error.message)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para gestionar tu turno.",
                fallback: true,
              })
            }
            break

          case "obtener_subespecialidades":
            console.log(`[WEB-CHAT] 📋 Obteniendo subespecialidades`)

            try {
              const { obtenerSubespecialidades } = await import("@/lib/api-tools/api-functions")
              const subespecialidadesResult = await obtenerSubespecialidades(clienteId)
              console.log(`[WEB-CHAT] 📋 Subespecialidades:`, subespecialidadesResult)
              output = JSON.stringify(subespecialidadesResult)
            } catch (error) {
              console.error(`[WEB-CHAT] ❌ Error subespecialidades:`, error.message)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar especialidades.",
                fallback: true,
              })
            }
            break

          case "buscar_profesionales":
            console.log(`[WEB-CHAT] 👨‍⚕️ Buscando profesionales: ${args.busqueda}`)

            try {
              const { buscarProfesionales } = await import("@/lib/api-tools/api-functions")
              const profesionalesResult = await buscarProfesionales(clienteId, args.busqueda || "")
              console.log(`[WEB-CHAT] 📋 Profesionales:`, profesionalesResult)
              output = JSON.stringify(profesionalesResult)
            } catch (error) {
              console.error(`[WEB-CHAT] ❌ Error profesionales:`, error.message)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar profesionales.",
                fallback: true,
              })
            }
            break

          case "search_turnos":
            console.log(`[WEB-CHAT] 📅 Buscando turnos`)

            try {
              let rangoFechas = args.rangoFechas
              if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
                rangoFechas = getDefaultDateRange()
                console.log(`[WEB-CHAT] 📅 Usando fechas dinámicas: ${rangoFechas}`)
              }

              const turnosResult = await searchTurnos(
                {
                  rangoFechas: rangoFechas,
                  profesional: args.profesional,
                  especialidad: args.especialidad,
                  profesionalId: args.profesionalId,
                },
                clienteId,
              )
              console.log(`[WEB-CHAT] 📋 Turnos:`, turnosResult)
              output = JSON.stringify(turnosResult)
            } catch (error) {
              console.error(`[WEB-CHAT] ❌ Error turnos:`, error.message)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar turnos disponibles.",
                fallback: true,
              })
            }
            break

          case "reserve_turno":
            console.log(`[WEB-CHAT] 🎯 Reservando turno`)

            try {
              const reserveResult = await reserveTurno(
                {
                  agendaId: args.agendaId,
                  dni: args.dni,
                  nombre: args.nombre,
                  apellido: args.apellido,
                  telefono: args.telefono,
                  email: args.email,
                  fecha: args.fecha,
                  hora: args.hora,
                  profesional: args.profesional,
                },
                clienteId,
              )
              console.log(`[WEB-CHAT] 📋 Reserva:`, reserveResult)
              output = JSON.stringify(reserveResult)
            } catch (error) {
              console.error(`[WEB-CHAT] ❌ Error reserva:`, error.message)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para reservar tu turno.",
                fallback: true,
              })
            }
            break

          default:
            console.log(`[WEB-CHAT] ❌ Tool call no reconocido: ${toolCall.function.name}`)
            output = JSON.stringify({ error: "Función no disponible" })
        }

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        })

        console.log(`[WEB-CHAT] ✅ Tool procesado: ${toolCall.function.name}`)
      } catch (error) {
        console.error(`[WEB-CHAT] ❌ Error tool ${toolCall.function.name}:`, error.message)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({
            error: "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica.",
            fallback: true,
          }),
        })
      }
    }

    // Enviar tool outputs
    const submitResponse = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          tool_outputs: toolOutputs,
        }),
      },
    )

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text()
      console.error(`[WEB-CHAT] ❌ Error submit: ${submitResponse.status} ${errorText}`)
      throw new Error(`Error submitting tool outputs: ${submitResponse.status}`)
    }

    console.log(`[WEB-CHAT] ✅ Tools enviados`)
  } catch (error) {
    console.error("[WEB-CHAT] ❌ Error handleToolCalls:", error.message)
    throw error
  }
}

export { processWebMessage as processWebChatMessage }
