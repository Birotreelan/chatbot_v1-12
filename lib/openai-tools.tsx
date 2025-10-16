import OpenAI from "openai"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { incrementMetric, logError } from "@/lib/monitoring"
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
} from "./api-tools/api-functions"
import type { AbortSignal } from "abort-controller"
import { saveConversationMessage } from "./conversations"
import { nanoid } from "nanoid"

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
      },
      required: [], // Made all parameters optional since OpenAI might not pass rango_fechas
    },
  },
  confirmar_turno: {
    description: "Confirma un turno médico",
    parameters: {
      type: "object",
      properties: {
        turno_id: { type: "string", description: "ID del turno" },
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
    description: "Obtiene info de una sede",
    parameters: {
      type: "object",
      properties: {
        sede_id: { type: "string", description: "ID de la sede" },
      },
      required: ["sede_id"],
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
}

// Mensajes predefinidos para cada función
const FUNCTION_MESSAGES: Record<string, string> = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  validar_obra_social: "Verificando la obra social, aguardá unos instantes.",
  obtener_datos_sede: "Consultando información de la sede, aguardá unos instantes.",
  obtener_obras_sociales: "Consultando obras sociales disponibles, aguardá unos instantes.",
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
        )

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
        mensaje: "Error al reservar el turno. Por favor, intenta nuevamente o contacta a la clínica.",
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

    console.log(`[TOOLS] ✅ Turno reservado exitosamente`)
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
      return JSON.stringify({
        exito: true,
        paciente: resultado.datos,
        mensaje: "Paciente encontrado por número de teléfono",
      })
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
      `[TOOLS] 🔍 Buscando turnos disponibles: rango=${rangoFechas}, profesional=${profesional}, especialidad=${especialidad}, profesional_id=${profesionalId}`,
    )

    const resultado = await buscarTurnosDisponibles(rangoFechas, profesional, especialidad, profesionalId, clienteId)

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

// Tiempo máximo de espera para la respuesta de OpenAI (en milisegundos)
const OPENAI_TIMEOUT = Number.parseInt(process.env.OPENAI_TIMEOUT || "45000", 10)
const EARLY_WARNING_TIME = 30000 // 30 seconds

// Número máximo de reintentos
const MAX_RETRIES = Number.parseInt(process.env.MAX_RETRIES || "3", 10)

// Tiempo de espera entre reintentos (en milisegundos)
const RETRY_DELAY = Number.parseInt(process.env.RETRY_DELAY || "2000", 10)

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
    const completedRun = await waitForRunCompletionOrAction(openai, threadId, runId)
    console.log(`[OPENAI] 🏁 Run completado: ${completedRun.status}`)

    if (completedRun.usage) {
      console.log(
        `[OPENAI] 💰 Tokens: ${completedRun.usage.total_tokens} (${completedRun.usage.prompt_tokens}+${completedRun.usage.completion_tokens})`,
      )
    }

    if (completedRun.status === "completed") {
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length === 0 || messages.data[0].role !== "assistant") {
        throw new Error("No se encontraron mensajes del asistente")
      }

      let messageContent = ""
      for (const content of messages.data[0].content) {
        if (content.type === "text") {
          messageContent += content.text.value
        }
      }

      console.log(
        `[OPENAI] 💬 Respuesta: "${messageContent.substring(0, 100)}${messageContent.length > 100 ? "..." : ""}"`,
      )

      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config) {
        await saveConversationMessage({
          id: nanoid(),
          role: "assistant",
          content: messageContent,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
        })
      }

      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, messageContent)
      console.log(`[OPENAI] 📱 Enviado a WhatsApp`)

      await incrementMetric("messages_sent")

      return { success: true }
    } else if (completedRun.status === "requires_action") {
      console.log(`[OPENAI] 🔧 Ejecutando herramientas`)

      if (completedRun.required_action?.type === "submit_tool_outputs") {
        const toolCalls = completedRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        console.log(`[OPENAI] 🔧 ${toolCalls.length} herramientas a ejecutar`)

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[OPENAI] 🔧 Ejecutando: ${functionName}`)

          const waitingMessage = FUNCTION_MESSAGES[functionName]
          if (waitingMessage) {
            try {
              await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, waitingMessage)
              console.log(`[OPENAI] ⏳ Mensaje de espera enviado: ${functionName}`)
            } catch (error) {
              console.error(`[OPENAI] ❌ Error enviando mensaje de espera:`, error)
            }
          } else {
            console.log(`[OPENAI] 🔕 Sin mensaje de espera para: ${functionName}`)
          }

          const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          })

          console.log(`[OPENAI] ✅ ${functionName} completado`)
        }

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

    const isTimeout = error.message && error.message.includes("Timeout esperando run")
    const isRateLimitError = error.message && error.message.includes("Please try again in")

    // Log error type for debugging
    if (isTimeout) {
      console.log(`[OPENAI] ⏰ Timeout detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
    } else if (isRateLimitError) {
      console.log(`[OPENAI] 🚦 Rate limit detectado (intento ${retryCount + 1}/${MAX_RETRIES + 1})`)
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
      } else if (isTimeout) {
        // Use exponential backoff for timeouts
        waitTime = calculateBackoffDelay(retryCount)
        console.log(`[OPENAI] ⏰ Usando backoff exponencial: ${waitTime}ms`)
      } else {
        // Use exponential backoff for other errors too
        waitTime = calculateBackoffDelay(retryCount)
        console.log(`[OPENAI] 🔄 Usando backoff exponencial: ${waitTime}ms`)
      }

      console.log(`[OPENAI] 🔄 Reintentando en ${waitTime}ms (intento ${retryCount + 1}/${MAX_RETRIES})...`)
      await wait(waitTime)

      try {
        console.log(`[OPENAI] 🔄 Creando nuevo run para reintento...`)
        const newRun = await openai.beta.threads.runs.create(threadId, {
          assistant_id: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
        })
        console.log(`[OPENAI] 🔄 Nuevo run creado: ${newRun.id}`)

        return processRunWithCorrectFlow(
          openai,
          threadId,
          newRun.id, // Use new run ID
          accessToken,
          phoneNumberId,
          userPhoneNumber,
          clienteId,
          retryCount + 1,
        )
      } catch (retryError) {
        console.error(`[OPENAI] ❌ Error creando nuevo run para reintento:`, retryError)
        // Fall through to final error handling
      }
    }

    console.log(`[OPENAI] ❌ Todos los reintentos agotados (${retryCount + 1}/${MAX_RETRIES + 1})`)

    try {
      let errorMessage =
        "Lo siento, no pude procesar tu consulta en este momento. Por favor, intenta nuevamente en unos momentos."

      if (isTimeout) {
        errorMessage =
          "Lo siento, tu consulta está tomando más tiempo del esperado. Por favor, intenta nuevamente en unos momentos."
      }

      // Save error message to conversation database
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
      if (config) {
        await saveConversationMessage({
          id: nanoid(),
          role: "assistant",
          content: errorMessage,
          timestamp: new Date().toISOString(),
          phoneNumber: userPhoneNumber,
          configId: config.id,
          messageType: "error",
        })
        console.log(`[OPENAI] 💾 Mensaje de error guardado en conversación`)
      }

      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, errorMessage)
      console.log(`[OPENAI] 📱 Mensaje de error enviado al usuario`)
    } catch (sendError) {
      console.error(`[OPENAI] ❌ Error enviando mensaje de error:`, sendError)
    }
    // </CHANGE>

    // Log error for monitoring
    if (isTimeout) {
      await logError("openai_timeout", error instanceof Error ? error : new Error(String(error)))
    } else {
      await logError("openai_run", error instanceof Error ? error : new Error(String(error)))
    }

    return { success: false, error: isTimeout ? "timeout" : "error" }
  }
}

// Función para esperar completación del run
async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  const startTime = Date.now()
  let pollInterval = 800 // Start with 800ms for faster initial response
  const maxPollInterval = 2500 // Max 2.5 seconds between polls
  let earlyWarningSent = false

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

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++
    const elapsed = Date.now() - startTime

    if (!earlyWarningSent && elapsed > EARLY_WARNING_TIME) {
      earlyWarningSent = true
      console.log(`[OPENAI] ⚠️ Procesamiento lento detectado (${elapsed}ms)`)
    }

    if (elapsed > OPENAI_TIMEOUT) {
      console.error(`[OPENAI] ⏰ Timeout: ${OPENAI_TIMEOUT}ms (estado: ${run.status}, polls: ${pollCount})`)

      try {
        console.log(`[OPENAI] 🛑 Cancelando run ${runId}`)
        await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}/cancel`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
        })
        console.log(`[OPENAI] ✅ Run cancelado`)
      } catch (cancelError) {
        console.error(`[OPENAI] ❌ Error cancelando run:`, cancelError)
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
    console.warn(`[OPENAI] 🐌 Respuesta lenta: ${totalTime}ms`)
  }

  return run
}
