import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId, updateThreadId } from "@/lib/db"
import { safelyAddMessageToThread } from "./thread-manager"
import {
  obtenerTurnosDisponibles,
  confirmarTurno,
  obtenerDatosSede,
  formatearDatosSede,
  buscarPaciente,
  buscarProfesionales,
  obtenerSubespecialidades,
  buscarTurnosDisponibles,
  validarObraSocial,
  cancelarTurno as apiCancelarTurno,
  obtenerTodasLasSedes,
} from "./api-tools/api-functions"
import type { AbortSignal } from "abort-controller"
import { saveConversationMessage } from "./conversations"
import { nanoid } from "nanoid"
import { getRedisClient } from "./redis"
import { trackAppointmentEvent, checkAndClearPendingReschedule, trackRescheduleStarted } from "./appointment-stats"
import { getAssistantIdByFunction } from "./assistant-utils"
import { logError } from "./logging" // Assuming logError is in './logging'
import { incrementMetric } from "./metrics" // Assuming incrementMetric is in './metrics'
import {
  createSupportSession,
  setPendingHumanSupportOffer,
} from "./human-support"
import { getEffectiveFeatureFlags } from "./conversation-state/feature-flags"
import {
  getHumanSupportSchedule,
  isWithinHumanSupportHours,
  formatSupportHoursForPatient,
} from "./human-support-schedule"
import { formatScheduleForSystemBlock } from "@/lib/utils/schedule-formatter" // Import added

// Re-export functions for compatibility
export { obtenerTurnosDisponibles } from "./api-tools/api-functions"

// Definición de las herramientas
export const openaiTools = {
  obtener_turnos_disponibles: {
    description: "Obtiene turnos disponibles por especialidad",
    parameters: {
      type: "object",
      properties: {
        especialidad_id: { type: "string", description: "ID especialidad" },
        profesional_id: { type: "string", description: "ID profesional (opcional)" },
        obra_social_id: { type: "string", description: "ID obra social (opcional)" },
      },
      required: ["especialidad_id"],
    },
  },
  buscar_turnos_disponibles: {
    description: "Busca turnos por fecha, profesional o especialidad",
    parameters: {
      type: "object",
      properties: {
        rango_fechas: {
          type: "string",
          description: "Fecha o rango 'YYYY-MM-DD' o 'YYYY-MM-DD a YYYY-MM-DD' (opcional, por defecto próximos 7 días)",
        },
        profesional: { type: "string", description: "Nombre profesional (opcional)" },
        especialidad: { type: "string", description: "Nombre especialidad (opcional)" },
        profesional_id: { type: "string", description: "ID profesional (opcional)" },
        sede_id: { type: "string", description: "ID de la sede donde buscar turnos (opcional)" },
        Paciente_DNI: { type: "string", description: "DNI del paciente para filtrar turnos (opcional)" },
        subespecialidad_id: { type: "string", description: "ID de la subespecialidad para filtrar turnos (opcional)" },
        obra_social_id: { type: "string", description: "ID de la obra social del paciente para filtrar turnos (opcional)" },
      },
      required: [], // Made all parameters optional since OpenAI might not pass rango_fechas
    },
  },
  confirmar_turno: {
    description: "Confirma un turno médico",
    parameters: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Fecha del turno a confirmar (YYYY-MM-DD)" },
        paciente_datos: {
          type: "object",
          description: "Datos del paciente",
          properties: {
            dni: { type: "string" },
            telefono: { type: "string" },
          },
          required: ["dni", "telefono"],
        },
      },
      required: ["fecha", "paciente_datos"],
    },
  },
  cancelar_turno: {
    description: "Cancela un turno médico previamente reservado o confirmado",
    parameters: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "Fecha del turno a cancelar (YYYY-MM-DD)" },
        motivo: { type: "string", description: "Motivo de la cancelación" },
        paciente_datos: {
          type: "object",
          description: "Datos del paciente para validación",
          properties: {
            dni: { type: "string" },
            telefono: { type: "string" },
          },
          required: ["dni", "telefono"],
        },
      },
      required: ["fecha", "motivo", "paciente_datos"],
    },
  },
  obtener_datos_sede: {
    description: "Obtiene info de una sede específica",
    parameters: {
      type: "object",
      properties: {
        sede_id: { type: "string", description: "ID de la sede" },
      },
      required: ["sede_id"],
    },
  },
  obtener_sedes: {
    description: "Obtiene el listado completo de todas las sedes disponibles",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  obtener_obras_sociales: {
    description: "Lista obras sociales disponibles",
    parameters: {
      type: "object",
      properties: {
        cliente_id: { type: "string", description: "ID del cliente" },
      },
      required: ["cliente_id"],
    },
  },
  obtener_subespecialidades: {
    description: "Lista especialidades médicas",
    parameters: {
      type: "object",
      properties: {
        cliente_id: { type: "string", description: "ID del cliente" },
      },
      required: ["cliente_id"],
    },
  },
  reservar_turno: {
    description: "Reserva un turno médico",
    parameters: {
      type: "object",
      properties: {
        agendaId: { type: "string", description: "ID del turno/agenda a reservar" },
        dni: { type: "string", description: "DNI del paciente" },
        nombre: { type: "string", description: "Nombre del paciente" },
        apellido: { type: "string", description: "Apellido del paciente" },
        telefono: { type: "string", description: "Teléfono del paciente" },
        email: { type: "string", description: "Email del paciente" },
        obra_social_id: { type: "string", description: "ID de la obra social del paciente (Deudor_Id)" },
        obra_social: { type: "string", description: "Nombre de la obra social del paciente (Deudor_Nombre)" },
      },
      required: ["agendaId", "dni", "nombre", "apellido", "telefono", "email"],
    },
  },
  validar_dni: {
    description: "Valida DNI de paciente",
    parameters: {
      type: "object",
      properties: {
        dni: { type: "string", description: "DNI del paciente" },
      },
      required: ["dni"],
    },
  },
  validar_telefono: {
    description: "Busca y valida paciente por número de teléfono",
    parameters: {
      type: "object",
      properties: {
        telefono: { type: "string", description: "Número de teléfono del paciente" },
      },
      required: ["telefono"],
    },
  },
  buscar_profesionales: {
    description: "Busca profesionales médicos",
    parameters: {
      type: "object",
      properties: {
        busqueda: { type: "string", description: "Criterio de búsqueda" },
      },
      required: ["busqueda"],
    },
  },
  validar_obra_social: {
    description: "Busca y valida obra social",
    parameters: {
      type: "object",
      properties: {
        busqueda: { type: "string", description: "Nombre de la obra social" },
      },
      required: ["busqueda"],
    },
  },
  // Agregar tool para registrar eventos de cita
  registrar_evento_cita: {
    description: "Registra un evento relacionado con una cita médica (ej. reagendamiento)",
    parameters: {
      type: "object",
      properties: {
        evento: {
          type: "string",
          description: "Tipo de evento (ej. 'reagendamiento', 'cancelacion')",
        },
        turno_id: { type: "string", description: "ID del turno médico" },
        motivo: { type: "string", description: "Motivo del evento (opcional)" },
      },
      required: ["evento", "turno_id"],
    },
  },
  // Agregar tool para routing
  route_to_reservas_assistant: {
    description: "Enruta la conversación al asistente de reservas médicas.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La consulta original del usuario que requiere el cambio de asistente.",
        },
      },
      required: ["query"],
    },
  },
  route_to_turnos_assistant: {
    description: "Enruta la conversación al asistente de gestión de turnos (consultas, cancelaciones, confirmaciones).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La consulta original del usuario que requiere el cambio de asistente.",
        },
      },
      required: ["query"],
    },
  },
  route_to_pacienteNuevo_SinCualquierMedico: {
    description: "Enruta la conversación al asistente especializado para pacientes nuevos sin médico específico asignado.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La consulta original del usuario que requiere el cambio de asistente.",
        },
      },
      required: ["query"],
    },
  },
  route_to_pacienteExistente_SinCualquierMedico: {
    description: "Enruta la conversación al asistente especializado para pacientes existentes sin médico específico asignado.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La consulta original del usuario que requiere el cambio de asistente.",
        },
      },
      required: ["query"],
    },
  },
  // </CHANGE> Adding request_human_support tool
  request_human_support: {
    description:
      "Solicita la intervención de un agente humano cuando el asistente no puede resolver la consulta del paciente o cuando el paciente explícitamente solicita hablar con una persona. IMPORTANTE: Usa esta función SOLO cuando sea estrictamente necesario (consultas complejas, quejas graves, o solicitud explícita del usuario).",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Breve descripción del motivo por el cual se solicita atención humana",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "Prioridad de la solicitud basada en la urgencia del caso. high: emergencias o quejas graves, medium: consultas complejas, low: consultas generales",
        },
        summary: {
          type: "string",
          description: "Resumen breve del contexto de la conversación hasta el momento",
        },
      },
      required: ["reason", "priority", "summary"],
    },
  },
  // </CHANGE>
}

