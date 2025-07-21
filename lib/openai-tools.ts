// lib/openai-tools.ts

import { fetchProxyApi } from "./fetch-proxy-api"
import OpenAI from "openai"
import { sendWhatsAppMessage } from "./whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "./db"

// Handlers for each tool
async function handleValidateDNI(args: any, clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 validate_dni(${JSON.stringify(args)})`)

  try {
    const { buscarPaciente } = await import("@/lib/api-tools/api-functions")
    const result = await buscarPaciente(clienteId, { dni: args.dni })
    console.log(`[TOOL] ✅ validate_dni completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en validate_dni:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_VALIDACION_DNI",
        mensaje: error instanceof Error ? error.message : "Error al validar DNI",
      },
    })
  }
}

async function handleObtenerSubespecialidades(clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 obtener_subespecialidades()`)

  try {
    const { obtenerSubespecialidades } = await import("@/lib/api-tools/api-functions")
    const result = await obtenerSubespecialidades(clienteId)
    console.log(`[TOOL] ✅ obtener_subespecialidades completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en obtener_subespecialidades:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_SUBESPECIALIDADES",
        mensaje: error instanceof Error ? error.message : "Error al obtener subespecialidades",
      },
    })
  }
}

async function handleBuscarProfesionales(args: any, clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 buscar_profesionales(${JSON.stringify(args)})`)

  try {
    const { buscarProfesionales } = await import("@/lib/api-tools/api-functions")
    const result = await buscarProfesionales(clienteId, args.busqueda || "")
    console.log(`[TOOL] ✅ buscar_profesionales completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en buscar_profesionales:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_BUSCAR_PROFESIONALES",
        mensaje: error instanceof Error ? error.message : "Error al buscar profesionales",
      },
    })
  }
}

async function handleValidarObraSocial(args: any, clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 validar_obra_social(${JSON.stringify(args)})`)

  try {
    const { validarObraSocial } = await import("@/lib/api-tools/api-functions")
    const result = await validarObraSocial(clienteId, args.busqueda || "")
    console.log(`[TOOL] ✅ validar_obra_social completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en validar_obra_social:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_VALIDAR_OBRA_SOCIAL",
        mensaje: error instanceof Error ? error.message : "Error al validar obra social",
      },
    })
  }
}

async function handleSearchTurnos(args: any, clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 search_turnos(${JSON.stringify(args)})`)

  try {
    // Function helper to get dynamic date range
    function getDefaultDateRange(): string {
      const today = new Date()
      const nextWeek = new Date(today)
      nextWeek.setDate(today.getDate() + 7)

      const formatDate = (date: Date): string => {
        return date.toISOString().split("T")[0] // YYYY-MM-DD
      }

      return `${formatDate(today)} a ${formatDate(nextWeek)}`
    }

    // If no date range or it's a past date, use dynamic dates
    let rangoFechas = args.rangoFechas
    if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
      rangoFechas = getDefaultDateRange()
      console.log(`[TOOL] 📅 Usando fechas dinámicas: ${rangoFechas}`)
    }

    const { obtenerTurnos, buscarProfesionales } = await import("@/lib/api-tools/api-functions")

    // Extract start and end dates from range
    const fechas = rangoFechas.split(" a ")
    const fechaDesde = fechas[0]?.trim()
    const fechaHasta = fechas[1]?.trim() || fechaDesde

    // If we have the professional ID, use it directly
    if (args.profesionalId) {
      const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta, args.profesionalId)
      console.log(`[TOOL] ✅ search_turnos completado`)
      return JSON.stringify(result)
    }

    // If we have the professional name or specialty, first search for the professional
    if (args.profesional || args.especialidad) {
      const busqueda = args.profesional || args.especialidad || ""
      const profesionalesResponse = await buscarProfesionales(clienteId, busqueda)

      if (!profesionalesResponse.exito || !profesionalesResponse.datos || profesionalesResponse.datos.length === 0) {
        console.log(`[TOOL] ✅ search_turnos completado (sin profesionales)`)
        return JSON.stringify({
          exito: false,
          error: {
            codigo: "PROFESIONAL_NO_ENCONTRADO",
            mensaje: `No se encontraron profesionales con el criterio: ${busqueda}`,
          },
        })
      }

      // If there are multiple professionals, return the list for user selection
      if (profesionalesResponse.datos.length > 1) {
        console.log(`[TOOL] ✅ search_turnos completado (múltiples profesionales)`)
        return JSON.stringify({
          exito: true,
          datos: {
            multiple: true,
            profesionales: profesionalesResponse.datos,
            mensaje: "Se encontraron múltiples profesionales. Por favor, seleccione uno.",
          },
        })
      }

      // If only one professional is found, use their ID to search for turns
      const profesionalEncontrado = profesionalesResponse.datos[0]
      const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta, profesionalEncontrado.id)
      console.log(`[TOOL] ✅ search_turnos completado`)
      return JSON.stringify(result)
    }

    // If no professional or specialty is provided, search for all available turns
    const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta)
    console.log(`[TOOL] ✅ search_turnos completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en search_turnos:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_BUSCAR_TURNOS",
        mensaje: error instanceof Error ? error.message : "Error al buscar turnos",
      },
    })
  }
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Maximum wait time for assistant execution (in milliseconds)
const MAX_WAIT_TIME = 60000 // 60 seconds
const POLLING_INTERVAL = 1000 // 1 second

