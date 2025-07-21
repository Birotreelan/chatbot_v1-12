import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { incrementMetric, logError } from "@/lib/monitoring"

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
          rango_fechas: {
            type: "string",
            description: "Rango de fechas en formato YYYY-MM-DD a YYYY-MM-DD",
          },
        },
        required: [],
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
        },
        required: ["dni", "nombre", "apellido", "telefono", "email", "fecha", "hora", "profesional"],
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

// Mensajes predefinidos para cada función
const FUNCTION_MESSAGES = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  validar_obra_social: "Verificando la obra social, aguardá unos instantes.",
  default: "Estoy procesando tu solicitud, dame un momento por favor.",
}

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
    exito: response.exito || false,
    datos: truncatedString,
    _truncated: true,
    _originalLength: originalLength,
  }
}

// Implementación directa de todas las funciones
export async function executeOpenAITool(
  toolName: string,
  toolArgs: Record<string, any>,
  clienteId?: string,
): Promise<any> {
  const proxy = "https://treelan.net/managment/proxy_service/"

  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "No se ha configurado un ID de cliente",
      },
    }
  }

  const proxyUrl = proxy.endsWith("/") ? proxy : `${proxy}/`

  try {
    console.log(`[TOOL] 🔧 ${toolName}(${JSON.stringify(toolArgs)})`)

    // Preparar el cuerpo de la solicitud según la función
    const requestBody: Record<string, any> = {
      Cliente_Id: clienteId.trim(),
      Action: "",
    }

    switch (toolName) {
      case "validar_dni":
        requestBody.Action = "get_paciente"
        requestBody.dni = toolArgs.dni
        break

      case "obtener_subespecialidades":
        requestBody.Action = "get_subespecialidades"
        break

      case "buscar_profesionales":
        requestBody.Action = "get_profesionales"
        requestBody.busqueda = toolArgs.busqueda || ""
        break

      case "validar_obra_social":
        requestBody.Action = "get_obras_sociales"
        requestBody.busqueda = toolArgs.busqueda || ""
        break

      case "buscar_turnos_disponibles":
        requestBody.Action = "get_turnos"
        // Extraer fechas desde y hasta del rango
        if (toolArgs.rango_fechas) {
          let fechaDesde, fechaHasta
          if (toolArgs.rango_fechas.includes(" a ")) {
            ;[fechaDesde, fechaHasta] = toolArgs.rango_fechas.split(" a ")
          } else if (toolArgs.rango_fechas.includes(" to ")) {
            ;[fechaDesde, fechaHasta] = toolArgs.rango_fechas.split(" to ")
          } else {
            fechaDesde = toolArgs.rango_fechas
            fechaHasta = toolArgs.rango_fechas
          }

          requestBody.Fecha_Desde = fechaDesde.trim()
          requestBody.Fecha_Hasta = fechaHasta ? fechaHasta.trim() : fechaDesde.trim()
        } else {
          const hoy = new Date()
          const fechaDesde = hoy.toISOString().split("T")[0]
          const unMesDespues = new Date(hoy.setMonth(hoy.getMonth() + 1)).toISOString().split("T")[0]
          requestBody.Fecha_Desde = fechaDesde
          requestBody.Fecha_Hasta = unMesDespues
        }

        if (toolArgs.profesional_id) {
          requestBody.Profesional_Id = toolArgs.profesional_id
        } else if (toolArgs.profesional) {
          // Buscar profesional primero
          const profesionalRequestBody = {
            Cliente_Id: clienteId.trim(),
            Action: "get_profesionales",
            busqueda: toolArgs.profesional,
          }

          console.log(`[PROXY] 🔍 Buscando profesional: ${toolArgs.profesional}`)
          const profesionalResponse = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(profesionalRequestBody),
          })

          const profesionalData = JSON.parse(await profesionalResponse.text())
          if (profesionalData.profesionales && profesionalData.profesionales.length > 0) {
            if (profesionalData.profesionales.length > 1) {
              return {
                exito: true,
                datos: {
                  multiple: true,
                  profesionales: profesionalData.profesionales.map((p: any) => ({
                    id: p.Id,
                    nombre: p.Nombre,
                    especialidad: p.Especialidad,
                  })),
                  mensaje: "Se encontraron múltiples profesionales. Por favor, seleccione uno.",
                },
              }
            }
            requestBody.Profesional_Id = profesionalData.profesionales[0].Id
          }
        } else if (toolArgs.especialidad) {
          // Buscar subespecialidad primero
          const subespecialidadRequestBody = {
            Cliente_Id: clienteId.trim(),
            Action: "get_subespecialidades",
          }

          console.log(`[PROXY] 🔍 Buscando especialidad: ${toolArgs.especialidad}`)
          const subespecialidadResponse = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subespecialidadRequestBody),
          })

          const subespecialidadData = JSON.parse(await subespecialidadResponse.text())
          if (subespecialidadData.subespecialidades && subespecialidadData.subespecialidades.length > 0) {
            const subespecialidadEncontrada = subespecialidadData.subespecialidades.find((e: any) =>
              e.Nombre.toLowerCase().includes(toolArgs.especialidad.toLowerCase()),
            )

            if (subespecialidadEncontrada) {
              requestBody.Subespecialidad_Id = subespecialidadEncontrada.Id
            } else {
              return {
                exito: false,
                error: {
                  codigo: "SUBESPECIALIDAD_NO_ENCONTRADA",
                  mensaje: `No se encontró la subespecialidad: ${toolArgs.especialidad}`,
                },
              }
            }
          }
        }
        break

      case "reservar_turno":
        requestBody.Action = "set_turno"
        // Cambiar esta línea:
        // requestBody.agendaId = toolArgs.agendaId
        // Por esta:
        requestBody.Agenda_Id = toolArgs.agendaId

        // También agregar los otros campos requeridos
        requestBody.Paciente_DNI = toolArgs.dni
        requestBody.Paciente_Nombre = toolArgs.nombre
        requestBody.Paciente_Apellido = toolArgs.apellido
        requestBody.Paciente_Telefono = toolArgs.telefono
        requestBody.Paciente_Email = toolArgs.email

        // Campos opcionales adicionales si están disponibles
        if (toolArgs.fecha) requestBody.Fecha = toolArgs.fecha
        if (toolArgs.hora) requestBody.Hora = toolArgs.hora
        if (toolArgs.profesional) requestBody.Profesional_Nombre = toolArgs.profesional
        break

      default:
        return {
          exito: false,
          error: {
            codigo: "HERRAMIENTA_DESCONOCIDA",
            mensaje: `Herramienta no implementada: ${toolName}`,
          },
        }
    }

    console.log(`[PROXY] 📤 POST ${requestBody.Action} → ${proxyUrl}`)

    // Hacer la petición con reintentos
    let response = null
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30000),
        })
        break
      } catch (error) {
        console.error(`[PROXY] ❌ Intento ${attempt}/${maxRetries} falló:`, error)
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }

    if (!response) {
      throw new Error("Todos los intentos de conexión fallaron")
    }

    const responseText = await response.text()
    console.log(
      `[PROXY] 📥 ${response.status} ${responseText.substring(0, 200)}${responseText.length > 200 ? "..." : ""}`,
    )

    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `Respuesta inválida: ${responseText.substring(0, 100)}...`,
        },
      }
    }

    // Procesar la respuesta según la función
    switch (toolName) {
      case "validar_dni":
        if (data.paciente) {
          const turnosProximos = data.turnos_proximos || []
          return truncateToolResponse({
            exito: true,
            datos: {
              paciente: {
                id: data.paciente.Id,
                nombre: data.paciente.Nombres,
                apellido: data.paciente.Apellido,
                dni: data.paciente.Nrodoc,
                telefono: data.paciente.Celular,
                email: data.paciente.Mail,
                fecha_nacimiento: data.paciente.Fecha_Nac,
                obra_social: data.paciente.Deudor_Nombre,
                plan: data.paciente.Plan_Nombre,
                nro_afiliado: data.paciente.Nro_Afiliado_Ppal,
              },
              turnos_proximos: turnosProximos.slice(0, 1).map((turno: any) => ({
                id: turno.Id,
                fecha: turno.Fecha,
                hora: turno.Hora,
                profesional_nombre: turno.Profesional_Nombre,
                centro_nombre: turno.Centro_Nombre,
                motivo_nombre: turno.Motivo_Nombre,
              })),
              es_nuevo: false,
              permite_pacientes_nuevos: data.permite_pacientes_nuevos !== false,
            },
          })
        } else if (data.error) {
          if (
            data.error.toLowerCase().includes("paciente no encontrado") ||
            data.error.toLowerCase().includes("no encontrado")
          ) {
            return {
              exito: true,
              datos: {
                paciente: null,
                turnos_proximos: [],
                es_nuevo: true,
                permite_pacientes_nuevos: data.permite_pacientes_nuevos === true,
                mensaje_error: data.error,
              },
            }
          }
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
              permite_pacientes_nuevos: data.permite_pacientes_nuevos,
            },
          }
        } else {
          return {
            exito: true,
            datos: {
              paciente: null,
              turnos_proximos: [],
              es_nuevo: true,
              permite_pacientes_nuevos: data.permite_pacientes_nuevos !== false,
            },
          }
        }

      case "obtener_subespecialidades":
        if (data.subespecialidades) {
          return truncateToolResponse({
            exito: true,
            datos: data.subespecialidades.slice(0, 5).map((e: any) => ({
              id: e.Id,
              nombre: e.Nombre,
            })),
          })
        } else if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
            },
          }
        } else {
          return { exito: true, datos: [] }
        }

      case "buscar_profesionales":
        if (data.profesionales) {
          return truncateToolResponse({
            exito: true,
            datos: data.profesionales.slice(0, 3).map((p: any) => ({
              id: p.Id,
              nombre: p.Nombre_Completo,
              especialidad: p.Especialidad,
            })),
          })
        } else if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
            },
          }
        } else {
          return { exito: true, datos: [] }
        }

      case "validar_obra_social":
        if (data.obras_sociales) {
          console.log(`[TOOL] ✅ ${data.total_encontradas} obras sociales encontradas`)
          return truncateToolResponse({
            exito: true,
            datos: {
              obras_sociales: data.obras_sociales.slice(0, 5).map((os: any) => ({
                id: os.Id,
                nombre: os.Nombre,
                razon_social: os.Razon_Social,
                permite_turnos_online: os.Permite_Turnos_Online,
                permite_turnos_online_texto: os.Permite_Turnos_Online_Texto,
              })),
              total_encontradas: data.total_encontradas,
              busqueda_realizada: data.busqueda_realizada,
            },
          })
        } else if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
            },
          }
        } else {
          return {
            exito: true,
            datos: {
              obras_sociales: [],
              total_encontradas: 0,
              busqueda_realizada: toolArgs.busqueda || "",
            },
          }
        }

      case "buscar_turnos_disponibles":
        if (data.turnos_disponibles) {
          const todosLosTurnos = []
          for (const diaData of data.turnos_disponibles) {
            if (diaData.turnos && Array.isArray(diaData.turnos)) {
              for (const turno of diaData.turnos) {
                todosLosTurnos.push({
                  id: turno.Id,
                  fecha: turno.Fecha,
                  hora: turno.Hora,
                  profesional: turno.Profesional_Nombre,
                  profesional_id: turno.Profesional_Id,
                  especialidad: turno.Especialidad,
                  estado: "disponible",
                  sede_nombre: turno.Sede_Nombre,
                  dia_semana: turno.Dia_Semana,
                })
              }
            }
            if (todosLosTurnos.length >= 40) break
          }

          console.log(`[TOOL] ✅ ${todosLosTurnos.length} turnos encontrados`)
          return truncateToolResponse({
            exito: true,
            datos: todosLosTurnos.slice(0, 40),
          })
        } else if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
            },
          }
        } else {
          return { exito: true, datos: [] }
        }

      case "reservar_turno":
        if (data.success || data.exito) {
          return {
            exito: true,
            datos: {
              mensaje: "Turno reservado exitosamente",
              confirmacion: data.confirmacion || "Reserva confirmada",
            },
          }
        } else if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error al reservar el turno",
            },
          }
        } else {
          return {
            exito: false,
            error: {
              codigo: "RESPUESTA_INESPERADA",
              mensaje: "La API devolvió una respuesta inesperada al reservar el turno",
            },
          }
        }

      default:
        if (data.error) {
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
            },
          }
        } else {
          return truncateToolResponse({
            exito: true,
            datos: data,
          })
        }
    }
  } catch (error) {
    console.error(`[TOOL] ❌ ${toolName} falló:`, error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_EJECUCION",
        mensaje: error instanceof Error ? error.message : "Error desconocido al ejecutar la herramienta",
      },
    }
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

        const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

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
  assistantId: string = process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
) {
  console.log(`[OPENAI] 🤖 Iniciando conversación`)
  console.log(`[OPENAI] 📝 Mensaje: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`)

  const openai = getOpenAIClient()

  try {
    // Obtener la configuración
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    console.log(`[OPENAI] ⚙️ Config: ${config.displayName} | Cliente: ${config.cliente_id}`)

    // Añadir el mensaje al thread
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[OPENAI] 📤 Mensaje enviado a thread ${threadId}`)

    // Crear un run con el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[OPENAI] 🏃 Run creado: ${run.id}`)

    // Procesar el run
    await processRunWithCorrectFlow(
      openai,
      threadId,
      run.id,
      config.accessToken,
      phoneNumberId,
      config.lastUserPhoneNumber || "",
      config.cliente_id || "",
    )

    console.log(`[OPENAI] ✅ Conversación completada`)
    return { success: true }
  } catch (error) {
    console.error("[OPENAI] ❌ Error:", error)
    await logError("openai", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para procesar run con flujo correcto
async function processRunWithCorrectFlow(
  openai: OpenAI,
  threadId: string,
  runId: string,
  accessToken: string,
  phoneNumberId: string,
  userPhoneNumber: string,
  clienteId: string,
  retryCount = 0,
) {
  try {
    // Esperar a que el run se complete o requiera acción
    const completedRun = await waitForRunCompletionOrAction(openai, threadId, runId)
    console.log(`[OPENAI] 🏁 Run completado: ${completedRun.status}`)

    if (completedRun.usage) {
      console.log(
        `[OPENAI] 💰 Tokens: ${completedRun.usage.total_tokens} (${completedRun.usage.prompt_tokens}+${completedRun.usage.completion_tokens})`,
      )
    }

    if (completedRun.status === "completed") {
      // Obtener los mensajes del asistente
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length === 0 || messages.data[0].role !== "assistant") {
        throw new Error("No se encontraron mensajes del asistente")
      }

      // Extraer el contenido del mensaje
      let messageContent = ""
      for (const content of messages.data[0].content) {
        if (content.type === "text") {
          messageContent += content.text.value
        }
      }

      console.log(
        `[OPENAI] 💬 Respuesta: "${messageContent.substring(0, 100)}${messageContent.length > 100 ? "..." : ""}"`,
      )

      // Enviar el mensaje a WhatsApp
      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, messageContent)
      console.log(`[OPENAI] 📱 Enviado a WhatsApp`)

      // Incrementar métrica
      await incrementMetric("messages_sent")

      return { success: true }
    } else if (completedRun.status === "requires_action") {
      console.log(`[OPENAI] 🔧 Ejecutando herramientas`)

      if (completedRun.required_action?.type === "submit_tool_outputs") {
        const toolCalls = completedRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        console.log(`[OPENAI] 🔧 ${toolCalls.length} herramientas a ejecutar`)

        // Procesar cada llamada a herramienta
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[OPENAI] 🔧 Ejecutando: ${functionName}`)

          // Enviar mensaje de espera al usuario
          const waitingMessage = FUNCTION_MESSAGES[functionName] || FUNCTION_MESSAGES.default
          try {
            await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, waitingMessage)
            console.log(`[OPENAI] ⏳ Mensaje de espera enviado`)
          } catch (error) {
            console.error(`[OPENAI] ❌ Error enviando mensaje de espera:`, error)
          }

          // Ejecutar la función
          const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          })

          console.log(`[OPENAI] ✅ ${functionName} completado`)
        }

        // Enviar los resultados usando API directa
        const submitUrl = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`
        const submitResponse = await fetch(submitUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
          body: JSON.stringify({ tool_outputs: toolOutputs }),
        })

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text()
          throw new Error(`Submit tool outputs failed: ${submitResponse.status} ${errorText}`)
        }

        console.log(`[OPENAI] 📤 Resultados enviados a OpenAI`)

        // Continuar procesando el run
        return await processRunWithCorrectFlow(
          openai,
          threadId,
          runId,
          accessToken,
          phoneNumberId,
          userPhoneNumber,
          clienteId,
          retryCount,
        )
      } else {
        throw new Error(`Tipo de acción no soportado: ${completedRun.required_action?.type}`)
      }
    } else if (completedRun.status === "failed") {
      throw new Error(`Run falló: ${completedRun.last_error?.message}`)
    } else {
      throw new Error(`Estado inesperado del run: ${completedRun.status}`)
    }
  } catch (error) {
    console.error(`[OPENAI] ❌ Error en processRunWithCorrectFlow:`, error)

    // Reintentar si no hemos alcanzado el número máximo
    if (retryCount < MAX_RETRIES) {
      let waitTime = RETRY_DELAY
      if (error.message && error.message.includes("Please try again in")) {
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000
        }
      }
      console.log(`[OPENAI] 🔄 Reintentando en ${waitTime}ms...`)
      await wait(waitTime)
      return processRunWithCorrectFlow(
        openai,
        threadId,
        runId,
        accessToken,
        phoneNumberId,
        userPhoneNumber,
        clienteId,
        retryCount + 1,
      )
    }

    await logError("openai_run", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para esperar completación del run
async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  const startTime = Date.now()

  // Usar fetch directamente
  const makeDirectAPICall = async (tId: string, rId: string) => {
    const url = `https://api.openai.com/v1/threads/${tId}/runs/${rId}`
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed: ${response.status} ${errorText}`)
    }

    return await response.json()
  }

  let run = await makeDirectAPICall(threadId, runId)
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++

    // Verificar timeout
    const elapsed = Date.now() - startTime
    if (elapsed > OPENAI_TIMEOUT) {
      throw new Error(`Timeout esperando run: ${OPENAI_TIMEOUT}ms`)
    }

    // Log cada 5 polls
    if (pollCount % 5 === 0) {
      console.log(`[OPENAI] ⏳ Esperando... (${run.status}, ${elapsed}ms)`)
    }

    await wait(1000)
    run = await makeDirectAPICall(threadId, runId)
  }

  const totalTime = Date.now() - startTime
  console.log(`[OPENAI] ⏱️ Run completado en ${totalTime}ms (${pollCount} polls)`)
  return run
}