function generateDynamicWaitingMessage(functionName: string, functionArgs: any): string | null {
  switch (functionName) {
    case "buscar_turnos_disponibles":
      if (functionArgs?.rango_fechas) {
        const rango = functionArgs.rango_fechas
        // Parse the date range (format: "2025-12-17 a 2025-12-24")
        const rangoParts = rango.split(" a ")
        if (rangoParts.length === 2) {
          const [fechaInicio, fechaFin] = rangoParts
          // Format dates from YYYY-MM-DD to DD/MM
          const formatFecha = (fecha: string) => {
            const partes = fecha.trim().split("-")
            if (partes.length === 3) {
              return `${partes[2]}/${partes[1]}`
            }
            return fecha
          }
          const fechaInicioFormateada = formatFecha(fechaInicio)
          const fechaFinFormateada = formatFecha(fechaFin)
          return `Voy a buscar turnos disponibles del ${fechaInicioFormateada} al ${fechaFinFormateada}, aguardá unos instantes.`
        }
      }
      return "Voy a buscar turnos disponibles, aguardá unos instantes."

    case "validar_dni":
      return "Aguardá unos instantes mientras validamos tu DNI."

    case "reservar_turno":
      return "Realizando reserva de turno. aguardá unos instantes."

    case "obtener_subespecialidades":
      return "Consultando las especialidades disponibles, aguardá unos instantes."

    case "buscar_profesionales":
      return "Buscando profesionales, aguardá unos instantes."

    case "validar_obra_social":
      return "Verificando la obra social, aguardá unos instantes."

    default:
      return null
  }
}

const FUNCTION_MESSAGES: Record<string, string> = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  validar_obra_social: "Verificando la obra social, aguardá unos instantes.",
}

// Función para truncar respuestas largas de herramientas
function truncateToolResponse(response: any, maxLength = 1000): any {
  const responseStr = JSON.stringify(response)
  const originalLength = responseStr.length

  if (responseStr.length <= maxLength) {
    return response
  }

  // Si es un objeto con datos, truncar los datos
  if (response.exito && response.datos) {
    if (Array.isArray(response.datos)) {
      const truncatedData = response.datos.slice(0, 40)
      return {
        ...response,
        datos: truncatedData,
        _truncated: true,
        _originalLength: response.datos.length,
      }
    }
  }

  // Fallback: truncar el string completo
  return {
    exito: response.exito || false,
    datos: responseStr.substring(0, maxLength - 100) + "... [TRUNCADO]",
    _truncated: true,
    _originalLength: originalLength,
  }
}

// Detectar si una función es de routing (comienza con route_to_)
function isRoutingFunction(functionName: string): boolean {
  return functionName.startsWith("route_to_")
}