/**
 * Get response from OpenAI Assistant
 */
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.OPENAI_ASSISTANT_ID!,
): Promise<string> {
  console.log("[OPENAI] 🤖 Iniciando conversación")
  console.log(`[OPENAI] 📝 Mensaje: "${message.substring(0, 100)}..."`)

  try {
    // Get configuration using phoneNumberId
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[OPENAI] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }
    console.log(`[OPENAI] ⚙️ Config: ${config.displayName} | Cliente: ${config.cliente_id}`)

    // Add user message to thread
    console.log(`[OPENAI] 📤 Mensaje enviado a thread ${threadId}`)
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    // Create run with tools
    console.log(`[OPENAI] 🏃 Creando run con asistente ${assistantId}`)
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      tools: [
        {
          type: "function",
          function: {
            name: "buscar_turnos_disponibles",
            description: "Busca turnos disponibles en la agenda médica",
            parameters: {
              type: "object",
              properties: {
                dni: {
                  type: "string",
                  description: "DNI del paciente",
                },
                nombre: {
                  type: "string",
                  description: "Nombre del paciente",
                },
                apellido: {
                  type: "string",
                  description: "Apellido del paciente",
                },
                telefono: {
                  type: "string",
                  description: "Teléfono del paciente",
                },
                email: {
                  type: "string",
                  description: "Email del paciente",
                },
              },
              required: ["dni"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "reservar_turno",
            description: "Reserva un turno específico",
            parameters: {
              type: "object",
              properties: {
                dni: {
                  type: "string",
                  description: "DNI del paciente",
                },
                nombre: {
                  type: "string",
                  description: "Nombre del paciente",
                },
                apellido: {
                  type: "string",
                  description: "Apellido del paciente",
                },
                telefono: {
                  type: "string",
                  description: "Teléfono del paciente",
                },
                email: {
                  type: "string",
                  description: "Email del paciente",
                },
                Agenda_Id: {
                  type: "string",
                  description: "ID de la agenda del turno a reservar",
                },
              },
              required: ["dni", "nombre", "apellido", "telefono", "email", "Agenda_Id"],
            },
          },
        },
      ],
    })

    const startTime = Date.now()
    console.log(`[OPENAI] 🏃 Run creado: ${run.id}`)

    // Wait for run completion
    const completedRun = await waitForRunCompletion(threadId, run.id, phoneNumberId)
    const executionTime = Date.now() - startTime
    console.log(`[OPENAI] ⏱️ Run completado en ${executionTime}ms`)

    console.log(`[OPENAI] 🏁 Run completado: ${completedRun.status}`)

    // Get the latest messages
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    // Get assistant response
    const assistantMessage = messages.data.find((msg) => msg.role === "assistant")

    if (!assistantMessage) {
      throw new Error("No se encontró respuesta del asistente")
    }

    // Extract text from response
    let responseText = ""
    for (const content of assistantMessage.content) {
      if (content.type === "text") {
        responseText += content.text.value
      }
    }

    // Log token usage if available
    if (completedRun.usage) {
      console.log(
        `[OPENAI] 💰 Tokens: ${completedRun.usage.total_tokens} (${completedRun.usage.prompt_tokens}+${completedRun.usage.completion_tokens})`,
      )
    }

    console.log(`[OPENAI] 💬 Respuesta: "${responseText.substring(0, 100)}..."`)

    // Send response via WhatsApp
    const configByPhone = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (configByPhone && responseText.trim()) {
      const userPhoneNumber = configByPhone.lastUserPhoneNumber
      if (userPhoneNumber) {
        await sendWhatsAppMessage(phoneNumberId, configByPhone.accessToken, userPhoneNumber, responseText)
        console.log("[OPENAI] 📱 Enviado a WhatsApp")
      }
    }

    console.log("[OPENAI] ✅ Conversación completada")
    return responseText
  } catch (error) {
    console.error("[OPENAI] ❌ Error al obtener respuesta del asistente:", error)
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
  }
}

