import OpenAI from "openai"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { logError } from "@/lib/monitoring"
import {
  obtenerTurnosDisponibles,
  confirmarTurno,
  obtenerDatosSede,
  formatearDatosSede,
  buscarPaciente,
  buscarProfesionales,
  obtenerSubespecialidades,
  validarObraSocial,
  obtenerTurnos,
} from "./api-tools/api-functions"
import { AbortSignal } from "abort-controller"

// Re-export functions for compatibility
export { obtenerTurnosDisponibles } from "./api-tools/api-functions"

// Definición de las herramientas
export const openaiTools = {
  obtener_turnos_disponibles: {
    description: "Obtiene los turnos disponibles para una especialidad específica",
    parameters: {
      type: "object",
      properties: {
        especialidad_id: {
          type: "string",
          description: "ID de la especialidad médica",
        },
        profesional_id: {
          type: "string",
          description: "ID del profesional (opcional)",
        },
        obra_social_id: {
          type: "string",
          description: "ID de la obra social (opcional)",
        },
      },
      required: ["especialidad_id"],
    },
  },
  confirmar_turno: {
    description: "Confirma un turno médico",
    parameters: {
      type: "object",
      properties: {
        turno_id: {
          type: "string",
          description: "ID del turno a confirmar",
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
        },
      },
      required: ["turno_id", "paciente_datos"],
    },
  },
  obtener_datos_sede: {
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
  obtener_obras_sociales: {
    description: "Obtiene las obras sociales disponibles para un cliente",
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
  reservar_turno: {
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
        },
        cliente_id: {
          type: "string",
          description: "ID del cliente",
        },
      },
      required: ["turno_id", "paciente_datos", "cliente_id"],
    },
  },
  validar_dni: {
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
  buscar_profesionales: {
    description: "Busca profesionales médicos según un criterio de búsqueda",
    parameters: {
      type: "object",
      properties: {
        busqueda: {
          type: "string",
          description: "Criterio de búsqueda para profesionales",
        },
      },
      required: ["busqueda"],
    },
  },
  buscar_turnos_disponibles: {
    description: "Busca turnos disponibles según criterios de búsqueda",
    parameters: {
      type: "object",
      properties: {
        profesional_id: {
          type: "string",
          description: "ID del profesional (opcional)",
        },
        subespecialidad_id: {
          type: "string",
          description: "ID de la subespecialidad (opcional)",
        },
        rango_fechas: {
          type: "string",
          description: "Rango de fechas para buscar turnos (opcional)",
        },
      },
    },
  },
  obtener_subespecialidades: {
    description: "Obtiene las subespecialidades disponibles para un cliente",
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
  validar_obra_social: {
    description: "Valida la obra social de un cliente",
    parameters: {
      type: "object",
      properties: {
        busqueda: {
          type: "string",
          description: "Criterio de búsqueda para la obra social",
        },
      },
      required: ["busqueda"],
    },
  },
}

// Mensajes predefinidos para cada función
const FUNCTION_MESSAGES = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  validar_obra_social: "Verificando la obra social, aguardá unos instantes.",
  obtener_datos_sede: "Consultando información de la sede, aguardá unos instantes.",
  obtener_obras_sociales: "Consultando obras sociales disponibles, aguardá unos instantes.",
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
export async function executeOpenAITool(toolName: string, args: any, clienteId: string) {
  console.log(`[OPENAI-TOOLS] Ejecutando tool: ${toolName} con args:`, args)

  try {
    switch (toolName) {
      case "validar_dni":
        return await validarDni(clienteId, args.dni)

      case "buscar_profesionales":
        return await buscarProfesionalesHerramienta(clienteId, args.busqueda)

      case "buscar_turnos_disponibles":
        return await buscarTurnosDisponiblesHerramienta(
          clienteId,
          args.profesional_id,
          args.subespecialidad_id,
          args.rango_fechas,
        )

      case "obtener_subespecialidades":
        return await obtenerSubespecialidadesHerramienta(clienteId)

      case "validar_obra_social":
        return await validarObraSocialHerramienta(clienteId, args.busqueda)

      case "obtener_turnos_disponibles":
        return await obtenerTurnosDisponibles(clienteId, args.especialidad_id, args.obra_social_id)

      case "confirmar_turno":
        return await confirmarTurno(clienteId, {
          turno_id: args.turno_id,
          paciente_datos: args.paciente_datos,
        })

      case "obtener_datos_sede":
        return await obtenerDatosSedeHerramienta(clienteId, args.sede_id)

      case "obtener_obras_sociales":
        return await obtenerObrasSociales(clienteId)

      case "reservar_turno":
        return await reservarTurno(clienteId, args.turno_id, args.paciente_datos)

      default:
        console.warn(`[OPENAI-TOOLS] Tool desconocido: ${toolName}`)
        return { success: false, error: `Tool desconocido: ${toolName}` }
    }
  } catch (error) {
    console.error(`[OPENAI-TOOLS] Error ejecutando tool ${toolName}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
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

// Función para obtener obras sociales
export async function obtenerObrasSociales(clienteId: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Obteniendo obras sociales para cliente: ${clienteId}`)

    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      return "Error: URL de API no configurada"
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Cliente_Id: clienteId,
        Action: "get_obras_sociales",
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return `Error HTTP: ${response.status}`
    }

    const data = await response.json()
    console.log(`[TOOLS] ✅ Obras sociales obtenidas: ${data.obras_sociales?.length || 0}`)

    return JSON.stringify(data)
  } catch (error) {
    console.error("[TOOLS] ❌ Error obteniendo obras sociales:", error)
    return "Error al obtener obras sociales"
  }
}