// Manejar el switch de asistente cuando se detecta una función de routing
async function handleAssistantSwitch(
  openai: OpenAI,
  oldThreadId: string,
  oldRunId: string, // Added oldRunId parameter to cancel the original run
  functionName: string,
  functionArgs: any,
  phoneNumberId: string,
  accessToken: string,
  clienteId: string,
  userPhoneNumber: string, // Added for updating thread mapping
): Promise<{ switchedAssistant: boolean; assistantId?: string; newThreadId?: string }> {
  try {
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[OPENAI-SWITCH] No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      return { switchedAssistant: false }
    }

    const newAssistantId = getAssistantIdByFunction(config, functionName)

    if (!newAssistantId) {
      console.warn(`[OPENAI-SWITCH] No se encontró asistente configurado para la función: ${functionName}`)
      return { switchedAssistant: false }
    }

    // Trackear inicio de proceso de reagendamiento si es route_to_reagendamiento
    if (functionName === "route_to_reagendamiento") {
      await trackRescheduleStarted(clienteId, userPhoneNumber)
    }

    await cancelRunAndWait(oldThreadId, oldRunId)

    const newThread = await openai.beta.threads.create({
      metadata: {
        name: `whatsapp-${userPhoneNumber}-${config.id}`,
        previousThread: oldThreadId,
        reason: "assistant_switch",
        assistantId: newAssistantId,
      },
    })

    await updateThreadId(userPhoneNumber, config.id, newThread.id, newAssistantId)
    console.info(`[OPENAI-SWITCH] Switch ${functionName}: ${oldThreadId} -> ${newThread.id} (assistant: ${newAssistantId})`)

    // Marcar que el paciente está en un flujo de asistente especializado.
    // Esto previene que el NLU fallback intercepte sus respuestas durante el flujo.
    if (functionName === "route_to_reagendamiento") {
      const redisFlag = getRedisClient()
      if (redisFlag) {
        await redisFlag.setex(`specialized_assistant_active:${config.id}:${userPhoneNumber}`, 7200, 'reagendamiento')
        console.info(`[OPENAI-SWITCH] Flag flujo especializado seteado: ${config.id}:${userPhoneNumber}`)
      }
    }

    const { getArgentinaDateTime } = await import("@/lib/utils/date-utils") // import moved here
    const fechaHora = getArgentinaDateTime()

    const scheduleInfo = formatScheduleForSystemBlock(config)

    const systemBlock = `[SISTEMA]
Nombre: ${config.displayName}
FechaHora: ${fechaHora}
PrimerMensaje: true
TipoMensaje: assistant_switch
PacienteCelular: ${userPhoneNumber}${config.escalationPhoneNumber ? `\nNumeroDerivacion: ${config.escalationPhoneNumber}` : ""}
FuncionOrigen: ${functionName}${scheduleInfo}
[/SISTEMA]

${JSON.stringify(functionArgs, null, 2)}`

    await openai.beta.threads.messages.create(newThread.id, {
      role: "user",
      content: systemBlock,
    })

    const newRun = await openai.beta.threads.runs.create(newThread.id, {
      assistant_id: newAssistantId,
    })

    await processRunWithCorrectFlow(
      openai,
      newThread.id,
      newRun.id,
      accessToken,
      phoneNumberId,
      clienteId,
      userPhoneNumber,
    )

    return {
      switchedAssistant: true,
      assistantId: newAssistantId,
      newThreadId: newThread.id,
    }
  } catch (error) {
    console.error(`[OPENAI-SWITCH] Error en handleAssistantSwitch:`, error)
    return {
      switchedAssistant: false,
    }
  }
}
// Implementación directa de todas las funciones
export async function executeOpenAITool(toolName: string, args: any, clienteId: string) {


  try {
    switch (toolName) {
      case "validar_dni":
        return await validarDni(clienteId, args.dni)

      case "validar_telefono":
        return await validarTelefono(clienteId, args.telefono)

      case "buscar_profesionales":
        return await buscarProfesionalesHerramienta(clienteId, args.busqueda)

      case "obtener_subespecialidades":
        return await obtenerSubespecialidadesHerramienta(clienteId)

      case "obtener_turnos_disponibles":
        return await obtenerTurnosDisponibles(clienteId, args.especialidad_id, args.obra_social_id)

      case "buscar_turnos_disponibles":
        return await buscarTurnosDisponiblesHerramienta(
          clienteId,
          args.rango_fechas,
          args.profesional,
          args.especialidad,
          args.profesional_id,
          args.sede_id,
          args.Paciente_DNI,
          args.subespecialidad_id,
          args.obra_social_id,
        )

      case "confirmar_turno":
        // Use new arguments: fecha and paciente_datos with dni/telefono
        return await confirmarTurnoHerramienta(clienteId, args.fecha, args.paciente_datos)

      // Implementar la nueva herramienta cancelar_turno
      case "cancelar_turno":
        return await cancelarTurnoHerramienta(clienteId, args.fecha, args.motivo, args.paciente_datos)

      case "obtener_datos_sede":
        return await obtenerDatosSedeHerramienta(clienteId, args.sede_id)

      case "obtener_sedes":
        // Cambiado para usar la nueva función importada
        return await obtenerSedesHerramienta(clienteId)

      case "obtener_obras_sociales":
        return await obtenerObrasSociales(clienteId)

      case "reservar_turno":
        if (args.agendaId) {
          const pacienteDatos = {
            dni: args.dni,
            nombre: args.nombre,
            apellido: args.apellido,
            telefono: args.telefono,
            email: args.email,
            deudorId: args.obra_social_id,
            deudorNombre: args.obra_social,
          }
          return await reservarTurno(clienteId, args.agendaId, pacienteDatos)
        } else {
          return await reservarTurno(clienteId, args.turno_id, args.paciente_datos)
        }

      case "validar_obra_social":
        return await validarObraSocialHerramienta(clienteId, args.busqueda)

      // Ejecutar la nueva herramienta para registrar eventos de cita
      case "registrar_evento_cita":
        return await registrarEventoCitaHerramienta(clienteId, args.evento, args.turno_id, args.motivo)

      // Ejecutar herramientas de routing
      case "route_to_reservas_assistant":
      case "route_to_turnos_assistant":
      case "route_to_pacienteNuevo_SinCualquierMedico":
      case "route_to_pacienteExistente_SinCualquierMedico":
        // Retornar el resultado del switch de asistente directamente
        // The following arguments are not needed for the initial call to executeOpenAITool,
        // but they are required by handleAssistantSwitch. We will pass dummy values or null.
        // In a real scenario, these would be available in the context of the webhook handler.
        const currentConfig = await getWhatsAppConfigByPhoneId(null as any) // Assume this can fetch config or needs to be passed
        const currentThreadId = null as any // Assume this can be retrieved or passed
        const currentAccessToken = currentConfig?.accessToken || (null as any)
        const currentUserPhoneNumber = null as any // Assume this can be retrieved or passed

        // If the logic were to be directly inside this switch, we'd need to obtain these.
        // However, since handleAssistantSwitch is already designed to be called from processRunWithCorrectFlow,
        // we delegate the responsibility there. For the sake of this executeOpenAITool definition,
        // we pass null/dummy values as they won't be used directly here, but by handleAssistantSwitch later.
        return await handleAssistantSwitch(
          getOpenAIClient(), // Pasar instancia de OpenAI
          currentThreadId, // threadId no es necesario para la llamada inicial de handleAssistantSwitch *from here*
          null as any, // oldRunId not needed *from here*
          toolName,
          args,
          null as any, // phoneNumberId not needed *from here*
          currentAccessToken,
          clienteId,
          currentUserPhoneNumber, // userPhoneNumber not needed *from here*
        )

      case "request_human_support":
        // Este caso se maneja de forma especial en executeToolCall
        // donde tenemos acceso a phoneNumber, threadId, etc.
        return {
          success: true,
          message: "Solicitud de atención humana registrada. Un agente se pondrá en contacto contigo pronto.",
        }
      // </CHANGE>

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

// Mensaje para procesar solo para web
export async function processWebOnlyMessage(
  threadId: string,
  message: string,
  assistantId: string,
  clienteId: string,
): Promise<string> {
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

    return messageContent
  } catch (error) {
    console.error("[OPENAI] Error processWebOnlyMessage:", error)
    throw error
  }
}

// Función para procesar run sin enviar a WhatsApp
async function processWebRunOnly(openai: OpenAI, threadId: string, runId: string, clienteId: string): Promise<void> {
  let run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })

  while (run.status === "queued" || run.status === "in_progress") {
    await wait(1000)
    run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })
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

      const url = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs` // FIX: 'url' variable declared
      const submitResponse = await fetch(url, {
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
      signal: createTimeoutSignal(30000),
    })

    if (!response.ok) {
      return `Error HTTP: ${response.status}`
    }

    const data = await response.json()
    return JSON.stringify(data)
  } catch (error) {
    console.error("[TOOLS] Error obteniendo obras sociales:", error)
    return "Error al obtener obras sociales"
  }
}

// Función para reservar turno
export async function reservarTurno(clienteId: string, turnoId: string, pacienteDatos: any): Promise<string> {
  try {
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      return JSON.stringify({
        exito: false,
        error: "URL de API no configurada",
      })
    }

    const requestBody = {
      Cliente_Id: clienteId,
      Action: "set_turno",
      Agenda_Id: turnoId,
      Paciente_Nombre: pacienteDatos.nombre || "",
      Paciente_Apellido: pacienteDatos.apellido || "",
      Paciente_DNI: pacienteDatos.dni || "",
      Paciente_Telefono: pacienteDatos.telefono || "",
      Paciente_Email: pacienteDatos.email || "",
      // Campos opcionales que pueden venir en pacienteDatos
      ...(pacienteDatos.fecha_nac && { Paciente_Fecha_Nac: pacienteDatos.fecha_nac }),
      ...(pacienteDatos.direccion && { Paciente_Direccion: pacienteDatos.direccion }),
      ...(pacienteDatos.localidad && { Paciente_Localidad: pacienteDatos.localidad }),
      ...(pacienteDatos.provincia && { Paciente_Provincia: pacienteDatos.provincia }),
      ...(pacienteDatos.sexo && { Paciente_Sexo: pacienteDatos.sexo }),
      ...(pacienteDatos.tipo_doc && { Paciente_Tipo_Doc: pacienteDatos.tipo_doc }),
      ...(pacienteDatos.obra_social_id && { Deudor_Id: pacienteDatos.obra_social_id }),
      ...(pacienteDatos.plan_id && { Plan_Id: pacienteDatos.plan_id }),
      ...(pacienteDatos.nro_afiliado && { Nro_Afiliado: pacienteDatos.nro_afiliado }),
      ...(pacienteDatos.motivo && { Turno_Motivo: pacienteDatos.motivo }),
      ...(pacienteDatos.comentarios && { Comentarios: pacienteDatos.comentarios }),
    }

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: createTimeoutSignal(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[TOOLS] Error HTTP ${response.status} en reservarTurno:`, errorText)
      return JSON.stringify({
        exito: false,
        error: `Error HTTP: ${response.status} - ${errorText}`,
      })
    }

    const data = await response.json()

    if (data.error) {
      return JSON.stringify({
        exito: false,
        error: data.error,
        mensaje: "Error al reservar el turno. Por favor, intenta nuevamente o contacta a la clínica.",
      })
    }

    if (data.success === false) {
      return JSON.stringify({
        exito: false,
        error: data.message || data.error || "Error desconocido",
        mensaje: "No se pudo completar la reserva del turno.",
      })
    }

        try {
          const phoneNumber = pacienteDatos.telefono || "unknown"
          const isPendingReschedule = await checkAndClearPendingReschedule(clienteId, phoneNumber)
          const eventType = isPendingReschedule ? "rescheduled" : "new_appointment"
          
          await trackAppointmentEvent({
            clienteId: clienteId,
            phoneNumber: phoneNumber,
            eventType: eventType,
            timestamp: new Date().toISOString(),
            appointmentInfo: {
              turnoId: turnoId,
              paciente: pacienteDatos,
            },
          })
        } catch (statsError) {
          console.error(`[TOOLS] Error al registrar estadística de reserva:`, statsError)
    }

    return JSON.stringify({
      exito: true,
      datos: data,
      mensaje: "Turno reservado correctamente",
    })
  } catch (error) {
    console.error("[TOOLS] Error reservando turno:", error)
    return JSON.stringify({
      exito: false,
      error: error instanceof Error ? error.message : "Error desconocido",
      mensaje: "Error al reservar el turno",
    })
  }
}

