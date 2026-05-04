import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId, updateThreadId } from "@/lib/db"
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
import { createSupportSession } from "./human-support"
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

  console.log(`[OPENAI] 📊 Respuesta ORIGINAL completa (${originalLength} chars):`)
  console.log(`[OPENAI] 📊 ${responseStr}`)

  if (responseStr.length <= maxLength) {
    console.log(`[OPENAI] ✅ Respuesta NO truncada, se envía completa a OpenAI`)
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
      console.log(`[OPENAI] 📤 Respuesta TRUNCADA que se envía a OpenAI:`)
      console.log(`[OPENAI] 📤 ${JSON.stringify(truncatedResponse)}`)
      return truncatedResponse
    }
  }

  // Fallback: truncar el string completo
  const truncatedString = responseStr.substring(0, maxLength - 100) + "... [TRUNCADO]"
  const fallbackResponse = {
    exito: response.exito || false,
    datos: truncatedString,
    _truncated: true,
    _originalLength: originalLength,
  }
  console.log(`[OPENAI] 📤 Respuesta TRUNCADA (fallback) que se envía a OpenAI:`)
  console.log(`[OPENAI] 📤 ${JSON.stringify(fallbackResponse)}`)
  return fallbackResponse
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
  console.log(`[OPENAI-SWITCH] 🔀 Detectada función de routing: ${functionName}`)

  try {
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[OPENAI-SWITCH] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      return { switchedAssistant: false }
    }

    const newAssistantId = getAssistantIdByFunction(config, functionName)

    if (!newAssistantId) {
      console.log(`[OPENAI-SWITCH] ⚠️ No se encontró asistente configurado para la función: ${functionName}`)
      console.log(`[OPENAI-SWITCH] ℹ️Continuing without switching`)
      return { switchedAssistant: false }
    }

    console.log(`[OPENAI-SWITCH] ✅ Asistente encontrado: ${newAssistantId}`)

    // Trackear inicio de proceso de reagendamiento si es route_to_reagendamiento
    if (functionName === "route_to_reagendamiento") {
      console.log(`[OPENAI-SWITCH] 📊 Trackeando inicio de proceso de reagendamiento para ${userPhoneNumber}`)
      await trackRescheduleStarted(clienteId, userPhoneNumber)
    }

    console.log(`[OPENAI-SWITCH] 🛑 Cancelando run original: ${oldRunId}`)
    const cancelled = await cancelRunAndWait(oldThreadId, oldRunId)
    if (cancelled) {
      console.log(`[OPENAI-SWITCH] ✅ Run original cancelado exitosamente`)
    } else {
      console.log(`[OPENAI-SWITCH] ⚠️ No se pudo cancelar run original, Continuando de todas formas...`)
    }

    console.log(`[OPENAI-SWITCH] 🔄 Creando NUEVO thread para el asistente especializado...`)
    console.log(`[OPENAI-SWITCH] 📋 Argumentos recibidos:`, JSON.stringify(functionArgs, null, 2))

    const newThread = await openai.beta.threads.create({
      metadata: {
        name: `whatsapp-${userPhoneNumber}-${config.id}`,
        previousThread: oldThreadId,
        reason: "assistant_switch",
        assistantId: newAssistantId,
      },
    })
    console.log(`[OPENAI-SWITCH] ✨ Nuevo thread creado: ${newThread.id}`)

    await updateThreadId(userPhoneNumber, config.id, newThread.id, newAssistantId)
    console.log(`[OPENAI-SWITCH] 💾 Thread y AssistantId actualizados en base de datos para usuario ${userPhoneNumber}`)

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

    console.log(`[OPENAI-SWITCH] 📤 Mensaje inicial enviado al nuevo thread (con datos de sistema)`)

    const newRun = await openai.beta.threads.runs.create(newThread.id, {
      assistant_id: newAssistantId,
    })

    console.log(`[OPENAI-SWITCH] 🏃 Nuevo run creado con asistente ${newAssistantId}: ${newRun.id}`)

    console.log(`[OPENAI-SWITCH] 🔄 Procesando el nuevo run...`)
    await processRunWithCorrectFlow(
      openai,
      newThread.id,
      newRun.id,
      accessToken, // ✅ Fixed: Now passing accessToken as 4th parameter
      phoneNumberId, // ✅ Fixed: Now passing phoneNumberId as 5th parameter
      clienteId,
      userPhoneNumber, // Pass user phone number
    )
    console.log(`[OPENAI-SWITCH] ✅ Procesamiento del nuevo run completado`)

    console.log(`[OPENAI-SWITCH] ✅ Switch completado - control transferido al nuevo asistente`)

    return {
      switchedAssistant: true,
      assistantId: newAssistantId,
      newThreadId: newThread.id,
    }
  } catch (error) {
    console.error(`[OPENAI-SWITCH] ❌ Error en handleAssistantSwitch:`, error)
    return {
      switchedAssistant: false,
    }
  }
}
// Implementación directa de todas las funciones
export async function executeOpenAITool(toolName: string, args: any, clienteId: string) {
  console.log(`[OPENAI-TOOLS] Ejecutando tool: ${toolName} con args:`, args)

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
        console.log(`[OPENAI-TOOLS] 🔍 DEBUG reservar_turno:`)
        console.log(`[OPENAI-TOOLS] 🔍 args completo:`, JSON.stringify(args, null, 2))
        console.log(`[OPENAI-TOOLS] 🔍 args.agendaId:`, args.agendaId)
        console.log(`[OPENAI-TOOLS] 🔍 args.dni:`, args.dni)
        console.log(`[OPENAI-TOOLS] 🔍 args.nombre:`, args.nombre)
        console.log(`[OPENAI-TOOLS] 🔍 clienteId:`, clienteId)

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
          console.log(`[OPENAI-TOOLS] 🔍 pacienteDatos construido:`, JSON.stringify(pacienteDatos, null, 2))
          console.log(`[OPENAI-TOOLS] 🔍 Llamando reservarTurno con:`)
          console.log(`[OPENAI-TOOLS] 🔍   - clienteId: ${clienteId}`)
          console.log(`[OPENAI-TOOLS] 🔍   - agendaId: ${args.agendaId}`)
          console.log(`[OPENAI-TOOLS] 🔍   - pacienteDatos:`, pacienteDatos)

          return await reservarTurno(clienteId, args.agendaId, pacienteDatos)
        } else {
          console.log(`[OPENAI-TOOLS] 🔍 Usando formato antiguo (turno_id)`)
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
        console.log(`[OPENAI-TOOLS] 🔀 Iniciando switch de asistente para: ${toolName}`)
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
        console.log(`[OPENAI-TOOLS] 🆘 Solicitud de soporte humano recibida`)
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

      console.log(`[OPENAI] 📤 Resultados enviados a OpenAI`)

      console.log(`[OPENAI] 📤 ===== ENVIANDO A OPENAI =====`)
      console.log(`[OPENAI] 📤 Cantidad de tool outputs: ${toolOutputs.length}`)
      toolOutputs.forEach((output, index) => {
        console.log(`[OPENAI] 📤 Tool Output ${index + 1}:`)
        console.log(`[OPENAI] 📤   - tool_call_id: ${output.tool_call_id}`)
        console.log(`[OPENAI] 📤   - output (${output.output.length} chars):`)
        console.log(`[OPENAI] 📤   ${output.output}`)
      })
      console.log(`[OPENAI] 📤 ===== FIN DATOS ENVIADOS =====`)
      // </CHANGE>

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
      signal: createTimeoutSignal(30000),
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
    console.log(`[TOOLS] 📋 Datos del paciente:`, JSON.stringify(pacienteDatos, null, 2))
    console.log(`[TOOLS] 🔑 turnoId recibido:`, turnoId)

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

    console.log(`[TOOLS] 📤 Request body completo:`, JSON.stringify(requestBody, null, 2))

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
      console.error(`[TOOLS] ❌ Error HTTP ${response.status}:`, errorText)
      return JSON.stringify({
        exito: false,
        error: `Error HTTP: ${response.status} - ${errorText}`,
      })
    }

    const data = await response.json()
    console.log(`[TOOLS] 📥 Respuesta completa del proxy:`, JSON.stringify(data, null, 2))

    if (data.error) {
      console.error(`[TOOLS] ❌ Error del proxy:`, data.error)
      return JSON.stringify({
        exito: false,
        error: data.error,
        mensaje: "Error al reservar el turno. Por favor, intenta nuevamente o contacta a la cl��nica.",
      })
    }

    if (data.success === false) {
      console.error(`[TOOLS] ❌ Reserva fallida:`, data)
      return JSON.stringify({
        exito: false,
        error: data.message || data.error || "Error desconocido",
        mensaje: "No se pudo completar la reserva del turno.",
      })
    }

        console.log(`[TOOLS] ✅ Turno reservado exitosamente, registrando estadística`)
        try {
          // Verificar si hay una cancelación pendiente (dentro de las últimas 12h)
          const phoneNumber = pacienteDatos.telefono || "unknown"
          const isPendingReschedule = await checkAndClearPendingReschedule(clienteId, phoneNumber)
          
          // Si hay cancelación pendiente, es un reagendamiento real. Si no, es un turno nuevo.
          const eventType = isPendingReschedule ? "rescheduled" : "new_appointment"
          console.log(`[TOOLS] 📊 Tipo de evento detectado: ${eventType} (pending reschedule: ${isPendingReschedule})`)
          
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
          console.log(`[TOOLS] 📊 Estadística registrada para cliente ${clienteId}: ${eventType}`)
        } catch (statsError) {
          console.error(`[TOOLS] ⚠️ Error al registrar estadística:`, statsError)
          // No fallamos la reserva por error de estadísticas
    }

    return JSON.stringify({
      exito: true,
      datos: data,
      mensaje: "Turno reservado correctamente",
    })
  } catch (error) {
    console.error("[TOOLS] ❌ Error reservando turno:", error)
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

// Nueva función para obtener listado de todas las sedes
export async function obtenerSedesHerramienta(clienteId: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Obteniendo listado de sedes para cliente: ${clienteId}`)

    const resultado = await obtenerTodasLasSedes(clienteId)

    if (resultado.success && resultado.sedes && Array.isArray(resultado.sedes)) {
      console.log(`[TOOLS] ✅ Sedes obtenidas: ${resultado.sedes.length}`)
      return JSON.stringify({
        exito: true,
        sedes: resultado.sedes,
        total: resultado.total || resultado.sedes.length,
        mensaje: `Se encontraron ${resultado.sedes.length} sedes.`,
      })
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron sedes.`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error || "No se encontraron sedes disponibles.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error obteniendo sedes:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al obtener las sedes.",
    })
  }
}

