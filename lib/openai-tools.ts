// lib/openai-tools.ts

import { fetchProxyApi } from "./fetch-proxy-api"
import OpenAI from "openai"
import { sendWhatsAppMessage } from "./whatsapp-api"
import { getWhatsAppConfigById } from "./db"
import { logError } from "./monitoring"

// Inicializar el cliente de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Tiempo máximo de espera para la ejecución del asistente (en milisegundos)
const MAX_WAIT_TIME = 60000 // 60 segundos
const POLLING_INTERVAL = 1000 // 1 segundo

export async function runTool(clienteId: string, name: string, args: any): Promise<string> {
  switch (name) {
    case "get_agenda":
      console.log(`[TOOL] 🔧 get_agenda(${JSON.stringify(args)})`)
      try {
        const result = await fetchProxyApi(clienteId, "get_agenda", args)
        console.log(`[TOOL] ✅ get_agenda completado:`, result)
        return JSON.stringify(result)
      } catch (error) {
        console.error(`[TOOL] ❌ Error en get_agenda:`, error)
        return JSON.stringify({
          exito: false,
          error: {
            codigo: "ERROR_AGENDA",
            mensaje: error instanceof Error ? error.message : "Error al obtener agenda",
          },
        })
      }
    case "reservar_turno":
      console.log(`[TOOL] 🔧 reservar_turno(${JSON.stringify(args)})`)

      try {
        const reserveParams = {
          Agenda_Id: args.agendaId, // Cambiar de agendaId a Agenda_Id
          Paciente_DNI: args.dni,
          Paciente_Nombre: args.nombre,
          Paciente_Apellido: args.apellido,
          Paciente_Telefono: args.telefono,
          Paciente_Email: args.email,
          // Agregar campos adicionales si están disponibles
          ...(args.fecha && { Fecha: args.fecha }),
          ...(args.hora && { Hora: args.hora }),
          ...(args.profesionalId && { Profesional_Id: args.profesionalId }),
        }

        console.log(`[TOOL] 📋 Parámetros de reserva:`, reserveParams)

        const result = await fetchProxyApi(clienteId, "set_turno", reserveParams)
        console.log(`[TOOL] ✅ reservar_turno completado:`, result)
        return JSON.stringify(result)
      } catch (error) {
        console.error(`[TOOL] ❌ Error en reservar_turno:`, error)
        return JSON.stringify({
          exito: false,
          error: {
            codigo: "ERROR_RESERVA",
            mensaje: error instanceof Error ? error.message : "Error al reservar turno",
          },
        })
      }
    default:
      return JSON.stringify({
        exito: false,
        error: {
          codigo: "ERROR_TOOL_NO_ENCONTRADA",
          mensaje: `Herramienta '${name}' no encontrada`,
        },
      })
  }
}