// Función para obtener datos de sede (nueva herramienta)
export async function obtenerDatosSedeHerramienta(clienteId: string, sedeId: string): Promise<string> {
  try {
    const sedeData = await obtenerDatosSede(clienteId, sedeId)

    if (sedeData && sedeData.success && sedeData.sede) {
      return formatearDatosSede(sedeData.sede)
    } else {
      return "No se pudieron obtener los datos de la sede solicitada"
    }
  } catch (error) {
    console.error("[TOOLS] Error obteniendo datos de sede:", error)
    return "Error al obtener los datos de la sede"
  }
}

// Nueva función para obtener listado de todas las sedes
export async function obtenerSedesHerramienta(clienteId: string): Promise<string> {
  try {
    const resultado = await obtenerTodasLasSedes(clienteId)

    if (resultado.success && resultado.sedes && Array.isArray(resultado.sedes)) {
      return JSON.stringify({
        exito: true,
        sedes: resultado.sedes,
        total: resultado.total || resultado.sedes.length,
        mensaje: `Se encontraron ${resultado.sedes.length} sedes.`,
      })
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error || "No se encontraron sedes disponibles.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error obteniendo sedes:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al obtener las sedes.",
    })
  }
}

// Función para validar DNI
export async function validarDni(clienteId: string, dni: string): Promise<string> {
  try {
    const resultado = await buscarPaciente(clienteId, { dni })

    if (resultado.exito && resultado.datos) {
      const response: any = {
        exito: true,
        paciente: resultado.datos,
        mensaje: "DNI validado correctamente",
      }

      // Agregar turnos_proximos si existen
      if ((resultado as any).turnosProximos && (resultado as any).turnosProximos.length > 0) {
        response.turnos_proximos = (resultado as any).turnosProximos
      } else {
        response.turnos_proximos = []
      }

      // Agregar es_primera_vez si existe
      if ((resultado as any).esPrimeraVez !== undefined && (resultado as any).esPrimeraVez !== null) {
        response.es_primera_vez = (resultado as any).esPrimeraVez
      }

      return JSON.stringify(response)
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontró un paciente con ese DNI",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error validando DNI:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar el DNI",
    })
  }
}

// Función para validar teléfono
export async function validarTelefono(clienteId: string, telefono: string): Promise<string> {
  try {
    const resultado = await buscarPaciente(clienteId, { telefono })

    if (resultado.exito && resultado.datos) {
      const response: any = {
        exito: true,
        paciente: resultado.datos,
        mensaje: "Paciente encontrado por número de teléfono",
      }

      // Add turnos_proximos if available
      if ((resultado as any).turnosProximos && (resultado as any).turnosProximos.length > 0) {
        response.turnos_proximos = (resultado as any).turnosProximos
      }

      return JSON.stringify(response)
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontró un paciente con ese número de teléfono",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error validando teléfono:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar el número de teléfono",
    })
  }
}

// Función para buscar profesionales
export async function buscarProfesionalesHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    const resultado = await buscarProfesionales(clienteId, busqueda)

    if (resultado.exito && resultado.datos && Array.isArray(resultado.datos)) {
      return JSON.stringify({
        exito: true,
        profesionales: resultado.datos,
        total: resultado.datos.length,
        mensaje: `Se encontraron ${resultado.datos.length} profesionales`,
      })
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron profesionales con ese criterio de búsqueda",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error buscando profesionales:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al buscar profesionales",
    })
  }
}

// Función para obtener subespecialidades
export async function obtenerSubespecialidadesHerramienta(clienteId: string): Promise<string> {
  try {
    const resultado = await obtenerSubespecialidades(clienteId)

    if (resultado.exito && resultado.datos) {
      const especialidades = resultado.datos.subespecialidades || resultado.datos

      if (Array.isArray(especialidades)) {
        return JSON.stringify({
          exito: true,
          especialidades: especialidades,
          total: especialidades.length,
          mensaje: `Se encontraron ${especialidades.length} especialidades`,
        })
      } else {
        return JSON.stringify({
          exito: false,
          mensaje: "Formato de respuesta inesperado",
        })
      }
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron especialidades disponibles",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error obteniendo subespecialidades:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al obtener las especialidades",
    })
  }
}

// Función para buscar turnos disponibles
export async function buscarTurnosDisponiblesHerramienta(
  clienteId: string,
  rangoFechas?: string,
  profesional?: string,
  especialidad?: string,
  profesionalId?: string,
  sedeId?: string,
  pacienteDNI?: string,
  subespecialidadId?: string,
  obraSocialId?: string,
): Promise<string> {
  try {
    if (!rangoFechas) {
      const today = new Date()
      const nextWeek = new Date(today)
      nextWeek.setDate(today.getDate() + 7)

      const formatDate = (date: Date) => date.toISOString().split("T")[0]
      rangoFechas = `${formatDate(today)} a ${formatDate(nextWeek)}`
    }

    const resultado = await buscarTurnosDisponibles(
      rangoFechas,
      profesional,
      especialidad,
      profesionalId,
      clienteId,
      sedeId,
      pacienteDNI,
      subespecialidadId,
      obraSocialId,
    )

    if (resultado.exito && resultado.datos) {
      if (resultado.datos.multiple) {
        return JSON.stringify({
          exito: true,
          multiple: true,
          profesionales: resultado.datos.profesionales,
          mensaje: resultado.datos.mensaje,
        })
      }

      if (Array.isArray(resultado.datos)) {
        return JSON.stringify({
          exito: true,
          turnos: resultado.datos,
          total: resultado.datos.length,
          mensaje: `Se encontraron ${resultado.datos.length} turnos disponibles`,
        })
      }

      return JSON.stringify({
        exito: true,
        datos: resultado.datos,
      })
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron turnos disponibles para los criterios especificados",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error buscando turnos disponibles:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al buscar turnos disponibles",
    })
  }
}