// Función para validar DNI
export async function validarDni(clienteId: string, dni: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🔍 Validando DNI: ${dni} para cliente: ${clienteId}`)

    const resultado = await buscarPaciente(clienteId, { dni })

    if (resultado.exito && resultado.datos) {
      console.log(`[TOOLS] ✅ DNI validado exitosamente: ${dni}`)

      const response: any = {
        exito: true,
        paciente: resultado.datos,
        mensaje: "DNI validado correctamente",
      }

      // Agregar turnos_proximos si existen
      if ((resultado as any).turnosProximos && (resultado as any).turnosProximos.length > 0) {
        response.turnos_proximos = (resultado as any).turnosProximos
        console.log(`[TOOLS] 📅 Turnos próximos encontrados: ${(resultado as any).turnosProximos.length}`)
      } else {
        response.turnos_proximos = []
        console.log(`[TOOLS] 📅 No hay turnos próximos`)
      }

      // Agregar es_primera_vez si existe
      if ((resultado as any).esPrimeraVez !== undefined && (resultado as any).esPrimeraVez !== null) {
        response.es_primera_vez = (resultado as any).esPrimeraVez
        console.log(`[TOOLS] 🆕 Es primera vez: ${(resultado as any).esPrimeraVez}`)
      }

      return JSON.stringify(response)
    } else {
      console.log(`[TOOLS] ⚠️ DNI no encontrado: ${dni}`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontró un paciente con ese DNI",
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

// Función para validar teléfono
export async function validarTelefono(clienteId: string, telefono: string): Promise<string> {
  try {
    console.log(`[TOOLS] 📱 Validando teléfono: ${telefono} para cliente: ${clienteId}`)

    const resultado = await buscarPaciente(clienteId, { telefono })

    if (resultado.exito && resultado.datos) {
      console.log(`[TOOLS] ✅ Teléfono validado exitosamente: ${telefono}`)
      const response: any = {
        exito: true,
        paciente: resultado.datos,
        mensaje: "Paciente encontrado por número de teléfono",
      }

      // Add turnos_proximos if available
      if ((resultado as any).turnosProximos && (resultado as any).turnosProximos.length > 0) {
        response.turnos_proximos = (resultado as any).turnosProximos
        console.log(`[TOOLS] 📅 Turnos próximos encontrados: ${(resultado as any).turnosProximos.length}`)
      }

      return JSON.stringify(response)
    } else {
      console.log(`[TOOLS] ⚠️ Teléfono no encontrado: ${telefono}`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontró un paciente con ese número de teléfono",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error validando teléfono:", error)
    return JSON.stringify({
      exito: false,
      mensaje: "Error al validar el número de teléfono",
    })
  }
}

// Función para buscar profesionales
export async function buscarProfesionalesHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    console.log(`[TOOLS] 👨‍⚕️ Buscando profesionales: "${busqueda}" para cliente: ${clienteId}`)

    const resultado = await buscarProfesionales(clienteId, busqueda)

    if (resultado.exito && resultado.datos && Array.isArray(resultado.datos)) {
      console.log(`[TOOLS] ✅ Profesionales encontrados: ${resultado.datos.length}`)
      return JSON.stringify({
        exito: true,
        profesionales: resultado.datos,
        total: resultado.datos.length,
        mensaje: `Se encontraron ${resultado.datos.length} profesionales`,
      })
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

// Función para obtener subespecialidades
export async function obtenerSubespecialidadesHerramienta(clienteId: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Obteniendo subespecialidades para cliente: ${clienteId}`)

    const resultado = await obtenerSubespecialidades(clienteId)

    if (resultado.exito && resultado.datos) {
      const especialidades = resultado.datos.subespecialidades || resultado.datos

      if (Array.isArray(especialidades)) {
        console.log(`[TOOLS] ✅ Subespecialidades obtenidas: ${especialidades.length}`)
        return JSON.stringify({
          exito: true,
          especialidades: especialidades,
          total: especialidades.length,
          mensaje: `Se encontraron ${especialidades.length} especialidades`,
        })
      } else {
        console.log(`[TOOLS] ⚠️ Datos no son un array:`, resultado.datos)
        return JSON.stringify({
          exito: false,
          mensaje: "Formato de respuesta inesperado",
        })
      }
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron subespecialidades`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || "No se encontraron especialidades disponibles",
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

      console.log(`[TOOLS] 📅 No se proporcionó rango de fechas, usando por defecto: ${rangoFechas}`)
    }

    console.log(
      `[TOOLS] 🔍 Buscando turnos disponibles: rango=${rangoFechas}, profesional=${profesional}, especialidad=${especialidad}, profesional_id=${profesionalId}, sede_id=${sedeId}, paciente_dni=${pacienteDNI}, subespecialidad_id=${subespecialidadId}, obra_social_id=${obraSocialId}`,
    )

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
        console.log(`[TOOLS] ⚠️ Múltiples profesionales encontrados: ${resultado.datos.profesionales.length}`)
        return JSON.stringify({
          exito: true,
          multiple: true,
          profesionales: resultado.datos.profesionales,
          mensaje: resultado.datos.mensaje,
        })
      }

      if (Array.isArray(resultado.datos)) {
        console.log(`[TOOLS] ✅ Turnos encontrados: ${resultado.datos.length}`)
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

// Función para validar obra social
export async function validarObraSocialHerramienta(clienteId: string, busqueda: string): Promise<string> {
  try {
    console.log(`[TOOLS] 🏥 Validando obra social: "${busqueda}" para cliente: ${clienteId}`)

    const resultado = await validarObraSocial(clienteId, busqueda)

    if (resultado.exito && resultado.datos) {
      const { obras_sociales, total_encontradas, busqueda_realizada } = resultado.datos

      console.log(`[TOOLS] ✅ Obras sociales encontradas: ${total_encontradas}`)

      return JSON.stringify({
        exito: true,
        obras_sociales: obras_sociales,
        total: total_encontradas,
        busqueda: busqueda_realizada,
        mensaje: `Se encontraron ${total_encontradas} obras sociales que coinciden con "${busqueda_realizada}"`,
      })
    } else {
      console.log(`[TOOLS] ⚠️ No se encontraron obras sociales para: "${busqueda}"`)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.mensaje || `No se encontraron obras sociales que coincidan con "${busqueda}"`,
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

// Implementar la nueva herramienta para registrar eventos de cita
export async function registrarEventoCitaHerramienta(
  clienteId: string,
  evento: string,
  turnoId: string,
  motivo?: string,
): Promise<string> {
  try {
    console.log(`[TOOLS] 📅 Registrando evento "${evento}" para turno ${turnoId} (cliente: ${clienteId})`)

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
      console.log(`[TOOLS] ✅ Evento "${evento}" registrado exitosamente para turno ${turnoId}`)
      return JSON.stringify({
        exito: true,
        mensaje: `Evento "${evento}" registrado correctamente.`,
        data: resultado.data,
      })
    } else {
      console.error(`[TOOLS] ❌ Error al registrar evento "${evento}" para turno ${turnoId}:`, resultado.error)
      return JSON.stringify({
        exito: false,
        mensaje: resultado.error?.message || "No se pudo registrar el evento de la cita.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error inesperado en registrarEventoCitaHerramienta:", error)
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
    console.log(`[TOOLS] ❌ Cancelando turno para fecha: ${fecha} cliente: ${clienteId}`)
    console.log(`[TOOLS] 📝 Motivo: ${motivo}`)
    console.log(`[TOOLS] 👤 Datos del paciente:`, pacienteDatos)

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
      console.log(`[TOOLS] ✅ Turno(s) cancelado(s) exitosamente para fecha ${fecha}`)

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
      console.error(`[TOOLS] ❌ Error al cancelar turno para fecha ${fecha}:`, resultado)
      return JSON.stringify({
        exito: false,
        fecha: resultado.fecha,
        mensaje: resultado.mensaje || "No se pudo cancelar el turno.",
        turnos_no_cancelables: resultado.turnos_no_cancelables,
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error inesperado en cancelarTurnoHerramienta:", error)
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
    console.log(`[TOOLS] ✅ Confirmando turno para fecha: ${fecha} para cliente: ${clienteId}`)
    if (pacienteDatos) console.log(`[TOOLS] 👤 Datos del paciente:`, pacienteDatos)

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
      console.log(`[TOOLS] ✅ Turno del ${fecha} confirmado exitosamente.`)
      return JSON.stringify({
        exito: true,
        mensaje: resultado.mensaje || "Tu turno ha sido confirmado correctamente.",
        data: resultado.datos || resultado.data,
      })
    } else {
      console.error(`[TOOLS] ❌ Error al confirmar turno del ${fecha}:`, resultado.error)
      return JSON.stringify({
        exito: false,
        mensaje:
          resultado.error?.mensaje || resultado.error?.message || resultado.mensaje || "No se pudo confirmar el turno.",
      })
    }
  } catch (error) {
    console.error("[TOOLS] ❌ Error inesperado en confirmarTurnoHerramienta:", error)
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
  console.log(`[OPENAI] 🔍 Obteniendo número de teléfono del thread: ${threadId}`)
  try {
    const thread = await getOpenAIClient().beta.threads.retrieve(threadId)
    if (thread.metadata && thread.metadata.name) {
      const parts = thread.metadata.name.split("-")
      if (parts.length >= 2) {
        const phoneNumber = parts[1]
        console.log(`[OPENAI] ✅ Número de teléfono del thread (metadata): ${phoneNumber}`)
        return phoneNumber
      }
    }

    // Fallback: Attempt to retrieve from Redis if metadata is not enough (requires configId)
    // This part might need adjustment if configId is not readily available here.
    // For now, assuming the thread metadata is the primary source.
    console.log(`[OPENAI] ⚠️ No se pudo obtener el número de teléfono del thread vía metadata.`)
    return null
  } catch (error) {
    console.error(`[OPENAI] ❌ Error obteniendo número de teléfono del thread:`, error)
    return null
  }
}

async function getPhoneNumberFromThread(threadId: string, configId: string): Promise<string | null> {
  console.log(`[OPENAI] 🔍 Obteniendo número de teléfono para thread: ${threadId}`)

  try {
    const redisClient = getRedisClient()
    if (!redisClient) {
      console.error(`[OPENAI] ❌ Redis no disponible`)
      return null
    }

    const pattern = `thread:*:${configId}`
    console.log(`[OPENAI] 🔍 Buscando threads con patrón: ${pattern}`)

    let cursor = 0
    let keysFound = 0

    do {
      // SCAN devuelve [cursor, keys]
      const result = await redisClient.scan(cursor, {
        match: pattern,
        count: 100, // Procesar 100 claves por vez
      })

      cursor = result[0]
      const keys = result[1]
      keysFound += keys.length

      console.log(`[OPENAI] ���� SCAN cursor=${cursor}, encontradas=${keys.length}`)

      // Revisar cada clave encontrada
      for (const key of keys) {
        const threadData = await redisClient.get(key)
        if (typeof threadData === "string") {
          const threadInfo = JSON.parse(threadData)
          if (threadInfo.threadId === threadId) {
            console.log(`[OPENAI] ✅ Thread encontrado en clave: ${key}`)
            // Use the phoneNumber stored in threadData if available, otherwise derive it
            const phoneNumber = threadInfo.phoneNumber || key.split(":")[1]
            console.log(`[OPENAI] ✅ Número de teléfono: ${phoneNumber}`)
            return phoneNumber
          }
        } else if (threadData && typeof threadData === "object") {
          const threadInfo = threadData as any
          if (threadInfo.threadId === threadId) {
            console.log(`[OPENAI] ✅ Thread encontrado en clave: ${key}`)
            // Use the phoneNumber stored in threadData if available, otherwise derive it
            const phoneNumber = threadInfo.phoneNumber || key.split(":")[1]
            console.log(`[OPENAI] ✅ Número de teléfono: ${phoneNumber}`)
            return phoneNumber
          }
        }
      }
    } while (cursor !== 0) // Continuar hasta que cursor vuelva a 0

    console.error(`[OPENAI] ❌ No se encontró el thread ${threadId} después de revisar ${keysFound} claves`)
    return null
  } catch (error) {
    console.error(`[OPENAI] ❌ Error obteniendo número de teléfono del thread:`, error)
    return null
  }
}

async function cancelRunAndWait(threadId: string, runId: string): Promise<boolean> {
  const startTime = Date.now()

  try {
    console.log(`[OPENAI] 🛑 Cancelando run ${runId}`)

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
      console.error(`[OPENAI] ❌ Error en request de cancelación: ${cancelResponse.status} ${errorText}`)
      return false
    }

    console.log(`[OPENAI] 📤 Solicitud de cancelación enviada, esperando confirmación...`)

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

        if (!statusResponse.ok) {
          console.log(`[OPENAI] ⚠️ No se pudo verificar estado del run (intento ${attempts})`)
          continue
        }

        const runStatus = await statusResponse.json()

        // Solo loggear cada 5 intentos
        if (attempts % 5 === 0 || ["cancelled", "failed", "completed", "expired"].includes(runStatus.status)) {
          console.log(`[OPENAI] 🔍 Estado del run: ${runStatus.status} (intento ${attempts})`)
        }

        // Estados terminales - el run ya no está activo
        if (["cancelled", "failed", "completed", "expired"].includes(runStatus.status)) {
          console.log(`[OPENAI] ✅ Run ${runId} terminado con estado: ${runStatus.status}`)
          return true
        }

        // Si sigue en 'cancelling', continuar esperando
        if (runStatus.status === "cancelling") {
          // Solo loggear cada 10 intentos
          if (attempts % 10 === 0) {
            console.log(`[OPENAI] ⏳ Run en proceso de cancelación... (${attempts * 500}ms)`)
          }
        }
      } catch (checkError) {
        console.error(`[OPENAI] ⚠️ Error verificando estado:`, checkError)
      }
    }

    console.error(`[OPENAI] ⚠️ Timeout esperando cancelación del run ${runId} después de ${Date.now() - startTime}ms`)
    return false
  } catch (error) {
    console.error(`[OPENAI] ❌ Error cancelando run:`, error)
    return false
  }
}

async function waitForCancellingRunToFinish(threadId: string, runId: string): Promise<boolean> {
  const startTime = Date.now()
  let attempts = 0
  const maxAttempts = 60 // 60 intentos x 500ms = 30 segundos máximo

  console.log(`[OPENAI] ⏳ Esperando a que run ${runId} en estado "cancelling" termine...`)

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

      if (!statusResponse.ok) {
        continue
      }

      const runStatus = await statusResponse.json()

      // Estados terminales - el run ya no está activo
      if (["cancelled", "failed", "completed", "expired"].includes(runStatus.status)) {
        console.log(
          `[OPENAI] ✅ Run ${runId} terminó con estado: ${runStatus.status} después de ${Date.now() - startTime}ms`,
        )
        return true
      }

      // Loggear progreso cada 10 intentos
      if (attempts % 10 === 0) {
        console.log(`[OPENAI] ⏳ Run sigue en ${runStatus.status}... (${Date.now() - startTime}ms)`)
      }
    } catch (error) {
      // Ignorar errores y seguir intentando
    }
  }

  console.error(`[OPENAI] ⚠️ Timeout: run ${runId} sigue activo después de ${Date.now() - startTime}ms`)
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
    console.log(`[OPENAI] 🧵 Creando nuevo thread para ${phoneNumber}`)
    const thread = await openai.beta.threads.create()
    console.log(`[OPENAI] 🧵 Nuevo thread creado: ${thread.id}`)

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: initialMessage,
    })
    console.log(`[OPENAI] 🧵 Mensaje inicial añadido al nuevo thread`)

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
      console.log(`[OPENAI] 💾 Thread info guardada en Redis`)
    } else {
      console.error(`[OPENAI] ❌ Redis no disponible, no se pudo guardar info del thread`)
    }

    return thread.id
  } catch (error) {
    console.error(`[OPENAI] ❌ Error creando nuevo thread:`, error)
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
    if (!config) {
      console.error(`[OPENAI] ❌ No se encontró config para phoneNumberId: ${phoneNumberId}`)
      return { success: false }
    }

    // Obtener el número de teléfono del usuario del thread viejo
    const userPhone = await getPhoneNumberFromThread(oldThreadId, config.id)
    if (!userPhone) {
      console.error(`[OPENAI] ❌ No se pudo obtener número de teléfono del thread viejo`)
      return { success: false }
    }

    console.log(
      `[OPENAI] 🔄 Creando nuevo thread para usuario ${userPhone} (thread anterior bloqueado: ${oldThreadId})`,
    )

    // Crear nuevo thread en OpenAI
    const openai = getOpenAIClient()
    const newThread = await openai.beta.threads.create({
      metadata: {
        name: `whatsapp-${userPhone}-${config.id}`,
        previousThread: oldThreadId,
        reason: "stuck_run_recovery",
      },
    })

    console.log(`[OPENAI] ✅ Nuevo thread creado: ${newThread.id}`)

    // Actualizar el thread en Redis para este usuario
    const redis = await getRedisClient()
    if (!redis) {
      console.error(`[OPENAI] ❌ Redis no disponible, no se pudo actualizar el thread en Redis`)
      // Continuar sin actualizar Redis si no está disponible
    } else {
      const threadKey = `thread:${userPhone}:${config.id}`

      const threadData = {
        threadId: newThread.id,
        phoneNumber: userPhone,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        previousThreadId: oldThreadId,
      }

      await redis.set(threadKey, JSON.stringify(threadData))
      // TTL de 24 horas
      await redis.expire(threadKey, 24 * 60 * 60)

      console.log(`[OPENAI] ✅ Thread actualizado en Redis: ${threadKey} -> ${newThread.id}`)
    }

    return {
      success: true,
      newThreadId: newThread.id,
      userPhone,
    }
  } catch (error) {
    console.error(`[OPENAI] ❌ Error creando nuevo thread para stuck run:`, error)
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
  console.log(`[v0] 📥 getAssistantResponse recibió parámetros:`, {
    threadId,
    messageLength: message.length,
    phoneNumberId,
    assistantId,
    userPhoneNumber,
    userPhoneNumberType: typeof userPhoneNumber,
    userPhoneNumberUndefined: userPhoneNumber === undefined,
  })
  console.log(`[OPENAI] 🤖 Iniciando conversación`)
  console.log(`[OPENAI] 📝 Mensaje: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`)

  const openai = getOpenAIClient()

  try {
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    console.log(`[OPENAI] ⚙️ Config: ${config.displayName} | Cliente: ${config.cliente_id}`)

    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[OPENAI] 📤 Mensaje enviado a thread ${threadId}`)

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[OPENAI] 🏃 Run creado: ${run.id}`)

    console.log(`[v0] 🚀 Antes de llamar processRunWithCorrectFlow:`, {
      threadId,
      runId: run.id,
      accessToken: config.accessToken ? `${config.accessToken.substring(0, 10)}...` : "undefined",
      phoneNumberId,
      clienteId: config.cliente_id || "",
      userPhoneNumber,
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

    console.log(`[OPENAI] ✅ Conversación completada`)
    return { success: true }
  } catch (error) {
    console.error("[OPENAI] ❌ Error:", error)
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
  console.log(`[v0] 🔍 processRunWithCorrectFlow ENTRADA:`, {
    threadId,
    runId,
    accessToken: accessToken ? `${accessToken.substring(0, 10)}...` : "undefined",
    phoneNumberId,
    clienteId,
    userPhoneNumber,
    retryCount,
  })

  try {
    console.log(`[v0] 🔍 Llamando retrieve con threadId="${threadId}" runId="${runId}"`)
    let run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })
    console.log(`[v0] ✅ Retrieve exitoso, run status: ${run.status}`)

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

            console.log(`[OPENAI-TOOLS] Ejecutando tool: ${functionName} con args:`, functionArgs)

            if (functionName.startsWith("route_to_")) {
              console.log(`[OPENAI-TOOLS] 🔀 Función de routing detectada: ${functionName}`)

              // Get user phone number (if not already provided)
              const currentUserPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))

              if (!currentUserPhoneNumber) {
                console.error(
                  `[OPENAI-TOOLS] ❌ No se pudo obtener el número de teléfono del usuario para el switch de asistente.`,
                )
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
                console.log(`[OPENAI-TOOLS] ✅ Switch exitoso al asistente ${switchResult.assistantId}`)
                console.log(
                  `[OPENAI-TOOLS] 🛑 Terminando ejecución del asistente original - NO se enviarán tool outputs`,
                )
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
          console.log(`[OPENAI-TOOLS] 🔄 Assistant switched - run original cancelado`)
          // The handleAssistantSwitch function already cancels the original run and processes the new one.
          // We simply return success to indicate that this flow is handled.
          return { success: true } // Returning true to signal successful handling of the switch
        }

        console.log(`[OPENAI] 📤 Enviando resultados a OpenAI`)
        console.log(`[OPENAI] 📤 ===== ENVIANDO A OPENAI =====`)
        console.log(`[OPENAI] 📤 Cantidad de tool outputs: ${toolOutputs.length}`)
        toolOutputs.forEach((output, index) => {
          console.log(`[OPENAI] 📤 Tool Output ${index + 1}:`)
          console.log(`[OPENAI] 📤   - tool_call_id: ${output.tool_call_id}`)
          console.log(`[OPENAI] 📤   - output (${output.output.length} chars):`)
          console.log(`[OPENAI] 📤   ${output.output}`)
        })
        console.log(`[OPENAI] 📤 ===== FIN DATOS ENVIADOS =====`)

        try {
          console.log(`[v0] 🔍 Submit tool outputs - retrieve con threadId="${threadId}" runId="${run.id}"`)
          run = await openai.beta.threads.runs.submitToolOutputsAndPoll(run.id, {
            thread_id: threadId,
            tool_outputs: toolOutputs,
          })
          console.log(`[v0] ✅ Submit tool outputs completado, nuevo status: ${run.status}`)
        } catch (error: any) {
          console.error(`[OPENAI] ❌ Error submitToolOutputsAndPoll:`, error)
          // Si submitToolOutputsAndPoll falla, debemos reintentar el run completo
          // Lanzar el error para que el bloque catch principal lo maneje
          throw error
        }
      } else {
        await wait(1000)
        console.log(`[v0] 🔍 Polling retrieve con threadId="${threadId}" runId="${runId}"`)
        run = await openai.beta.threads.runs.retrieve(runId, { thread_id: threadId })
        console.log(`[v0] ✅ Polling retrieve exitoso, status: ${run.status}`)
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

      console.log(`[OPENAI] 📨 Total de mensajes encontrados para run ${runId}: ${messages.data.length}`)

      // Filtrar solo mensajes del asistente de este run
      const assistantMessages = messages.data.filter((msg) => msg.role === "assistant" && msg.run_id === runId)

      console.log(`[OPENAI] 🤖 Mensajes del asistente en este run: ${assistantMessages.length}`)

      if (assistantMessages.length === 0) {
        console.error(`[OPENAI] ❌ No se encontraron mensajes del asistente para run ${runId}`)
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

      console.log(
        `[OPENAI] 💬 Respuesta: "${messageContent.substring(0, 100)}${messageContent.length > 100 ? "..." : ""}"`,
      )

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
      console.log(`[OPENAI] 📱 Enviado a WhatsApp: ${finalUserPhoneNumber}`)

      await incrementMetric("messages_sent")

      return { success: true }
    } else if (run.status === "failed") {
      throw new Error(`Run falló: ${run.last_error?.message}`)
    } else {
      throw new Error(`Estado inesperado del run: ${run.status}`)
    }
  } catch (error: any) {
    // Changed to 'any' to access error.message property
    console.error("[OPENAI] ❌ Error en processRunWithCorrectFlow:", error)

    const isTimeout = error.message && error.message.includes("Timeout esperando run")
    const isRateLimitError = error.message && error.message.includes("Please try again in")
    const isActiveRunError = error.message && error.message.includes("already has an active run")
    const isQueuedTimeout = error.message && error.message.includes("Run atascado en cola")

    // Log error type for debugging
    if (isTimeout) {
      console.log(`[OPENAI] ⏰ Timeout detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
    } else if (isQueuedTimeout) {
      console.log(`[OPENAI] 🔄 Run atascado en cola detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
    } else if (isRateLimitError) {
      console.log(`[OPENAI] 🚦 Rate limit detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
    } else if (isActiveRunError) {
      console.log(`[OPENAI] 🔒 Run activo detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
    }

    // Check if we should retry
    if (retryCount < MAX_RETRIES) {
      let waitTime = RETRY_DELAY

      // Calculate wait time based on error type
      if (isRateLimitError) {
        // Extract suggested delay from OpenAI's error message
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000
          console.log(`[OPENAI] 🚦 Usando delay sugerido por OpenAI: ${waitTime}ms`)
        }
      } else if (isQueuedTimeout) {
        waitTime = 3000 // 3 segundos antes de reintentar
        console.log(`[OPENAI] 🔄 Reintentando rápido después de run atascado en cola: ${waitTime}ms`)
      } else if (isTimeout) {
        // Use exponential backoff for timeouts
        waitTime = calculateBackoffDelay(retryCount)
        console.log(`[OPENAI] ⏰ Usando backoff exponencial: ${waitTime}ms`)
      } else if (isActiveRunError) {
        waitTime = 5000 // Esperar 5 segundos antes de reintentar
        console.log(`[OPENAI] 🔒 Esperando ${waitTime}ms para que el run anterior termine...`)
      } else {
        // Use exponential backoff for other errors too
        waitTime = calculateBackoffDelay(retryCount)
        console.log(`[OPENAI] 🔄 Usando backoff exponencial: ${waitTime}ms`)
      }

      console.log(`[OPENAI] 🔄 Reintentando en ${waitTime}ms (intento ${retryCount + 1}/${MAX_RETRIES})...`)
      await wait(waitTime)

      try {
        console.log(`[OPENAI] 🔍 Verificando runs activos en el thread...`)
        console.log(`[v0] 🔍 Llamando checkForActiveRuns con threadId="${threadId}"`)
        const activeRuns = await checkForActiveRuns(threadId)
        console.log(`[v0] 📊 checkForActiveRuns resultado:`, activeRuns)

        if (activeRuns.hasActive && activeRuns.runId) {
          console.log(`[OPENAI] 🔒 Run activo encontrado: ${activeRuns.runId} (${activeRuns.status})`)

          if (activeRuns.runId) {
            if (activeRuns.status === "cancelling") {
              // Si ya está en cancelling, solo esperar a que termine (no intentar cancelar de nuevo)
              console.log(`[OPENAI] ⏳ Run ya está en cancelling, esperando a que termine...`)
              const finished = await waitForCancellingRunToFinish(threadId, activeRuns.runId)

              if (!finished) {
                // Si después de 30 segundos sigue en cancelling, NO crear nuevo thread
                // En su lugar, devolver mensaje de error manteniendo el contexto
                console.log(`[OPENAI] ⚠️ Run atascado en cancelling, solicitando reintento al usuario...`)
                
                return {
                  success: false,
                  response: "Disculpá, hubo un problema procesando tu respuesta. ¿Podrías enviarla nuevamente?",
                  error: "Run stuck in cancelling state - requesting user retry",
                }
              }
            } else {
              // Para otros estados activos (queued, in_progress), intentar normal cancel
              const cancelled = await cancelRunAndWait(threadId, activeRuns.runId)
              if (!cancelled) {
                // NO crear nuevo thread - devolver mensaje de error manteniendo el contexto
                console.log(`[OPENAI] ⚠️ No se pudo cancelar el run activo, solicitando reintento al usuario...`)
                
                return {
                  success: false,
                  response: "Disculpá, hubo un problema procesando tu respuesta. ¿Podrías enviarla nuevamente?",
                  error: `Could not cancel active run ${activeRuns.runId} - requesting user retry`,
                }
              }
            }
          }
        }

        console.log(`[OPENAI] 🔄 Creando nuevo run para reintento...`)
        const newRun = await openai.beta.threads.runs.create(threadId, {
          assistant_id: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
        })
        console.log(`[OPENAI] 🔄 Nuevo run creado: ${newRun.id}`)

        console.log(`[v0] 🔄 Llamada recursiva normal con:`, {
          threadId,
          runId: newRun.id,
          accessToken: accessToken ? `${accessToken.substring(0, 10)}...` : "undefined",
          phoneNumberId,
          userPhoneNumber,
        })

        return processRunWithCorrectFlow(
          openai,
          threadId,
          newRun.id,
          accessToken,
          phoneNumberId,
          clienteId,
          userPhoneNumber, // Pass user phone number
          retryCount + 1,
        )
      } catch (retryError: any) {
        console.error(`[OPENAI] ❌ Error creando nuevo run para reintento:`, retryError)
        // Fall through to final error handling
      }
    }

    console.log(`[OPENAI] ❌ Todos los reintentos agotados (${retryCount + 1}/${MAX_RETRIES + 1})`)

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
          console.log(`[OPENAI] 💾 Mensaje de error guardado en conversación`)

          await sendWhatsAppMessage(phoneNumberId, accessToken, finalUserPhoneNumber, errorMessage)
          console.log(`[OPENAI] 📱 Mensaje de error enviado al usuario: ${finalUserPhoneNumber}`)
        } else {
          console.error(`[OPENAI] ❌ No se pudo obtener número de teléfono para enviar mensaje de error`)
        }
      }
    } catch (sendError) {
      console.error(`[OPENAI] ❌ Error enviando mensaje de error:`, sendError)
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
    console.log(`[OPENAI] 🆘 Procesando solicitud de soporte humano`)
    console.log(`[OPENAI] 📋 Argumentos:`, functionArgs)
    console.log(`[OPENAI] 📱 PhoneNumber: ${userPhoneNumber}`)
    console.log(`[OPENAI] 🧵 ThreadId: ${threadId}`)

    try {
      // Obtener configuración para obtener información completa
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (!config) {
        console.error(`[OPENAI] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
        return JSON.stringify({
          success: false,
          message: "Error interno: no se pudo procesar la solicitud",
        })
      }

      const finalPhoneNumber = userPhoneNumber || (await getUserPhoneNumberFromThread(threadId))
      if (!finalPhoneNumber) {
        console.error(`[OPENAI] ❌ No se pudo obtener número de teléfono`)
        return JSON.stringify({
          success: false,
          message: "Error interno: no se pudo identificar el usuario",
        })
      }

      // Crear sesión de soporte humano
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

      console.log(`[OPENAI] ✅ Sesión de soporte creada: ${session.id}`)

      // Enviar mensaje automático al usuario
      const autoMessage =
        "Tu solicitud ha sido recibida. Un agente de atención al cliente se pondrá en contacto contigo pronto. Por favor, mantente atento a este chat."

      await sendWhatsAppMessage(phoneNumberId, accessToken, finalPhoneNumber, autoMessage)

      console.log(`[OPENAI] 📤 Mensaje automático enviado al usuario`)

      return JSON.stringify({
        success: true,
        sessionId: session.id,
        message: "Solicitud de atención humana procesada correctamente",
      })
    } catch (error) {
      console.error(`[OPENAI] ❌ Error creando sesión de soporte:`, error)
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
        console.log(`[OPENAI] ⏳ Mensaje de espera enviado: ${functionName} - "${waitingMessage}"`)
      } else {
        console.error(`[OPENAI] ❌ No se pudo obtener número de teléfono para enviar mensaje de espera`)
      }
    } catch (error) {
      console.error(`[OPENAI] ❌ Error enviando mensaje de espera para ${functionName}:`, error)
    }
  } else {
    console.log(`[OPENAI] 🔕 Sin mensaje de espera para: ${functionName}`)
  }

  const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)
  console.log(`[OPENAI] ✅ ${functionName} completado`)
  return JSON.stringify(toolResult)
}