// Función para reservar turno
export async function reservarTurno(clienteId: string, turnoId: string, pacienteDatos: any): Promise<string> {
  try {
    console.log(`[TOOLS] 📝 Reservando turno ${turnoId} para cliente: ${clienteId}`)

    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      return "Error: URL de API no configurada"
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Cliente_Id: clienteId,
        Action: "reservar_turno",
        turno_id: turnoId,
        paciente_datos: pacienteDatos,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return `Error HTTP: ${response.status}`
    }

    const data = await response.json()
    console.log(`[TOOLS] ✅ Turno reservado exitosamente`)

    return JSON.stringify(data)
  } catch (error) {
    console.error("[TOOLS] ❌ Error reservando turno:", error)
    return "Error al reservar el turno"
  }
}

// Función para obtener datos de sede (nueva herramienta)
export async function obtenerDatosSedeHerramienta(clienteId: string, sedeId: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Obteniendo datos de sede: ${sedeId} para cliente: ${clienteId}`)

    const sedeData = await obtenerDatosSede(clienteId, sedeId)

    if (sedeData && sedeData.success && sedeData.sede) {
      const datosFormateados = formatearDatosSede(sedeData.sede)
      console.log(`[TOOLS] ✅ Datos de sede obtenidos: ${sedeData.sede.Nombre_Completo}`)
      return datosFormateados
    } else {
      console.log(`[TOOLS] ⚠️ No se pudieron obtener datos de sede`)
      return "No se pudieron obtener los datos de la sede solicitada"
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error obteniendo datos de sede:", error)
    return "Error al obtener los datos de la sede"
  }
}

// Función para validar DNI
export async function validarDni(clienteId: string, dni: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🔍 Validando DNI: ${dni} para cliente: ${clienteId}`)

    const resultado = await buscarPaciente(clienteId, { dni })

    if (resultado.exito && resultado.datos) {
      console.log(`[TOOLS] ✅ DNI validado exitosamente: ${dni}`)
      return JSON.stringify({
        exito: true,
        paciente: resultado.datos,
        mensaje: "DNI validado correctamente",
      })
    } else {
      console.log(`[TOOLS] ⚠️ DNI no encontrado: ${dni}`)
      return JSON.stringify({
        exito: false,
        mensaje: "No se encontró un paciente con ese DNI",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error validando DNI:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar el DNI",
    })
  }
}