// Función para validar obra social
export async function validarObraSocialHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    const resultado = await validarObraSocial(clienteId, busqueda)

    if (resultado.exito && resultado.datos) {
      const { obras_sociales, total_encontradas, busqueda_realizada } = resultado.datos

      return JSON.stringify({
        exito: true,
        obras_sociales: obras_sociales,
        total: total_encontradas,
        busqueda: busqueda_realizada,
        mensaje: `Se encontraron ${total_encontradas} obras sociales que coinciden con "${busqueda_realizada}"`,
      })
    } else {
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || `No se encontraron obras sociales que coincidan con "${busqueda}"`,
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error validando obra social:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar la obra social",
    })
  }
}

// Implementar la nueva herramienta para registrar eventos de cita
export async function registrarEventoCitaHerramienta(
  clienteId: string,
  evento: string,
  turnoId: string,
  motivo?: string,
): Promise<string> {
  try {
    // Validar entrada
    if (!evento || !turnoId) {
      return JSON.stringify({
        exito: false,
        mensaje: "El evento y el ID del turno son requeridos.",
      })
    }

    // Llamar a la función de la API para registrar el evento
    const resultado = await trackAppointmentEvent({
      clienteId,
      evento,
      turnoId,
      motivo: motivo || "", // Asegurarse de que motivo sea una cadena
    })

    if (resultado.success) {
      return JSON.stringify({
        exito: true,
        mensaje: `Evento "${evento}" registrado correctamente.`,
        data: resultado.data,
      })
    } else {
      console.error(`[TOOLS] Error al registrar evento "${evento}" para turno ${turnoId}:`, resultado.error)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.message || "No se pudo registrar el evento de la cita.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error en registrarEventoCitaHerramienta:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error interno al registrar el evento de la cita.",
    })
  }
}

// Implementar la función cancelarTurnoHerramienta
export async function cancelarTurnoHerramienta(
  clienteId: string,
  fecha: string, // Changed from turnoId
  motivo: string, // Added as required
  pacienteDatos: { dni: string; telefono: string }, // Added as required
): Promise<string> {
  try {
    // Validar parámetros requeridos
    if (!fecha) {
      return JSON.stringify({
        exito: false,
        mensaje: "La fecha del turno es requerida para cancelarlo.",
      })
    }

    if (!motivo) {
      return JSON.stringify({
        exito: false,
        mensaje: "El motivo de la cancelación es requerido.",
      })
    }

    if (!pacienteDatos?.dni || !pacienteDatos?.telefono) {
      return JSON.stringify({
        exito: false,
        mensaje: "Se requieren el DNI y teléfono del paciente para cancelar el turno.",
      })
    }

    // Llamar a la función de la API para cancelar el turno
    const resultado = await apiCancelarTurno(clienteId, {
      // Use 'fecha' instead of 'turno_id'
      fecha: fecha,
      motivo: motivo,
      paciente_datos: pacienteDatos,
    })

    // Manejar respuesta con el nuevo formato de la API
    if (resultado.success) {
      // Formatear respuesta para OpenAI
      const response: any = {
        exito: true,
        fecha: resultado.fecha,
        cantidad_cancelados: resultado.cantidad_cancelados,
        mensaje: resultado.mensaje,
      }

      if (resultado.turnos_cancelados?.length > 0) {
        response.turnos_cancelados = resultado.turnos_cancelados
      }

      if (resultado.turnos_no_cancelables?.length > 0) {
        response.turnos_no_cancelables = resultado.turnos_no_cancelables
        response.cantidad_no_cancelables = resultado.cantidad_no_cancelables
      }

      return JSON.stringify(response)
    } else {
      return JSON.stringify({
        exito: false,
        fecha: resultado.fecha,
        mensaje: resultado.mensaje || "No se pudo cancelar el turno.",
        turnos_no_cancelables: resultado.turnos_no_cancelables,
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error en cancelarTurnoHerramienta:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error interno al cancelar el turno.",
    })
  }
}

// Implementar la función confirmarTurnoHerramienta
export async function confirmarTurnoHerramienta(
  clienteId: string,
  fecha: string, // Changed from turnoId
  pacienteDatos: { dni: string; telefono: string }, // Changed from { turno_id: string; paciente_datos: any }
): Promise<string> {
  try {
    // Validar entrada
    if (!fecha) {
      return JSON.stringify({
        exito: false,
        mensaje: "La fecha del turno es requerida para confirmarlo.",
      })
    }
    if (!pacienteDatos || !pacienteDatos.dni || !pacienteDatos.telefono) {
      return JSON.stringify({
        exito: false,
        mensaje: "Los datos del paciente (DNI y teléfono) son requeridos para la confirmación.",
      })
    }

    // Llamar a la función de la API para confirmar el turno
    const resultado = await confirmarTurno(clienteId, {
      // Use 'fecha' instead of 'turno_id'
      fecha: fecha,
      paciente_datos: pacienteDatos,
    })

    if (resultado.exito || resultado.success) {
      return JSON.stringify({
        exito: true,
        mensaje: resultado.mensaje || "Tu turno ha sido confirmado correctamente.",
        data: resultado.datos || resultado.data,
      })
    } else {
      return JSON.stringify({
        exito: false,
        mensaje:
          resultado.error?.mensaje || resultado.error?.message || resultado.mensaje || "No se pudo confirmar el turno.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] Error en confirmarTurnoHerramienta:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error interno al confirmar el turno.",
    })
  }
}

// Tiempo máximo de espera para la respuesta de OpenAI (en milisegundos)
const OPENAI_TIMEOUT = Number.parseInt(process.env.OPENAI_TIMEOUT || "45000", 10)
const EARLY_WARNING_TIME = 30000 // 30 seconds

// Si el run queda en "queued" por más de este tiempo, cancelar y reintentar
const QUEUED_TIMEOUT = Number.parseInt(process.env.QUEUED_TIMEOUT || "60000", 10) // 60 segundos por defecto

// Número máximo de reintentos
const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || "3", 10)

// Tiempo de espera entre reintentos (en milisegundos)
const RETRY_DELAY = Number.parseInt(process.env.RETRY_DELAY || "2000", 10)

const CANCEL_WAIT_TIMEOUT = 10000 // 10 segundos máximo para esperar cancelación

const CANCELLING_WAIT_TIMEOUT = 30000 // 30 segundos para esperar que un run en cancelling termine

function calculateBackoffDelay(retryCount: number, baseDelay: number = RETRY_DELAY): number {
  // Exponential backoff: 2s, 4s, 8s, 16s...
  const exponentialDelay = baseDelay * Math.pow(2, retryCount)
  // Add jitter (±20%) to prevent thundering herd
  const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5)
  return Math.floor(exponentialDelay + jitter)
}

// Función para obtener una instancia de OpenAI
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

// Función para esperar un tiempo determinado
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

async function getUserPhoneNumberFromThread(threadId: string): Promise<string | null> {
  try {
    const thread = await getOpenAIClient().beta.threads.retrieve(threadId)
    if (thread.metadata && thread.metadata.name) {
      const parts = thread.metadata.name.split("-")
      if (parts.length >= 2) {
        return parts[1]
      }
    }
    return null
  } catch (error) {
    console.error(`[OPENAI] Error obteniendo número de teléfono del thread:`, error)
    return null
  }
}