/**
 * Wait for run completion with tool handling
 */
async function waitForRunCompletion(
  threadId: string,
  runId: string,
  phoneNumberId: string,
): Promise<OpenAI.Beta.Threads.Runs.Run> {
  const startTime = Date.now()
  let pollCount = 0

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    pollCount++
    const runStatus = await openai.beta.threads.runs.retrieve(threadId, runId)

    switch (runStatus.status) {
      case "completed":
        console.log(`[OPENAI] ⏱️ Run completado en ${Date.now() - startTime}ms (${pollCount} polls)`)
        return runStatus

      case "failed":
        throw new Error(`Run failed: ${runStatus.last_error?.message || "Unknown error"}`)

      case "expired":
        throw new Error("La ejecución del asistente expiró")

      case "cancelled":
        throw new Error("La ejecución del asistente fue cancelada")

      case "requires_action":
        console.log("[OPENAI] 🔧 Ejecutando herramientas")
        await handleRequiredActions(threadId, runId, runStatus, phoneNumberId)
        break

      default:
        // For states like "queued", "in_progress", etc., keep waiting
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
    }
  }

  throw new Error("Se agotó el tiempo de espera para la respuesta del asistente")
}

/**
 * Handle required actions (tool calls)
 */
async function handleRequiredActions(
  threadId: string,
  runId: string,
  runStatus: OpenAI.Beta.Threads.Runs.Run,
  phoneNumberId: string,
) {
  if (!runStatus.required_action?.submit_tool_outputs?.tool_calls) {
    return
  }

  const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls
  console.log(`[OPENAI] 🔧 ${toolCalls.length} herramientas a ejecutar`)

  const toolOutputs = []

  for (const toolCall of toolCalls) {
    console.log(`[OPENAI] 🔧 Ejecutando: ${toolCall.function.name}`)

    try {
      let result: any

      switch (toolCall.function.name) {
        case "buscar_turnos_disponibles":
          result = await handleBuscarTurnos(toolCall.function.arguments, phoneNumberId)
          break
        case "reservar_turno":
          result = await handleReservarTurno(toolCall.function.arguments, phoneNumberId)
          break
        default:
          result = { error: `Función desconocida: ${toolCall.function.name}` }
      }

      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify(result),
      })

      console.log(`[OPENAI] ✅ ${toolCall.function.name} completado`)
    } catch (error) {
      console.error(`[OPENAI] ❌ Error en ${toolCall.function.name}:`, error)
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({ error: error.message }),
      })
    }
  }

  // Submit tool outputs
  console.log("[OPENAI] 📤 Resultados enviados a OpenAI")
  await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
    tool_outputs: toolOutputs,
  })
}

/**
 * Handle buscar_turnos_disponibles tool call
 */
async function handleBuscarTurnos(argumentsStr: string, phoneNumberId: string) {
  console.log(`[TOOL] 🔧 buscar_turnos_disponibles(${argumentsStr})`)

  const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
  if (!config) {
    throw new Error("Configuración no encontrada")
  }

  const args = JSON.parse(argumentsStr)

  const payload = {
    action: "get_turnos",
    Cliente_Id: config.cliente_id,
    Phone_Number_Id: phoneNumberId,
    dni: args.dni,
    nombre: args.nombre,
    apellido: args.apellido,
    telefono: args.telefono,
    email: args.email,
  }

  return await fetchProxyApi(config.proxy, payload)
}

/**
 * Handle reservar_turno tool call
 */
async function handleReservarTurno(argumentsStr: string, phoneNumberId: string) {
  console.log(`[TOOL] 🔧 reservar_turno(${argumentsStr})`)

  // Send waiting message first
  const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
  if (!config) {
    throw new Error("Configuración no encontrada")
  }

  if (config.lastUserPhoneNumber) {
    await sendWhatsAppMessage(
      phoneNumberId,
      config.accessToken,
      config.lastUserPhoneNumber,
      "Realizando reserva de turno. aguardá unos instantes.",
    )
    console.log("[OPENAI] ⏳ Mensaje de espera enviado")
  }

  const args = JSON.parse(argumentsStr)

  const payload = {
    action: "set_turno",
    Cliente_Id: config.cliente_id,
    Phone_Number_Id: phoneNumberId,
    dni: args.dni,
    nombre: args.nombre,
    apellido: args.apellido,
    telefono: args.telefono,
    email: args.email,
    Agenda_Id: args.Agenda_Id, // Using correct capitalization
  }

  return await fetchProxyApi(config.proxy, payload)
}