// Función para obtener respuesta del asistente con herramientas
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.OPENAI_ASSISTANT_ID!,
): Promise<string> {
  console.log("[OPENAI] 🤖 Iniciando conversación")
  console.log(`[OPENAI] 📝 Mensaje: "${message.substring(0, 100)}..."`)

  try {
    // Obtener configuración para el cliente_id
    const config = await getWhatsAppConfigById(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    const clienteId = config.cliente_id
    console.log(`[OPENAI] ⚙️ Config: ${config.displayName} | Cliente: ${clienteId}`)

    // Añadir el mensaje del usuario al thread
    console.log(`[OPENAI] 📤 Mensaje enviado a thread ${threadId}`)
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[OPENAI] 🏃 Run creado: ${run.id}`)

    // Esperar a que el asistente complete la ejecución
    const startTime = Date.now()
    const runStatus = await waitForRunCompletion(threadId, run.id, phoneNumberId, clienteId)
    const duration = Date.now() - startTime

    console.log(`[OPENAI] ⏱️ Run completado en ${duration}ms`)

    // Obtener los mensajes más recientes
    const messages = await openai.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 1,
    })

    // Obtener la respuesta del asistente
    const assistantMessage = messages.data.find((msg) => msg.role === "assistant")

    if (!assistantMessage) {
      throw new Error("No se encontró respuesta del asistente")
    }

    // Extraer el texto de la respuesta
    let responseText = ""
    for (const content of assistantMessage.content) {
      if (content.type === "text") {
        responseText += content.text.value
      }
    }

    console.log(`[OPENAI] 💬 Respuesta: "${responseText.substring(0, 100)}..."`)

    // Enviar respuesta por WhatsApp
    const whatsappConfig = await getWhatsAppConfigById(phoneNumberId)
    if (whatsappConfig) {
      const userPhoneNumber = whatsappConfig.lastUserPhoneNumber
      if (userPhoneNumber) {
        await sendWhatsAppMessage(phoneNumberId, whatsappConfig.accessToken, userPhoneNumber, responseText)
        console.log("[OPENAI] 📱 Enviado a WhatsApp")
      }
    }

    console.log("[OPENAI] ✅ Conversación completada")
    return responseText
  } catch (error) {
    console.error("[OPENAI] ❌ Error al obtener respuesta del asistente:", error)
    await logError("openai_assistant", error instanceof Error ? error : new Error(String(error)))
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
  }
}

// Función para esperar a que se complete la ejecución del asistente
async function waitForRunCompletion(
  threadId: string,
  runId: string,
  phoneNumberId: string,
  clienteId: string,
): Promise<OpenAI.Beta.Threads.Runs.Run> {
  const startTime = Date.now()
  let pollCount = 0

  while (Date.now() - startTime < MAX_WAIT_TIME) {
    pollCount++
    const runStatus = await openai.beta.threads.runs.retrieve(threadId, runId)

    switch (runStatus.status) {
      case "completed":
        console.log(`[OPENAI] 🏁 Run completado: ${runStatus.status}`)
        if (runStatus.usage) {
          console.log(
            `[OPENAI] 💰 Tokens: ${runStatus.usage.total_tokens} (${runStatus.usage.prompt_tokens}+${runStatus.usage.completion_tokens})`,
          )
        }
        console.log(`[OPENAI] ⏱️ Run completado en ${Date.now() - startTime}ms (${pollCount} polls)`)
        return runStatus

      case "failed":
        console.error(`[OPENAI] ❌ Run falló: ${runStatus.last_error?.message || "Unknown error"}`)
        throw new Error(`Run failed: ${runStatus.last_error?.message || "Unknown error"}`)

      case "expired":
        console.error("[OPENAI] ❌ Run expiró")
        throw new Error("La ejecución del asistente expiró")

      case "cancelled":
        console.error("[OPENAI] ❌ Run cancelado")
        throw new Error("La ejecución del asistente fue cancelada")

      case "requires_action":
        console.log("[OPENAI] 🔧 Ejecutando herramientas")
        await handleRequiredAction(threadId, runId, runStatus, phoneNumberId, clienteId)
        break

      default:
        // Para estados como "queued", "in_progress", etc., seguimos esperando
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL))
    }
  }

  // Si llegamos aquí, significa que se agotó el tiempo de espera
  throw new Error("Se agotó el tiempo de espera para la respuesta del asistente")
}

// Función para manejar acciones requeridas (tool calls)
async function handleRequiredAction(
  threadId: string,
  runId: string,
  run: OpenAI.Beta.Threads.Runs.Run,
  phoneNumberId: string,
  clienteId: string,
): Promise<void> {
  if (!run.required_action || run.required_action.type !== "submit_tool_outputs") {
    return
  }

  const toolCalls = run.required_action.submit_tool_outputs.tool_calls
  console.log(`[OPENAI] 🔧 ${toolCalls.length} herramientas a ejecutar`)

  const toolOutputs: OpenAI.Beta.Threads.Runs.RunSubmitToolOutputsParams.ToolOutput[] = []

  // Enviar mensaje de espera al usuario si hay herramientas que ejecutar
  if (toolCalls.length > 0) {
    const config = await getWhatsAppConfigById(phoneNumberId)
    if (config && config.lastUserPhoneNumber) {
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        config.lastUserPhoneNumber,
        "Realizando reserva de turno. aguardá unos instantes.",
      )
      console.log("[OPENAI] ⏳ Mensaje de espera enviado")
    }
  }

  for (const toolCall of toolCalls) {
    console.log(`[OPENAI] 🔧 Ejecutando: ${toolCall.function.name}`)

    try {
      const args = JSON.parse(toolCall.function.arguments)
      let result: string

      switch (toolCall.function.name) {
        case "validate_dni":
          result = await handleValidateDNI(args, clienteId)
          break

        case "obtener_subespecialidades":
          result = await handleObtenerSubespecialidades(clienteId)
          break

        case "buscar_profesionales":
          result = await handleBuscarProfesionales(args, clienteId)
          break

        case "validar_obra_social":
          result = await handleValidarObraSocial(args, clienteId)
          break

        case "search_turnos":
          result = await handleSearchTurnos(args, clienteId)
          break

        case "reservar_turno":
          result = await handleReservarTurno(args, clienteId)
          break

        default:
          console.log(`[OPENAI] ❌ Herramienta no reconocida: ${toolCall.function.name}`)
          result = JSON.stringify({ error: "Función no disponible" })
      }

      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: result,
      })

      console.log(`[OPENAI] ✅ ${toolCall.function.name} completado`)
    } catch (error) {
      console.error(`[OPENAI] ❌ Error ejecutando ${toolCall.function.name}:`, error)
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({
          error: "Error interno del servidor",
          message: error instanceof Error ? error.message : "Error desconocido",
        }),
      })
    }
  }

  // Enviar los resultados de las herramientas
  console.log("[OPENAI] 📤 Resultados enviados a OpenAI")
  await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
    tool_outputs: toolOutputs,
  })
}

// Handlers para cada herramienta
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

    // Si no hay rangoFechas o es una fecha del pasado, usar fechas dinámicas
    let rangoFechas = args.rangoFechas
    if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
      rangoFechas = getDefaultDateRange()
      console.log(`[TOOL] 📅 Usando fechas dinámicas: ${rangoFechas}`)
    }

    const { obtenerTurnos, buscarProfesionales } = await import("@/lib/api-tools/api-functions")

    // Extraer fechas desde y hasta del rango
    const fechas = rangoFechas.split(" a ")
    const fechaDesde = fechas[0]?.trim()
    const fechaHasta = fechas[1]?.trim() || fechaDesde

    // Si tenemos el ID del profesional, usarlo directamente
    if (args.profesionalId) {
      const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta, args.profesionalId)
      console.log(`[TOOL] ✅ search_turnos completado`)
      return JSON.stringify(result)
    }

    // Si tenemos el nombre del profesional o especialidad, primero buscar el profesional
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

      // Si hay múltiples profesionales, devolver la lista para que el usuario elija
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

      // Si solo hay un profesional, usar su ID para buscar turnos
      const profesionalEncontrado = profesionalesResponse.datos[0]
      const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta, profesionalEncontrado.id)
      console.log(`[TOOL] ✅ search_turnos completado`)
      return JSON.stringify(result)
    }

    // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
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

async function handleReservarTurno(args: any, clienteId: string): Promise<string> {
  console.log(`[TOOL] 🔧 reservar_turno(${JSON.stringify(args)})`)

  try {
    const reserveParams = {
      Agenda_Id: args.agendaId, // Usar Agenda_Id con mayúscula
      Paciente_DNI: args.dni,
      Paciente_Nombre: args.nombre,
      Paciente_Apellido: args.apellido,
      Paciente_Telefono: args.telefono,
      Paciente_Email: args.email,
      // Agregar campos adicionales si están disponibles
      ...(args.fecha && { Fecha: args.fecha }),
      ...(args.hora && { Hora: args.hora }),
      ...(args.profesionalId && { Profesional_Id: args.profesionalId }),
    }

    console.log(`[TOOL] 📋 Parámetros de reserva:`, reserveParams)
    console.log(`[PROXY] 📤 POST set_turno → ${process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL}`)

    const result = await fetchProxyApi(clienteId, "set_turno", reserveParams)
    console.log(`[PROXY] 📥 ${result.exito ? "✅" : "❌"} ${JSON.stringify(result).substring(0, 200)}`)
    console.log(`[TOOL] ✅ reservar_turno completado`)
    return JSON.stringify(result)
  } catch (error) {
    console.error(`[TOOL] ❌ Error en reservar_turno:`, error)
    return JSON.stringify({
      exito: false,
      error: {
        codigo: "ERROR_RESERVA",
        mensaje: error instanceof Error ? error.message : "Error al reservar turno",
      },
    })
  }
}