async function getPhoneNumberFromThread(threadId: string, configId: string): Promise<string | null> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return null

    const pattern = `thread:*:${configId}`
    let cursor = 0

    do {
      const result = await redisClient.scan(cursor, {
        match: pattern,
        count: 100,
      })

      cursor = result[0]
      const keys = result[1]

      for (const key of keys) {
        const threadData = await redisClient.get(key)
        if (typeof threadData === "string") {
          const threadInfo = JSON.parse(threadData)
          if (threadInfo.threadId === threadId) {
            return threadInfo.phoneNumber || key.split(":")[1]
          }
        } else if (threadData && typeof threadData === "object") {
          const threadInfo = threadData as any
          if (threadInfo.threadId === threadId) {
            return threadInfo.phoneNumber || key.split(":")[1]
          }
        }
      }
    } while (cursor !== 0)

    return null
  } catch (error) {
    console.error(`[OPENAI] Error obteniendo número de teléfono del thread:`, error)
    return null
  }
}

async function cancelRunAndWait(threadId: string, runId: string): Promise<boolean> {
  const startTime = Date.now()

  try {
    // Solicitar cancelación
    const cancelResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
    })

    if (!cancelResponse.ok) {
      const errorText = await cancelResponse.text()
      console.error(`[OPENAI] Error en cancelación de run: ${cancelResponse.status} ${errorText}`)
      return false
    }

    let attempts = 0
    const maxAttempts = 60 // 60 intentos x 500ms = 30 segundos máximo

    while (Date.now() - startTime < CANCELLING_WAIT_TIMEOUT && attempts < maxAttempts) {
      attempts++
      await wait(500)

      try {
        const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
        })

        if (!statusResponse.ok) continue

        const runStatus = await statusResponse.json()

        // Estados terminales - el run ya no está activo
        if (["cancelled", "failed", "completed", "expired"].includes(runStatus.status)) {
          return true
        }
      } catch (checkError) {
        console.error(`[OPENAI] Error verificando estado de run:`, checkError)
      }
    }

    return false
  } catch (error) {
    console.error(`[OPENAI] Error cancelando run:`, error)
    return false
  }
}

async function waitForCancellingRunToFinish(threadId: string, runId: string): Promise<boolean> {
  const startTime = Date.now()
  let attempts = 0
  const maxAttempts = 60 // 60 intentos x 500ms = 30 segundos máximo

  while (Date.now() - startTime < CANCELLING_WAIT_TIMEOUT && attempts < maxAttempts) {
    attempts++
    await wait(500)

    try {
      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!statusResponse.ok) continue

      const runStatus = await statusResponse.json()

      // Estados terminales - el run ya no está activo
      if (["cancelled", "failed", "completed", "expired"].includes(runStatus.status)) {
        return true
      }
    } catch (error) {
      // Ignorar errores y seguir intentando
    }
  }

  return false
}

// Helper function to create a new thread
async function createNewThread(
  openai: OpenAI,
  assistantId: string,
  initialMessage: string,
  phoneNumber: string,
  configId: string,
): Promise<string | null> {
  try {
    const thread = await openai.beta.threads.create()

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: initialMessage,
    })

    // Guardar info del thread en Redis para poder recuperar el número de teléfono
    const redisClient = getRedisClient()
    if (redisClient) {
      await redisClient.set(
        `thread:${nanoid()}:${configId}`,
        JSON.stringify({ threadId: thread.id, phoneNumber, configId }),
        {
          EX: 60 * 60 * 24 * 7, // Expire after 7 days
        },
      )
    }

    return thread.id
  } catch (error) {
    console.error(`[OPENAI] Error creando nuevo thread:`, error)
    return null
  }
}

// Helper function to create a new thread when a run is stuck
async function createNewThreadForStuckRun(
  oldThreadId: string,
  phoneNumberId: string,
): Promise<{ success: boolean; newThreadId?: string; userPhone?: string }> {
  try {
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) return { success: false }

    // Obtener el número de teléfono del usuario del thread viejo
    const userPhone = await getPhoneNumberFromThread(oldThreadId, config.id)
    if (!userPhone) return { success: false }

    // Crear nuevo thread en OpenAI
    const openai = getOpenAIClient()
    const newThread = await openai.beta.threads.create({
      metadata: {
        name: `whatsapp-${userPhone}-${config.id}`,
        previousThread: oldThreadId,
        reason: "stuck_run_recovery",
      },
    })

    // Actualizar el thread en Redis para este usuario
    const redis = await getRedisClient()
    if (redis) {
      const threadKey = `thread:${userPhone}:${config.id}`
      const threadData = {
        threadId: newThread.id,
        phoneNumber: userPhone,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        previousThreadId: oldThreadId,
      }
      await redis.set(threadKey, JSON.stringify(threadData))
      await redis.expire(threadKey, 24 * 60 * 60)
    }

    return {
      success: true,
      newThreadId: newThread.id,
      userPhone,
    }
  } catch (error) {
    console.error(`[OPENAI] Error creando nuevo thread para stuck run:`, error)
    return { success: false }
  }
}

