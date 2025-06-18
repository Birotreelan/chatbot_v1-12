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

// Cache simple para threads web
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

export async function processWebMessage(params: ProcessWebMessageParams): Promise<string> {
  try {
    const { message, sessionId, config, ip } = params
    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO MENSAJE WEB ==========`)
    console.log(`[WEB-CHAT-FINAL] Session ID: ${sessionId}`)
    console.log(`[WEB-CHAT-FINAL] Cliente: ${config.displayName}`)
    console.log(`[WEB-CHAT-FINAL] Cliente ID: ${config.id}`)
    console.log(`[WEB-CHAT-FINAL] IP: ${ip}`)
    console.log(`[WEB-CHAT-FINAL] Mensaje: ${message}`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)

    // Validar parámetros
    if (!sessionId || !message || !config?.widgetAssistantId) {
      throw new Error("Parámetros requeridos faltantes")
    }

    // Obtener cliente_id de la configuración - IMPORTANTE: Usar el cliente_id específico si existe
    const clienteId = config.cliente_id || ""

    if (!clienteId) {
      console.error(`[WEB-CHAT-FINAL] ❌ Cliente ID faltante en configuración`)
      throw new Error("Cliente ID no configurado")
    }

    // Limpiar sessionId
    let cleanSessionId = sessionId
    while (cleanSessionId.startsWith("web_")) {
      cleanSessionId = cleanSessionId.substring(4)
    }

    const threadKey = `${cleanSessionId}_${config.id}`
    console.log(`[WEB-CHAT-FINAL] Thread key: ${threadKey}`)

    // Obtener o crear thread
    let threadId = webThreadsCache.get(threadKey)
    if (!threadId) {
      threadId = await createWebThread(threadKey)
      webThreadsCache.set(threadKey, threadId)
    }

    console.log(`[WEB-CHAT-FINAL] 🌐 Usando thread: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] 🚫 GARANTÍA: NO se enviará a WhatsApp`)

    // Crear el mensaje con bloque [SISTEMA]
    const systemBlock = createSystemBlock(config.displayName)
    const fullMessage = `${systemBlock}\n\n${message}`

    console.log(`[WEB-CHAT-FINAL] 📋 Bloque [SISTEMA] creado:`)
    console.log(systemBlock)

    // Procesar mensaje
    const response = await processMessageWithOpenAI(threadId, fullMessage, config.widgetAssistantId, clienteId)
    console.log(`[WEB-CHAT-FINAL] ✅ Respuesta: ${response.length} caracteres`)

    return response
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error:", error)
    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

async function createWebThread(identifier: string): Promise<string> {
  try {
    console.log(`[WEB-CHAT-FINAL] Creando thread para: ${identifier}`)

    const response = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
        "Content-Type": "application/json",
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
    console.log(`[WEB-CHAT-FINAL] Thread creado: ${thread.id}`)
    return thread.id
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error creando thread:", error)
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
    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO CON OPENAI ==========`)
    console.log(`[WEB-CHAT-FINAL] Thread ID: ${threadId}`)
    console.log(`[WEB-CHAT-FINAL] Assistant ID: ${widgetAssistantId}`)
    console.log(`[WEB-CHAT-FINAL] Cliente ID: ${clienteId}`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)

    // 1. Añadir mensaje al thread
    console.log(`[WEB-CHAT-FINAL] Añadiendo mensaje al thread: ${threadId}`)
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

    const messageData = await messageResponse.json()
    console.log(`[WEB-CHAT-FINAL] Mensaje añadido: ${messageData.id}`)

    // 2. Crear run
    console.log(`[WEB-CHAT-FINAL] Creando run con assistant: ${widgetAssistantId}`)
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
    console.log(`[WEB-CHAT-FINAL] Run creado: ${runData.id}`)

    // 3. Esperar completación
    const finalResponse = await waitForRunCompletion(threadId, runData.id, clienteId)
    return finalResponse
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] Error procesando mensaje:", error)
    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<string> {
  let attempts = 0
  const maxAttempts = 30

  console.log(`[WEB-CHAT-FINAL] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[WEB-CHAT-FINAL] Run ID: ${runId}`)
  console.log(`[WEB-CHAT-FINAL] Cliente ID: ${clienteId}`)
  console.log(`[WEB-CHAT-FINAL] ================================================`)

  while (attempts < maxAttempts) {
    try {
      console.log(`[WEB-CHAT-FINAL] Verificando run ${runId} (intento ${attempts + 1}/${maxAttempts})`)

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
      console.log(`[WEB-CHAT-FINAL] Estado del run: ${run.status}`)

      if (run.status === "completed") {
        // Obtener mensajes
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

            console.log(`[WEB-CHAT-FINAL] ✅ Respuesta final: ${response.length} caracteres`)
            return response
          }
        }

        return "Respuesta procesada correctamente."
      } else if (run.status === "requires_action") {
        console.log(`[WEB-CHAT-FINAL] Run requiere acción - procesando tool calls`)
        await handleToolCalls(threadId, runId, run, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WEB-CHAT-FINAL] Run falló con estado: ${run.status}`)
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`[WEB-CHAT-FINAL] Error en intento ${attempts + 1}:`, error)
      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
}

async function handleToolCalls(threadId: string, runId: string, run: any, clienteId: string): Promise<void> {
  try {
    console.log(`[WEB-CHAT-FINAL] ========== PROCESANDO TOOL CALLS ==========`)
    console.log(`[WEB-CHAT-FINAL] Cantidad: ${run.required_action.submit_tool_outputs.tool_calls.length}`)
    console.log(`[WEB-CHAT-FINAL] Cliente ID: ${clienteId}`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)

    const toolOutputs = []

    for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
      console.log(`[WEB-CHAT-FINAL] ========== TOOL CALL ==========`)
      console.log(`[WEB-CHAT-FINAL] Función: ${toolCall.function.name}`)
      console.log(`[WEB-CHAT-FINAL] Argumentos: ${toolCall.function.arguments}`)
      console.log(`[WEB-CHAT-FINAL] ================================`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WEB-CHAT-FINAL] 🔍 Validando DNI: ${args.dni} con cliente: ${clienteId}`)

            // Verificar si la API externa está disponible
            try {
              const dniResult = await validateDNI(args.dni, clienteId)
              console.log(`[WEB-CHAT-FINAL] 📋 Resultado DNI:`, dniResult)
              output = JSON.stringify(dniResult)
            } catch (error) {
              console.error(`[WEB-CHAT-FINAL] ❌ Error validando DNI:`, error)
              // Respuesta de fallback cuando la API externa no está disponible
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para gestionar tu turno.",
                fallback: true,
              })
            }
            break

          case "obtener_subespecialidades":
            console.log(`[WEB-CHAT-FINAL] 📋 Obteniendo subespecialidades con cliente: ${clienteId}`)

            try {
              // Importar la función desde api-tools
              const { obtenerSubespecialidades } = await import("@/lib/api-tools/api-functions")
              const subespecialidadesResult = await obtenerSubespecialidades(clienteId)
              console.log(`[WEB-CHAT-FINAL] 📋 Resultado subespecialidades:`, subespecialidadesResult)
              output = JSON.stringify(subespecialidadesResult)
            } catch (error) {
              console.error(`[WEB-CHAT-FINAL] ❌ Error obteniendo subespecialidades:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar especialidades.",
                fallback: true,
              })
            }
            break

          case "buscar_profesionales":
            console.log(`[WEB-CHAT-FINAL] 👨‍⚕️ Buscando profesionales con cliente: ${clienteId}`)
            console.log(`[WEB-CHAT-FINAL] 📋 Búsqueda: ${args.busqueda}`)

            try {
              // Importar la función desde api-tools
              const { buscarProfesionales } = await import("@/lib/api-tools/api-functions")
              const profesionalesResult = await buscarProfesionales(clienteId, args.busqueda || "")
              console.log(`[WEB-CHAT-FINAL] 📋 Resultado profesionales:`, profesionalesResult)
              output = JSON.stringify(profesionalesResult)
            } catch (error) {
              console.error(`[WEB-CHAT-FINAL] ❌ Error buscando profesionales:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar profesionales.",
                fallback: true,
              })
            }
            break

          case "search_turnos":
            console.log(`[WEB-CHAT-FINAL] 📅 Buscando turnos con cliente: ${clienteId}`)
            console.log(`[WEB-CHAT-FINAL] 📋 Parámetros:`, args)

            try {
              // Si no hay rangoFechas o es una fecha del pasado, usar fechas dinámicas
              let rangoFechas = args.rangoFechas
              if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
                rangoFechas = getDefaultDateRange()
                console.log(`[WEB-CHAT-FINAL] 📅 Usando fechas dinámicas: ${rangoFechas}`)
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
              console.log(`[WEB-CHAT-FINAL] 📋 Resultado turnos:`, turnosResult)
              output = JSON.stringify(turnosResult)
            } catch (error) {
              console.error(`[WEB-CHAT-FINAL] ❌ Error buscando turnos:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar turnos disponibles.",
                fallback: true,
              })
            }
            break

          case "reserve_turno":
            console.log(`[WEB-CHAT-FINAL] 🎯 Reservando turno con cliente: ${clienteId}`)
            console.log(`[WEB-CHAT-FINAL] 📋 Datos de reserva:`, args)

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
              console.log(`[WEB-CHAT-FINAL] 📋 Resultado reserva:`, reserveResult)
              output = JSON.stringify(reserveResult)
            } catch (error) {
              console.error(`[WEB-CHAT-FINAL] ❌ Error reservando turno:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para reservar tu turno.",
                fallback: true,
              })
            }
            break

          default:
            console.log(`[WEB-CHAT-FINAL] ❌ Tool call no reconocido: ${toolCall.function.name}`)
            output = JSON.stringify({ error: "Función no disponible" })
        }

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        })

        console.log(`[WEB-CHAT-FINAL] ✅ Tool call procesado: ${toolCall.function.name}`)
      } catch (error) {
        console.error(`[WEB-CHAT-FINAL] ❌ Error en tool call ${toolCall.function.name}:`, error)
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
    console.log(`[WEB-CHAT-FINAL] ========== ENVIANDO TOOL OUTPUTS ==========`)
    console.log(`[WEB-CHAT-FINAL] Cantidad: ${toolOutputs.length}`)

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
      console.error(`[WEB-CHAT-FINAL] ❌ Error submitting tool outputs: ${submitResponse.status} ${errorText}`)
      throw new Error(`Error submitting tool outputs: ${submitResponse.status}`)
    }

    console.log(`[WEB-CHAT-FINAL] ✅ Tool outputs enviados correctamente`)
    console.log(`[WEB-CHAT-FINAL] ================================================`)
  } catch (error) {
    console.error("[WEB-CHAT-FINAL] ❌ Error en handleToolCalls:", error)
    throw error
  }
}

export { processWebMessage as processWebChatMessage }