// Función para buscar profesionales
export async function buscarProfesionalesHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    console.log(`[TOOLS] 👨‍⚕️ Buscando profesionales: "${busqueda}" para cliente: ${clienteId}`)

    const resultado = await buscarProfesionales(clienteId, busqueda)

    if (resultado.exito && resultado.datos) {
      // Check if datos has a profesionales property (API response structure)
      const profesionales = resultado.datos.profesionales || resultado.datos

      // Ensure profesionales is an array
      if (Array.isArray(profesionales)) {
        console.log(`[TOOLS] ✅ Profesionales encontrados: ${profesionales.length}`)
        return JSON.stringify({
          exito: true,
          profesionales: profesionales,
          total: profesionales.length,
          mensaje: `Se encontraron ${profesionales.length} profesionales`,
        })
      } else {
        console.log(`[TOOLS] ⚠️ Datos no es un array:`, resultado.datos)
        return JSON.stringify({
          exito: false,
          mensaje: "Formato de respuesta inesperado",
        })
      }
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron profesionales para: "${busqueda}"`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron profesionales con ese criterio de búsqueda",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error buscando profesionales:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al buscar profesionales",
    })
  }
}

// Función para buscar turnos disponibles
export async function buscarTurnosDisponiblesHerramienta(
  clienteId: string,
  profesionalId?: string,
  subespecialidadId?: string,
  rangoFechas?: string,
): Promise<string> {
  try {
    console.log(`[TOOLS] 📅 Buscando turnos disponibles para cliente: ${clienteId}`)
    console.log(
      `[TOOLS] 📋 Parámetros: profesionalId=${profesionalId}, subespecialidadId=${subespecialidadId}, rangoFechas=${rangoFechas}`,
    )

    // Determinar el rango de fechas
    let fechaDesde: string
    let fechaHasta: string

    if (rangoFechas) {
      // Si se proporciona un rango, parsearlo
      const fechas = rangoFechas.split(" a ")
      fechaDesde = fechas[0].trim()
      fechaHasta = fechas.length > 1 ? fechas[1].trim() : fechaDesde
    } else {
      // Si no se proporciona, buscar los próximos 5 días
      const hoy = new Date()
      fechaDesde = hoy.toISOString().split("T")[0]

      const futuro = new Date()
      futuro.setDate(futuro.getDate() + 5)
      fechaHasta = futuro.toISOString().split("T")[0]
    }

    console.log(`[TOOLS] 📆 Buscando turnos desde ${fechaDesde} hasta ${fechaHasta}`)

    // Llamar a la función obtenerTurnos con los parámetros apropiados
    const resultado = await obtenerTurnos(
      clienteId,
      fechaDesde,
      fechaHasta,
      profesionalId,
      undefined, // pacienteDNI
      true, // useCache
    )

    if (resultado.exito && resultado.datos) {
      const turnosArray = Array.isArray(resultado.datos) ? resultado.datos : []
      console.log(`[TOOLS] ✅ Turnos encontrados: ${turnosArray.length}`)

      // Truncar para OpenAI (solo primeros 20 turnos)
      const turnosTruncados = turnosArray.slice(0, 20)

      return JSON.stringify({
        exito: true,
        turnos: turnosTruncados,
        total_encontrados: turnosArray.length,
        mensaje: `Se encontraron ${turnosArray.length} turnos disponibles`,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        _truncated: turnosArray.length > 20,
        _send_to_user: true, // Flag para indicar que debe enviarse al usuario
      })
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron turnos disponibles`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron turnos disponibles para los criterios especificados",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error buscando turnos disponibles:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al buscar turnos disponibles",
    })
  }
}

// Función para obtener subespecialidades
export async function obtenerSubespecialidadesHerramienta(clienteId: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Obteniendo subespecialidades para cliente: ${clienteId}`)

    const resultado = await obtenerSubespecialidades(clienteId)

    if (resultado.exito && resultado.datos) {
      console.log(`[TOOLS] ✅ Subespecialidades encontradas: ${resultado.datos.length}`)
      return JSON.stringify({
        exito: true,
        subespecialidades: resultado.datos,
        total: resultado.datos.length,
        mensaje: `Se encontraron ${resultado.datos.length} especialidades`,
      })
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron subespecialidades`)
      return JSON.stringify({
        exito: false,
        mensaje: "No se encontraron especialidades disponibles",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error obteniendo subespecialidades:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al obtener las especialidades",
    })
  }
}