// Función para obtener respuesta del asistente
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
  userPhoneNumber?: string,
) {
  const openai = getOpenAIClient()

  try {
    if (!threadId) {
      throw new Error(`[OPENAI] threadId inválido (${threadId}) — no se puede crear el run`)
    }

    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    // Usar safelyAddMessageToThread para verificar y esperar a que se completen los runs activos
    await safelyAddMessageToThread(threadId, {
      role: "user",
      content: message,
    })

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    await processRunWithCorrectFlow(
      openai,
      threadId,
      run.id,
      config.accessToken,
      phoneNumberId,
      config.cliente_id || "",
      userPhoneNumber,
    )

    return { success: true }
  } catch (error) {
    console.error("[OPENAI] Error en getAssistantResponse:", error)
    await logError("openai", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para procesar run con flujo correcto
export async function processRunWithCorrectFlow(
  openai: OpenAI,
  threadId: string,
  runId: string,
  accessToken: string,
  phoneNumberId: string,
  clienteId: string,
  userPhoneNumber?: string, // Made optional for the initial call from handleAssistantSwitch
  retryCount = 0, // Changed from isRetry to retryCount
): Promise<{ success: boolean }> {
  try {
    let run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })

    const MAX_ITERATIONS = 30
    let iterations = 0

    while (run.status === "queued" || run.status === "in_progress" || run.status === "requires_action") {
      if (iterations >= MAX_ITERATIONS) {
        throw new Error(`Se alcanzó el límite de iteraciones (${MAX_ITERATIONS})`)
      }

      if (run.status === "requires_action" && run.required_action?.type === "submit_tool_outputs") {
        const toolCalls = run.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []
        let assistantSwitched = false

        for (const toolCall of toolCalls) {
          // Check if toolCall is of type 'function' before accessing .function
          if (toolCall.type === "function") {
            const functionName = toolCall.function.name
            const functionArgs = JSON.parse(toolCall.function.arguments)

            if (functionName.startsWith("route_to_")) {
              // Get user phone number (if not already provided)
              const currentUserPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))

              if (!currentUserPhoneNumber) {
                console.error(`[OPENAI-TOOLS] No se pudo obtener el número de teléfono para switch de asistente.`)
                // Add an error output for this tool call if we can't get the phone number
                toolOutputs.push({
                  tool_call_id: toolCall.id,
                  output: JSON.stringify({
                    success: false,
                    message: `Error interno: No se pudo obtener el número de teléfono del usuario para el cambio de asistente.`,
                  }),
                })
                continue // Skip to next tool call
              }

              const switchResult = await handleAssistantSwitch(
                openai,
                threadId,
                runId, // Pass the current runId to cancel it
                functionName,
                functionArgs,
                phoneNumberId,
                accessToken,
                clienteId,
                currentUserPhoneNumber, // Use the retrieved phone number
              )

              if (switchResult.switchedAssistant) {
                assistantSwitched = true
                break // Exit the loop since we've switched assistants
              } else {
                // If assistant switch failed, add an error output for this tool call
                toolOutputs.push({
                  tool_call_id: toolCall.id,
                  output: JSON.stringify({
                    success: false,
                    message: `No se pudo realizar el switch de asistente para ${functionName}`,
                  }),
                })
              }
            } else {
              // Call executeToolCall for non-routing functions
              const output = await executeToolCall(
                toolCall,
                phoneNumberId,
                accessToken,
                clienteId,
                threadId,
                userPhoneNumber,
              )
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: output,
              })
            }
          }
        }

        if (assistantSwitched) {
          // handleAssistantSwitch ya canceló el run original y procesó el nuevo.
          return { success: true }
        }

        try {
          run = await openai.beta.threads.runs.submitToolOutputsAndPoll(run.id, {
            thread_id: threadId,
            tool_outputs: toolOutputs,
          })
        } catch (error: any) {
          console.error(`[OPENAI] Error submitToolOutputsAndPoll:`, error)
          throw error
        }
      } else {
        await wait(1000)
        run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })
      }
      iterations++
    }

    // Re-fetch run status after the loop
    run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })

    if (run.status === "completed") {
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 10, // Aumentar límite para capturar múltiples mensajes
        run_id: runId, // ⚠️ CRÍTICO: Filtrar solo mensajes de ESTE run específico
      })

      // Filtrar solo mensajes del asistente de este run
      const assistantMessages = messages.data.filter((msg) => msg.role === "assistant" && msg.run_id === runId)

      if (assistantMessages.length === 0) {
        throw new Error("No se encontraron mensajes del asistente")
      }

      // Concatenar TODOS los mensajes del asistente de este run (en orden correcto)
      let messageContent = ""
      for (const message of assistantMessages.reverse()) {
        // Reverse para orden cronológico
        for (const content of message.content) {
          if (content.type === "text") {
            messageContent += content.text.value + "\n"
          }
        }
      }

      // Limpiar espacios en blanco extra
      messageContent = messageContent.trim()

      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (!config) {
        throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      }

      const finalUserPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))
      if (!finalUserPhoneNumber) {
        throw new Error(`No se pudo obtener el número de teléfono para el thread ${threadId}`)
      }

      await saveConversationMessage({
        id: nanoid(),
        role: "assistant",
        content: messageContent,
        timestamp: new Date().toISOString(),
        phoneNumber: finalUserPhoneNumber,
        configId: config.id,
      })

      await sendWhatsAppMessage(phoneNumberId, accessToken, finalUserPhoneNumber, messageContent)
      await incrementMetric("messages_sent")

      return { success: true }
    } else if (run.status === "failed") {
      throw new Error(`Run falló: ${run.last_error?.message}`)
    } else {
      throw new Error(`Estado inesperado del run: ${run.status}`)
    }
  } catch (error: any) {
    // Changed to 'any' to access error.message property
    console.error("[OPENAI] Error en processRunWithCorrectFlow:", error)

    const isTimeout = error.message && error.message.includes("Timeout esperando run")
    const isRateLimitError = error.message && error.message.includes("Please try again in")
    const isActiveRunError = error.message && error.message.includes("already has an active run")
    const isQueuedTimeout = error.message && error.message.includes("Run atascado en cola")

    // Check if we should retry
    if (retryCount < MAX_RETRIES) {
      let waitTime = RETRY_DELAY

      // Calculate wait time based on error type
      if (isRateLimitError) {
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000
        }
      } else if (isQueuedTimeout) {
        waitTime = 3000
      } else if (isTimeout || isActiveRunError) {
        waitTime = calculateBackoffDelay(retryCount)
      } else {
        waitTime = calculateBackoffDelay(retryCount)
      }

      await wait(waitTime)

      try {
        const activeRuns = await checkForActiveRuns(threadId)

        if (activeRuns.hasActive && activeRuns.runId) {
          if (activeRuns.status === "cancelling") {
            const finished = await waitForCancellingRunToFinish(threadId, activeRuns.runId)
            if (!finished) {
              return {
                success: false,
                response: "Lo siento, hubo un problema técnico procesando tu respuesta. ¿Podrías enviar nuevamente tu última respuesta?",
                error: "Run stuck in cancelling state - requesting user retry",
              }
            }
          } else {
            const cancelled = await cancelRunAndWait(threadId, activeRuns.runId)
            if (!cancelled) {
              return {
                success: false,
                response: "Lo siento, hubo un problema técnico procesando tu respuesta. ¿Podrías enviar nuevamente tu última respuesta?",
                error: `Could not cancel active run ${activeRuns.runId} - requesting user retry`,
              }
            }
          }
        }

        const newRun = await openai.beta.threads.runs.create(threadId, {
          assistant_id: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
        })

        return processRunWithCorrectFlow(
          openai,
          threadId,
          newRun.id,
          accessToken,
          phoneNumberId,
          clienteId,
          userPhoneNumber,
          retryCount + 1,
        )
      } catch (retryError: any) {
        console.error(`[OPENAI] Error creando nuevo run para reintento:`, retryError)
        // Fall through to final error handling
      }
    }

    try {
      let errorMessage =
        "Lo siento, no pude procesar tu consulta en este momento. Por favor, intenta nuevamente en unos momentos."

      if (isQueuedTimeout) {
        errorMessage =
          "Lo siento, los servidores están experimentando alta demanda. Por favor, intenta nuevamente en unos minutos."
      } else if (isTimeout) {
        errorMessage =
          "Lo siento, tu consulta está tomando más tiempo del esperado. Por favor, intenta nuevamente en unos momentos."
      }

      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config) {
        const finalUserPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))
        if (finalUserPhoneNumber) {
          await saveConversationMessage({
            id: nanoid(),
            role: "assistant",
            content: errorMessage,
            timestamp: new Date().toISOString(),
            phoneNumber: finalUserPhoneNumber,
            configId: config.id,
            messageType: "error",
          })

          await sendWhatsAppMessage(phoneNumberId, accessToken, finalUserPhoneNumber, errorMessage)
        }
      }
    } catch (sendError) {
      console.error(`[OPENAI] Error enviando mensaje de error:`, sendError)
    }

    // Log error for monitoring
    if (isQueuedTimeout) {
      await logError("openai_queued_timeout", error instanceof Error ? error : new Error(String(error)))
    } else if (isTimeout) {
      await logError("openai_timeout", error instanceof Error ? error : new Error(String(error)))
    } else {
      await logError("openai_run", error instanceof Error ? error : new Error(String(error)))
    }

    return { success: false, error: isQueuedTimeout ? "queued_timeout" : isTimeout ? "timeout" : "error" }
  }
}

