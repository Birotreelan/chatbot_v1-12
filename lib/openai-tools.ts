import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { logError } from "@/lib/monitoring"
import {
  buscarPaciente,
  obtenerSubespecialidades,
  buscarProfesionales,
  obtenerTurnos,
  reservarTurno,
  validarObraSocial,
} from "./api-tools/api-functions"

// Definición de las herramientas
export const openAITools = [
  {
    type: "function" as const,
    function: {
      name: "validar_dni",
      description: "Valida DNI del paciente.",
      parameters: {
        type: "object",
        properties: {
          dni: {
            type: "string",
            description: "Número de DNI del paciente, compuesto solo por dígitos. Por ejemplo: 12345678",
          },
        },
        required: ["dni"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_turnos_disponibles",
      description: "Busca turnos disponibles.",
      parameters: {
        type: "object",
        properties: {
          profesional: {
            type: "string",
            description: "Nombre del profesional (opcional)",
          },
          profesional_id: {
            type: "string",
            description: "ID del profesional (opcional, tiene prioridad sobre el nombre)",
          },
          especialidad: {
            type: "string",
            description: "Nombre de la especialidad (opcional)",
          },
          fecha_desde: {
            type: "string",
            description: "Fecha desde en formato YYYY-MM-DD",
          },
          fecha_hasta: {
            type: "string",
            description: "Fecha hasta en formato YYYY-MM-DD",
          },
        },
        required: ["fecha_desde", "fecha_hasta"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reservar_turno",
      description: "Reserva el turno seleccionado usando los datos del paciente recopilados durante la conversación.",
      parameters: {
        type: "object",
        properties: {
          agenda_id: {
            type: "string",
            description: "ID de la agenda",
          },
          paciente_dni: {
            type: "string",
            description: "DNI del paciente",
          },
          paciente_nombre: {
            type: "string",
            description: "Nombre del paciente",
          },
          paciente_apellido: {
            type: "string",
            description: "Apellido del paciente",
          },
          paciente_telefono: {
            type: "string",
            description: "Teléfono del paciente",
          },
          paciente_email: {
            type: "string",
            description: "Email del paciente",
          },
          paciente_fecha_nac: {
            type: "string",
            description: "Fecha de nacimiento del paciente en formato YYYY-MM-DD",
          },
          paciente_direccion: {
            type: "string",
            description: "Dirección del paciente",
          },
          paciente_localidad: {
            type: "string",
            description: "Localidad del paciente",
          },
          paciente_provincia: {
            type: "string",
            description: "Provincia del paciente",
          },
          paciente_sexo: {
            type: "string",
            description: "Sexo del paciente",
          },
          paciente_tipo_doc: {
            type: "string",
            description: "Tipo de documento del paciente",
          },
          deudor_id: {
            type: "string",
            description: "ID de la obra social",
          },
          plan_id: {
            type: "string",
            description: "ID del plan de la obra social",
          },
          nro_afiliado: {
            type: "string",
            description: "Número de afiliado del paciente",
          },
          turno_motivo: {
            type: "string",
            description: "Motivo del turno",
          },
          comentarios: {
            type: "string",
            description: "Comentarios adicionales",
          },
        },
        required: ["agenda_id", "paciente_dni", "paciente_telefono", "paciente_email"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "obtener_subespecialidades",
      description: "Lista subespecialidades.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "buscar_profesionales",
      description: "Busca profesionales.",
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
    type: "function" as const,
    function: {
      name: "validar_obra_social",
      description: "Valida si la obra social ingresada por el paciente existe y permite turnos online.",
      parameters: {
        type: "object",
        properties: {
          busqueda: {
            type: "string",
            description: "Nombre de la obra social ingresado por el paciente (ej: 'osde')",
          },
        },
        required: ["busqueda"],
      },
    },
  },
]

// Función para procesar mensajes individuales (para compatibilidad)
export async function processIndividualMessage(
  message: string,
  phoneNumberId: string,
  userPhoneNumber: string,
  assistantId?: string,
) {
  console.log(`[OPENAI] 📱 Procesando mensaje para ${userPhoneNumber}`)

  try {
    // Obtener la configuración
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    // Crear o obtener thread
    const { getThread } = await import("@/lib/thread-manager")
    const thread = await getThread(userPhoneNumber, config.id)

    // Procesar con el asistente
    const result = await getAssistantResponse(
      thread.id,
      message,
      phoneNumberId,
      assistantId || config.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
    )

    return result
  } catch (error) {
    console.error("[OPENAI] ❌ Error en processIndividualMessage:", error)
    await logError("process_individual_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para truncar respuestas largas de herramientas
function truncateToolResponse(response: any, maxLength = 1000): any {
  const responseStr = JSON.stringify(response)
  const originalLength = responseStr.length

  if (responseStr.length <= maxLength) {
    return response
  }

  console.log(`[OPENAI] ✂️ Truncando respuesta: ${originalLength} → ${maxLength} chars`)

  // Si es un objeto con datos, truncar los datos
  if (response.exito && response.datos) {
    if (Array.isArray(response.datos)) {
      const originalCount = response.datos.length
      const truncatedData = response.datos.slice(0, 40)
      const truncatedResponse = {
        ...response,
        datos: truncatedData,
        _truncated: true,
        _originalLength: response.datos.length,
      }

      console.log(`[OPENAI] ✂️ Array truncado: ${originalCount} → ${truncatedData.length} elementos`)
      return truncatedResponse
    }
  }

  // Fallback: truncar el string completo
  const truncatedString = responseStr.substring(0, maxLength - 100) + "... [TRUNCADO]"
  return {
    exito: false,
    datos: truncatedString,
    _truncated: true,
    _originalLength: originalLength,
  }
}

// Función específica para web que NO envía mensajes a WhatsApp
export async function processWebOnlyMessage(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
  console.log(`[OPENAI] 🌐 Procesando mensaje web (NO WhatsApp)`)

  const openai = getOpenAIClient()

  try {
    // Añadir el mensaje al thread
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    // Crear un run con el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    // Procesar el run SIN enviar a WhatsApp
    await processWebRunOnly(openai, threadId, run.id, clienteId)

    // Obtener la respuesta
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

    console.log(`[OPENAI] ✅ Respuesta web obtenida (${messageContent.length} chars)`)
    return messageContent
  } catch (error) {
    console.error("[OPENAI] ❌ Error web:", error)
    throw error
  }
}

// Función para procesar run web sin enviar a WhatsApp
async function processWebRunOnly(openai: OpenAI, threadId: string, runId: string, clienteId: string): Promise<void> {
  let run = await openai.beta.threads.runs.retrieve(threadId, runId)

  while (run.status === "queued" || run.status === "in_progress") {
    await wait(1000)
    run = await openai.beta.threads.runs.retrieve(threadId, runId)
  }

  if (run.status === "requires_action") {
    if (run.required_action?.type === "submit_tool_outputs") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls
      const toolOutputs = []

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        const toolResult = await executeFunction(functionName, functionArgs, clienteId)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(toolResult),
        })
      }

      await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs,
      })

      // Continuar procesando
      await processWebRunOnly(openai, threadId, runId, clienteId)
    }
  } else if (run.status === "failed") {
    throw new Error(`Run falló: ${run.last_error?.message}`)
  }
}

// Tiempo máximo de espera para la respuesta de OpenAI (en milisegundos)
const OPENAI_TIMEOUT = Number.parseInt(process.env.OPENAI_TIMEOUT || "60000", 10)

// Número máximo de reintentos
const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || "3", 10)

// Tiempo de espera entre reintentos (en milisegundos)
const RETRY_DELAY = Number.parseInt(process.env.RETRY_DELAY || "2000", 10)

// Función para obtener una instancia de OpenAI
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

// Función para esperar un tiempo determinado
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Función principal para obtener respuesta del asistente
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.OPENAI_ASSISTANT_ID!,
): Promise<string> {
  console.log(`[OPENAI] 🤖 Thread: ${threadId.slice(-8)}`)
  console.log(`[OPENAI] 📝 Mensaje: "${message.substring(0, 80)}${message.length > 80 ? "..." : ""}"`)

  const openai = getOpenAIClient()

  try {
    // Obtener configuración para el cliente_id
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (config) {
      console.log(`[OPENAI] ⚙️ Config: ${config.displayName} | Cliente: ${config.cliente_id}`)
    }

    // Añadir el mensaje del usuario al thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })
    console.log(`[OPENAI] 📤 Mensaje enviado`)

    // Ejecutar el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })
    console.log(`[OPENAI] 🏃 Run: ${run.id.slice(-8)}`)

    // Esperar a que el asistente complete la ejecución
    const runStatus = await waitForRunCompletion(threadId, run.id, phoneNumberId)

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

    console.log(`[OPENAI] 💬 Respuesta: "${responseText.substring(0, 80)}${responseText.length > 80 ? "..." : ""}"`)

    // Enviar respuesta a WhatsApp
    if (config) {
      await sendWhatsAppMessage(
        phoneNumberId,
        config.accessToken,
        message.match(/PacienteCelular: (\d+)/)?.[1] || "",
        responseText,
      )
      console.log(`[OPENAI] 📱 Enviado a WhatsApp`)
    }

    console.log(`[OPENAI] ✅ Conversación completada`)
    return responseText
  } catch (error) {
    console.error(`[OPENAI] ❌ Error:`, error)
    return "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde."
  }
}

// Función para esperar a que se complete la ejecución del asistente
async function waitForRunCompletion(
  threadId: string,
  runId: string,
  phoneNumberId: string,
): Promise<OpenAI.Beta.Threads.Runs.Run> {
  const startTime = Date.now()
  let pollCount = 0

  while (Date.now() - startTime < OPENAI_TIMEOUT) {
    const runStatus = await getOpenAIClient().beta.threads.runs.retrieve(threadId, runId)
    pollCount++

    switch (runStatus.status) {
      case "completed":
        console.log(`[OPENAI] 🏁 Completado en ${Date.now() - startTime}ms (${pollCount} polls)`)
        if (runStatus.usage) {
          console.log(
            `[OPENAI] 💰 Tokens: ${runStatus.usage.total_tokens} (${runStatus.usage.prompt_tokens}+${runStatus.usage.completion_tokens})`,
          )
        }
        return runStatus

      case "failed":
        console.error(`[OPENAI] ❌ Run falló: ${runStatus.last_error?.message}`)
        throw new Error(`Run failed: ${runStatus.last_error?.message || "Unknown error"}`)

      case "expired":
        console.error(`[OPENAI] ⏰ Run expiró`)
        throw new Error("La ejecución del asistente expiró")

      case "cancelled":
        console.error(`[OPENAI] 🚫 Run cancelado`)
        throw new Error("La ejecución del asistente fue cancelada")

      case "requires_action":
        console.log(`[OPENAI] 🔧 Ejecutando herramientas`)
        const toolOutputs = await handleRequiredActions(runStatus, phoneNumberId)

        await getOpenAIClient().beta.threads.runs.submitToolOutputs(threadId, runId, {
          tool_outputs: toolOutputs,
        })
        console.log(`[OPENAI] 📤 Resultados enviados`)
        break

      default:
        // Para estados como "queued", "in_progress", etc.
        if (pollCount === 1) {
          console.log(`[OPENAI] ⏳ Esperando respuesta...`)
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.error(`[OPENAI] ⏰ Timeout después de ${OPENAI_TIMEOUT}ms`)
  throw new Error("Se agotó el tiempo de espera para la respuesta del asistente")
}

// Función para manejar las acciones requeridas (herramientas)
async function handleRequiredActions(
  runStatus: OpenAI.Beta.Threads.Runs.Run,
  phoneNumberId: string,
): Promise<OpenAI.Beta.Threads.Runs.RunSubmitToolOutputsParams.ToolOutput[]> {
  const toolOutputs: OpenAI.Beta.Threads.Runs.RunSubmitToolOutputsParams.ToolOutput[] = []

  if (runStatus.required_action?.type === "submit_tool_outputs") {
    const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls
    console.log(`[OPENAI] 🔧 ${toolCalls.length} herramientas a ejecutar`)

    for (const toolCall of toolCalls) {
      console.log(`[OPENAI] 🔧 Ejecutando: ${toolCall.function.name}`)

      try {
        // Enviar mensaje de espera al usuario
        const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
        if (config && config.lastUserPhoneNumber) {
          let waitMessage = "Aguardá unos instantes mientras procesamos tu solicitud."

          // Mensajes específicos por función
          if (toolCall.function.name === "validar_dni") {
            waitMessage = "Aguardá unos instantes mientras validamos tu DNI."
          } else if (toolCall.function.name === "validar_obra_social") {
            waitMessage = "Aguardá unos instantes mientras validamos tu obra social."
          } else if (toolCall.function.name === "buscar_turnos_disponibles") {
            waitMessage = "Aguardá unos instantes mientras buscamos turnos disponibles."
          } else if (toolCall.function.name === "reservar_turno") {
            waitMessage = "Aguardá unos instantes mientras reservamos tu turno."
          }

          await sendWhatsAppMessage(phoneNumberId, config.accessToken, config.lastUserPhoneNumber, waitMessage)
          console.log(`[OPENAI] ⏳ Mensaje de espera enviado`)
        }

        const result = await executeFunction(toolCall.function.name, toolCall.function.arguments, phoneNumberId)
        console.log(`[OPENAI] ✅ ${toolCall.function.name} completado`)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(result),
        })
      } catch (error) {
        console.error(`[OPENAI] ❌ Error en ${toolCall.function.name}:`, error)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({
            exito: false,
            error: {
              codigo: "TOOL_ERROR",
              mensaje: error instanceof Error ? error.message : "Error desconocido",
            },
          }),
        })
      }
    }
  }

  return toolOutputs
}

// Función para ejecutar las funciones de herramientas
async function executeFunction(functionName: string, argumentsStr: string, phoneNumberId: string): Promise<any> {
  let args
  try {
    args = JSON.parse(argumentsStr)
  } catch (error) {
    throw new Error(`Argumentos inválidos: ${argumentsStr}`)
  }

  // Obtener el cliente_id de la configuración
  const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
  if (!config || !config.cliente_id) {
    throw new Error("No se pudo obtener el cliente_id de la configuración")
  }

  const clienteId = config.cliente_id
  console.log(`[TOOL] 🔧 ${functionName}(${JSON.stringify(args)})`)

  switch (functionName) {
    case "validar_dni":
      if (!args.dni) {
        throw new Error("DNI es requerido")
      }
      return await buscarPaciente(clienteId, { dni: args.dni })

    case "validar_obra_social":
      if (!args.busqueda) {
        throw new Error("Búsqueda es requerida")
      }
      return await validarObraSocial(clienteId, args.busqueda)

    case "obtener_subespecialidades":
      return await obtenerSubespecialidades(clienteId)

    case "buscar_profesionales":
      if (!args.busqueda) {
        throw new Error("Búsqueda es requerida")
      }
      return await buscarProfesionales(clienteId, args.busqueda)

    case "buscar_turnos_disponibles":
      if (!args.fecha_desde || !args.fecha_hasta) {
        throw new Error("Fechas desde y hasta son requeridas")
      }
      return await obtenerTurnos(clienteId, args.fecha_desde, args.fecha_hasta, args.profesional_id, args.paciente_dni)

    case "reservar_turno":
      if (!args.agenda_id || !args.paciente_telefono || !args.paciente_email) {
        throw new Error("agenda_id, paciente_telefono y paciente_email son requeridos")
      }
      return await reservarTurno(clienteId, args.agenda_id, {
        nombre: args.paciente_nombre,
        apellido: args.paciente_apellido,
        dni: args.paciente_dni,
        telefono: args.paciente_telefono,
        email: args.paciente_email,
        fechaNacimiento: args.paciente_fecha_nac,
        direccion: args.paciente_direccion,
        localidad: args.paciente_localidad,
        provincia: args.paciente_provincia,
        sexo: args.paciente_sexo,
        tipoDoc: args.paciente_tipo_doc,
        deudorId: args.deudor_id,
        planId: args.plan_id,
        nroAfiliado: args.nro_afiliado,
        turnoMotivo: args.turno_motivo,
        comentarios: args.comentarios,
      })

    default:
      throw new Error(`Función no reconocida: ${functionName}`)
  }
}