// Función para validar obra social
export async function validarObraSocialHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Validando obra social: "${busqueda}" para cliente: ${clienteId}`)

    const resultado = await validarObraSocial(clienteId, busqueda)

    if (resultado.exito && resultado.datos) {
      console.log(`[TOOLS] ✅ Obras sociales encontradas: ${resultado.datos.total_encontradas}`)
      return JSON.stringify({
        exito: true,
        obras_sociales: resultado.datos.obras_sociales,
        total_encontradas: resultado.datos.total_encontradas,
        busqueda_realizada: resultado.datos.busqueda_realizada,
        mensaje: `Se encontraron ${resultado.datos.total_encontradas} obras sociales`,
      })
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron obras sociales para: "${busqueda}"`)
      return JSON.stringify({
        exito: false,
        mensaje: "No se encontraron obras sociales con ese criterio de búsqueda",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error validando obra social:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar la obra social",
    })
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

// Función para sincronizar herramientas con el asistente
export async function syncAssistantTools(assistantId: string): Promise<void> {
  console.log(`[OPENAI] 🔧 Sincronizando herramientas con asistente ${assistantId}`)

  const openai = getOpenAIClient()

  try {
    // Convert our tool definitions to OpenAI format
    const tools = Object.entries(openaiTools).map(([name, tool]) => ({
      type: "function" as const,
      function: {
        name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))

    // Update the assistant with the tools
    await openai.beta.assistants.update(assistantId, {
      tools,
    })

    console.log(`[OPENAI] ✅ ${tools.length} herramientas sincronizadas exitosamente`)
  } catch (error) {
    console.error("[OPENAI] ❌ Error sincronizando herramientas:", error)
    throw error
  }
}

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

    try {
      const assistant = await openai.beta.assistants.retrieve(assistantId)
      console.log(`[OPENAI] 🔍 Asistente tiene ${assistant.tools?.length || 0} herramientas configuradas`)

      // Log the tool names
      if (assistant.tools && assistant.tools.length > 0) {
        const toolNames = assistant.tools
          .filter((t: any) => t.type === "function")
          .map((t: any) => t.function?.name)
          .filter(Boolean)
        console.log(`[OPENAI] 🔧 Herramientas actuales: ${toolNames.join(", ")}`)
      }

      // Get expected tool names
      const expectedToolNames = Object.keys(openaiTools)
      console.log(`[OPENAI] 🔧 Herramientas esperadas: ${expectedToolNames.join(", ")}`)

      // Check if we need to sync
      const currentToolNames =
        assistant.tools
          ?.filter((t: any) => t.type === "function")
          .map((t: any) => t.function?.name)
          .filter(Boolean) || []

      const needsSync =
        expectedToolNames.some((name) => !currentToolNames.includes(name)) ||
        currentToolNames.some((name) => !expectedToolNames.includes(name))

      if (!assistant.tools || assistant.tools.length === 0 || needsSync) {
        console.log(`[OPENAI] ⚠️ Sincronizando herramientas...`)
        await syncAssistantTools(assistantId)
        console.log(`[OPENAI] ✅ Herramientas sincronizadas`)
      } else {
        console.log(`[OPENAI] ✅ Herramientas ya están sincronizadas`)
      }
    } catch (error) {
      console.error("[OPENAI] ⚠️ Error verificando herramientas del asistente:", error)
      // Try to sync anyway
      try {
        console.log(`[OPENAI] 🔄 Intentando sincronizar herramientas de todas formas...`)
        await syncAssistantTools(assistantId)
        console.log(`[OPENAI] ✅ Herramientas sincronizadas exitosamente`)
      } catch (syncError) {
        console.error("[OPENAI] ❌ Error sincronizando herramientas:", syncError)
      }
    }

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

// Función para enviar mensaje a WhatsApp
async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  userPhoneNumber: string,
  message: string,
) {
  // Implementación de envío de mensaje a WhatsApp
  // Este código depende de la implementación específica de WhatsApp Business API
  // Aquí se asume que existe una función sendWhatsAppMessage que maneja esto
}

// Función para incrementar métrica
async function incrementMetric(metricName: string) {
  // Implementación de incremento de métrica
  // Este código depende de la implementación específica del sistema de métricas
  // Aquí se asume que existe una función incrementMetric que maneja esto
}