// Helper function to execute a tool call (used internally)
async function executeToolCall(
  toolCall: any,
  phoneNumberId: string,
  accessToken: string,
  clienteId: string,
  threadId: string, // Added threadId parameter
  userPhoneNumber?: string, // Added userPhoneNumber parameter
): Promise<string> {
  const functionName = toolCall.function.name
  const functionArgs = JSON.parse(toolCall.function.arguments)

  // </CHANGE> Start of new code block
  if (functionName === "request_human_support") {
    try {
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (!config) {
        return JSON.stringify({
          success: false,
          message: "Error interno: no se pudo procesar la solicitud",
        })
      }

      const finalPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))
      if (!finalPhoneNumber) {
        return JSON.stringify({
          success: false,
          message: "Error interno: no se pudo identificar el usuario",
        })
      }

      // Check feature flags for this client
      const flags = await getEffectiveFeatureFlags(config.id)

      if (!flags.humanSupport) {
        // Human support not configured for this client — fall back to generic message
        const fallbackMsg =
          "Entiendo tu consulta. En este momento no puedo ayudarte con esto desde aquí. Te recomiendo comunicarte directamente con la clínica."
        await sendWhatsAppMessage(phoneNumberId, accessToken, finalPhoneNumber, fallbackMsg)
        return JSON.stringify({ success: false, message: "Human support not enabled for this client" })
      }

      if (flags.humanSupportOfferToPatient) {
        // Mode C: offer the patient a choice first, don't create session yet
        const offerParams = {
          configId: config.id,
          tenantId: config.cliente_id || "unknown",
          threadId,
          assistantId: config.whatsappAssistantId,
          displayName: config.displayName,
          reason: functionArgs.reason,
          priority: (functionArgs.priority as "low" | "medium" | "high") || "medium",
          summary: functionArgs.summary,
          phoneNumberId,
          accessToken,
        }
        await setPendingHumanSupportOffer(config.id, finalPhoneNumber, offerParams)

        // Check if within support hours to potentially add an out-of-hours note
        const schedule = await getHumanSupportSchedule(config.id)
        const timezone = config.timezone || "America/Argentina/Buenos_Aires"
        const withinHours = isWithinHumanSupportHours(schedule, timezone)
        const clinicName = config.displayName || "la clínica"

        let offerMessage =
          `Entiendo que necesitás más ayuda. ¿Querés que te conecte con alguien del equipo de ${clinicName}?\n\n` +
          `1. Sí, quiero atención humana\n` +
          `2. No, gracias`

        if (!withinHours && schedule.length > 0) {
          const hoursStr = formatSupportHoursForPatient(schedule)
          if (hoursStr) {
            offerMessage += `\n\n_El horario de atención es ${hoursStr}. Te derivaremos, pero recibirás respuesta dentro de ese horario._`
          }
        }

        await sendWhatsAppMessage(phoneNumberId, accessToken, finalPhoneNumber, offerMessage)

        return JSON.stringify({
          success: true,
          message: "Oferta de atención humana enviada al paciente",
          withinHours,
        })
      }

      // Mode B: create session directly (no offer to patient)
      const session = await createSupportSession({
        phoneNumber: finalPhoneNumber,
        configId: config.id,
        tenantId: config.cliente_id || "unknown",
        threadId: threadId,
        assistantId: config.whatsappAssistantId,
        displayName: config.displayName,
        reason: functionArgs.reason,
        priority: functionArgs.priority || "medium",
        summary: functionArgs.summary,
      })

      const autoMessage =
        "Tu solicitud ha sido recibida. Un agente de atención al cliente se pondrá en contacto contigo pronto. Por favor, mantente atento a este chat."

      await sendWhatsAppMessage(phoneNumberId, accessToken, finalPhoneNumber, autoMessage)

      return JSON.stringify({
        success: true,
        sessionId: session.id,
        message: "Solicitud de atención humana procesada correctamente",
      })
    } catch (error) {
      console.error(`[OPENAI] Error creando sesión de soporte:`, error)
      return JSON.stringify({
        success: false,
        message: "No se pudo procesar la solicitud. Por favor, continúa con el asistente.",
      })
    }
  }
  // </CHANGE>

  const waitingMessage = generateDynamicWaitingMessage(functionName, functionArgs)
  if (waitingMessage) {
    try {
      const finalUserPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))
      if (finalUserPhoneNumber) {
        await sendWhatsAppMessage(phoneNumberId, accessToken, finalUserPhoneNumber, waitingMessage)
      }
    } catch (error) {
      console.error(`[OPENAI] Error enviando mensaje de espera para ${functionName}:`, error)
    }
  }

  const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

  // Después de una cancelación exitosa, marcar en Redis para que el NLU fallback
  // no muestre el menú de cancelación con datos del turno ya cancelado.
  if (functionName === "cancelar_turno" && userPhoneNumber) {
    try {
      const parsedResult = typeof toolResult === "string" ? JSON.parse(toolResult) : toolResult
      if (parsedResult?.exito === true) {
        const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
        if (config) {
          const redis = getRedisClient()
          if (redis) {
            await redis.setex(`turno_recently_cancelled:${config.id}:${userPhoneNumber}`, 1800, '1')
            console.info(`[OPENAI-TOOLS] Flag turno_recently_cancelled seteado: ${config.id}:${userPhoneNumber}`)
          }
        }
      }
    } catch {
      // No crítico — si falla el flag, el NLU fallback lo manejará con el contexto de la conversación
    }
  }

  return JSON.stringify(toolResult)
}

async function checkForActiveRuns(threadId: string): Promise<{
  hasActive: boolean
  runId?: string
  status?: string
}> {
  try {
    const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
    })

    if (!response.ok) return { hasActive: false }

    const data = await response.json()
    const runs = data.data || []

    // Buscar runs en estados activos
    const activeStates = ["queued", "in_progress", "cancelling", "requires_action"]
    const activeRun = runs.find((run: any) => activeStates.includes(run.status))

    if (activeRun) {
      return {
        hasActive: true,
        runId: activeRun.id,
        status: activeRun.status,
      }
    }

    return { hasActive: false }
  } catch (error) {
    console.error(`[OPENAI] Error verificando runs activos:`, error)
    return { hasActive: false }
  }
}

// Función para esperar completación del run
async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  const startTime = Date.now()
  let pollInterval = 800 // Start with 800ms for faster initial response
  const maxPollInterval = 2500 // Max 2.5 seconds between polls
  let earlyWarningSent = false
  let queuedStartTime: number | null = null

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
  let lastStatus = run.status

  if (run.status === "queued") {
    queuedStartTime = Date.now()
  }

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++
    const elapsed = Date.now() - startTime

    if (run.status === "queued") {
      if (queuedStartTime === null) {
        queuedStartTime = Date.now()
      }
      const queuedElapsed = Date.now() - queuedStartTime

      if (queuedElapsed > QUEUED_TIMEOUT) {
        await cancelRunAndWait(threadId, runId)
        throw new Error(`Run atascado en cola: ${queuedElapsed}ms en estado queued`)
      }
    } else {
      queuedStartTime = null
    }

    if (!earlyWarningSent && elapsed > EARLY_WARNING_TIME) {
      earlyWarningSent = true
    }

    if (elapsed > OPENAI_TIMEOUT) {
      await cancelRunAndWait(threadId, runId)
      throw new Error(`Timeout esperando run: ${OPENAI_TIMEOUT}ms (estado: ${run.status})`)
    }

    if (run.status !== lastStatus) {
      lastStatus = run.status
    }

    await wait(pollInterval)

    if (pollInterval < maxPollInterval) {
      pollInterval = Math.min(pollInterval + 400, maxPollInterval)
    }

    run = await makeDirectAPICall(threadId, runId)
  }

  return run
}