async function checkForActiveRuns(threadId: string): Promise<{
  hasActive: boolean
  runId?: string
  status?: string
}> {
  try {
    console.log(`[v0] 🔍 checkForActiveRuns - Llamando API con threadId="${threadId}"`)

    const response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
    })

    if (!response.ok) {
      console.error(`[OPENAI] ❌ Error obteniendo runs del thread`)
      return { hasActive: false }
    }

    const data = await response.json()
    const runs = data.data || []

    console.log(`[v0] 📊 checkForActiveRuns - Respuesta API:`, {
      runsCount: runs.length,
      firstRun: runs[0] ? { id: runs[0].id, status: runs[0].status } : null,
    })

    // Buscar runs en estados activos
    const activeStates = ["queued", "in_progress", "cancelling", "requires_action"]
    const activeRun = runs.find((run: any) => activeStates.includes(run.status))

    if (activeRun) {
      console.log(`[v0] ✅ checkForActiveRuns - Run activo encontrado:`, {
        runId: activeRun.id,
        status: activeRun.status,
      })

      return {
        hasActive: true,
        runId: activeRun.id,
        status: activeRun.status,
      }
    }

    console.log(`[v0] ℹ️ checkForActiveRuns - No hay runs activos`)
    return { hasActive: false }
  } catch (error) {
    console.error(`[OPENAI] ❌ Error verificando runs activos:`, error)
    console.error(`[v0] ❌ checkForActiveRuns error details:`, {
      error: error instanceof Error ? error.message : String(error),
      threadId,
    })
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
        console.error(`[OPENAI] ⏰ QUEUED_TIMEOUT: Run en cola por ${queuedElapsed}ms (máximo: ${QUEUED_TIMEOUT}ms)`)
        console.log(`[OPENAI] 🔄 El run está atascado en cola de OpenAI, cancelando para reintentar...`)

        const cancelled = await cancelRunAndWait(threadId, runId)
        if (!cancelled) {
          console.error(`[OPENAI] ⚠️ No se pudo confirmar la cancelación del run atascado en cola`)
        }

        // Lanzar error específico para que processRunWithCorrectFlow pueda reintentar
        throw new Error(`Run atascado en cola: ${queuedElapsed}ms en estado queued`)
      }
    } else {
      // Si ya no está en queued, resetear el contador
      queuedStartTime = null
    }

    if (!earlyWarningSent && elapsed > EARLY_WARNING_TIME) {
      earlyWarningSent = true
      console.log(`[OPENAI] ⚠️ Procesamiento lento detectado (${elapsed}ms)`)
    }

    if (elapsed > OPENAI_TIMEOUT) {
      console.error(`[OPENAI] ⏰ Timeout: ${OPENAI_TIMEOUT}ms (estado: ${run.status}, polls: ${pollCount})`)

      const cancelled = await cancelRunAndWait(threadId, runId)
      if (!cancelled) {
        console.error(`[OPENAI] ⚠️ No se pudo confirmar la cancelación del run`)
      }

      throw new Error(`Timeout esperando run: ${OPENAI_TIMEOUT}ms (estado: ${run.status})`)
    }

    if (run.status !== lastStatus) {
      console.log(`[OPENAI] 🔄 ${lastStatus} → ${run.status} (${elapsed}ms)`)
      lastStatus = run.status
    }

    if (elapsed > 10000 && pollCount % 3 === 0) {
      console.log(`[OPENAI] ⏳ ${run.status} (${elapsed}ms, poll #${pollCount})`)
    }

    await wait(pollInterval)

    if (pollInterval < maxPollInterval) {
      pollInterval = Math.min(pollInterval + 400, maxPollInterval)
    }

    run = await makeDirectAPICall(threadId, runId)
  }

  const totalTime = Date.now() - startTime
  console.log(`[OPENAI] ⏱️ Completado en ${totalTime}ms (${pollCount} polls, ${run.status})`)

  if (totalTime > 20000) {
    console.warn(`[OPENAI] 🐌 Respuesta હતી: ${totalTime}ms`)
  }

  return run
}
