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
]

// Mensajes predefinidos para cada función
const FUNCTION_MESSAGES = {
  validar_dni: "Aguardá unos instantes mientras validamos tu DNI.",
  buscar_turnos_disponibles: "Voy a buscar turnos disponibles, aguardá unos instantes.",
  reservar_turno: "Realizando reserva de turno. aguardá unos instantes.",
  obtener_subespecialidades: "Consultando las especialidades disponibles, aguardá unos instantes.",
  buscar_profesionales: "Buscando profesionales, aguardá unos instantes.",
  default: "Estoy procesando tu solicitud, dame un momento por favor.",
}

// Función para procesar mensajes individuales (para compatibilidad)
export async function processIndividualMessage(
  message: string,
  phoneNumberId: string,
  userPhoneNumber: string,
  assistantId?: string,
) {
  console.log(`[OPENAI-TOOLS] Procesando mensaje individual para ${userPhoneNumber}`)

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
    console.error("[OPENAI-TOOLS] Error en processIndividualMessage:", error)
    await logError("process_individual_message", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Función para truncar respuestas largas de herramientas
function truncateToolResponse(response: any, maxLength = 1000): any {
  const responseStr = JSON.stringify(response)
  const originalLength = responseStr.length
  const originalTokens = Math.ceil(originalLength / 4)

  console.log(`[OPENAI-TOOLS] ========== TRUNCANDO RESPUESTA ==========`)
  console.log(`[OPENAI-TOOLS] Tamaño original: ${originalLength} caracteres (${originalTokens} tokens estimados)`)
  console.log(`[OPENAI-TOOLS] Límite máximo: ${maxLength} caracteres`)

  if (responseStr.length <= maxLength) {
    console.log(`[OPENAI-TOOLS] ✅ Respuesta dentro del límite, no se requiere truncamiento`)
    console.log(`[OPENAI-TOOLS] ================================================`)
    return response
  }

  console.log(`[OPENAI-TOOLS] ⚠️ Respuesta excede el límite, aplicando truncamiento...`)

  // Si es un objeto con datos, truncar los datos
  if (response.exito && response.datos) {
    if (Array.isArray(response.datos)) {
      const originalCount = response.datos.length
      // Si es un array, limitar a los primeros elementos
      // Modificado: Ahora permite hasta 18 elementos en lugar de 5
      const truncatedData = response.datos.slice(0, 40) // Permitir hasta 40 elementos (5 días x 8 turnos)
      const truncatedResponse = {
        ...response,
        datos: truncatedData,
        _truncated: true,
        _originalLength: response.datos.length,
      }

      const newLength = JSON.stringify(truncatedResponse).length
      const newTokens = Math.ceil(newLength / 4)

      console.log(`[OPENAI-TOOLS] Array truncado de ${originalCount} a ${truncatedData.length} elementos`)
      console.log(`[OPENAI-TOOLS] Nuevo tamaño: ${newLength} caracteres (${newTokens} tokens estimados)`)
      console.log(
        `[OPENAI-TOOLS] Reducción: ${originalLength - newLength} caracteres (${originalTokens - newTokens} tokens)`,
      )
      console.log(`[OPENAI-TOOLS] ================================================`)

      return truncatedResponse
    } else if (typeof response.datos === "object") {
      // Si es un objeto, mantener solo campos esenciales
      const truncatedData = {
        ...response.datos,
        _truncated: true,
      }
      const truncatedResponse = {
        ...response,
        datos: truncatedData,
      }

      const newLength = JSON.stringify(truncatedResponse).length
      const newTokens = Math.ceil(newLength / 4)

      console.log(`[OPENAI-TOOLS] Objeto truncado manteniendo campos esenciales`)
      console.log(`[OPENAI-TOOLS] Nuevo tamaño: ${newLength} caracteres (${newTokens} tokens estimados)`)
      console.log(
        `[OPENAI-TOOLS] Reducción: ${originalLength - newLength} caracteres (${originalTokens - newTokens} tokens)`,
      )
      console.log(`[OPENAI-TOOLS] ================================================`)

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

  const newLength = JSON.stringify(fallbackResponse).length
  const newTokens = Math.ceil(newLength / 4)

  console.log(`[OPENAI-TOOLS] Aplicado truncamiento de string fallback`)
  console.log(`[OPENAI-TOOLS] Nuevo tamaño: ${newLength} caracteres (${newTokens} tokens estimados)`)
  console.log(
    `[OPENAI-TOOLS] Reducción: ${originalLength - newLength} caracteres (${originalTokens - newTokens} tokens)`,
  )
  console.log(`[OPENAI-TOOLS] ================================================`)

  return fallbackResponse
}

// Implementación directa de todas las funciones
// Simplificar logs - solo conversaciones y APIs
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
    console.log(`[API-CALL] 🔧 ${toolName} | Cliente: ${clienteId}`)
    console.log(`[API-CALL] 📋 Args:`, JSON.stringify(toolArgs, null, 2))

    let requestBody: Record<string, any> = {
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

      case "buscar_turnos_disponibles":
        requestBody.Action = "get_turnos"
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
          const profesionalRequestBody = {
            Cliente_Id: clienteId.trim(),
            Action: "get_profesionales",
            busqueda: toolArgs.profesional,
          }

          const profesionalResponse = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(profesionalRequestBody),
          })

          const profesionalResponseText = await profesionalResponse.text()

          try {
            const profesionalData = JSON.parse(profesionalResponseText)
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
            } else if (profesionalData.error) {
              return {
                exito: false,
                error: {
                  codigo: "PROFESIONAL_NO_ENCONTRADO",
                  mensaje: profesionalData.error,
                },
              }
            }
          } catch (e) {
            return {
              exito: false,
              error: {
                codigo: "FORMATO_INVALIDO",
                mensaje: `La API devolvió una respuesta con formato inválido al buscar profesional`,
              },
            }
          }
        }
        break

      case "reservar_turno":
        requestBody.Action = "set_turno"

        // Buscar profesional
        const profesionalRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_profesionales",
          busqueda: toolArgs.profesional,
        }

        const profesionalResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profesionalRequestBody),
        })

        const profesionalResponseText = await profesionalResponse.text()

        let profesionalId = null
        try {
          const profesionalData = JSON.parse(profesionalResponseText)
          if (profesionalData.profesionales && profesionalData.profesionales.length > 0) {
            const profesional =
              profesionalData.profesionales.find((p: any) =>
                p.Nombre_Completo?.toLowerCase().includes(toolArgs.profesional.toLowerCase()),
              ) || profesionalData.profesionales[0]

            profesionalId = profesional.Id
          } else {
            return {
              exito: false,
              error: {
                codigo: "PROFESIONAL_NO_ENCONTRADO",
                mensaje: `No se encontró el profesional: ${toolArgs.profesional}`,
              },
            }
          }
        } catch (e) {
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar el profesional para la reserva`,
            },
          }
        }

        // Buscar turnos disponibles
        const turnosRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_turnos",
          Fecha_Desde: toolArgs.fecha,
          Fecha_Hasta: toolArgs.fecha,
          Profesional_Id: profesionalId,
        }

        const turnosResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(turnosRequestBody),
        })

        const turnosResponseText = await turnosResponse.text()

        let agendaId = null
        try {
          const turnosData = JSON.parse(turnosResponseText)

          if (turnosData.turnos_disponibles && turnosData.turnos_disponibles.length > 0) {
            for (const diaData of turnosData.turnos_disponibles) {
              if (diaData.turnos && Array.isArray(diaData.turnos)) {
                for (const turno of diaData.turnos) {
                  const turnoHoraNormalizada = turno.Hora.substring(0, 5)
                  const argumentoHoraNormalizado = toolArgs.hora.length === 5 ? toolArgs.hora : toolArgs.hora + ":00"

                  if (turnoHoraNormalizada === argumentoHoraNormalizado.substring(0, 5)) {
                    agendaId = turno.Id || turno.Agenda_Id
                    break
                  }
                }
                if (agendaId) break
              }
            }
          } else if (turnosData.turnos && turnosData.turnos.length > 0) {
            for (const turno of turnosData.turnos) {
              const turnoHoraNormalizada = turno.Hora.substring(0, 5)
              const argumentoHoraNormalizado = toolArgs.hora.length === 5 ? toolArgs.hora : toolArgs.hora + ":00"

              if (turnoHoraNormalizada === argumentoHoraNormalizado.substring(0, 5)) {
                agendaId = turno.Id || turno.Agenda_Id
                break
              }
            }
          }

          if (!agendaId) {
            return {
              exito: false,
              error: {
                codigo: "TURNO_NO_ENCONTRADO",
                mensaje: "No se encontró un turno disponible para la fecha, hora y profesional indicados",
              },
            }
          }
        } catch (e) {
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar turnos para la reserva`,
            },
          }
        }

        // Buscar datos del paciente
        const pacienteRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_paciente",
          dni: toolArgs.dni,
        }

        const pacienteResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pacienteRequestBody),
        })

        const pacienteResponseText = await pacienteResponse.text()

        let pacienteData = null
        try {
          const parsedResponse = JSON.parse(pacienteResponseText)

          if (parsedResponse.paciente) {
            pacienteData = parsedResponse.paciente
          } else if (parsedResponse.permite_pacientes_nuevos !== false) {
            pacienteData = null
          } else {
            return {
              exito: false,
              error: {
                codigo: "PACIENTE_NO_ENCONTRADO",
                mensaje: "No se encontró información del paciente y no se permiten registros nuevos",
              },
            }
          }
        } catch (e) {
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar datos del paciente para la reserva`,
            },
          }
        }

        requestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "set_turno",
          Agenda_Id: agendaId,
          Paciente_Id: toolArgs.dni,
          Paciente_DNI: toolArgs.dni,
          Paciente_Nombre: toolArgs.nombre,
          Paciente_Apellido: toolArgs.apellido,
          Paciente_Telefono: toolArgs.telefono,
          Paciente_Email: toolArgs.email,
        }

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

    console.log(`[API-REQUEST] ${toolName}:`, JSON.stringify(requestBody, null, 2))

    // Hacer petición con reintentos
    let lastError = null
    let response = null
    const maxRetries = 3
    let retryDelay = 1000

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
        lastError = error
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
          retryDelay *= 2
        }
      }
    }

    if (!response) {
      throw lastError
    }

    const responseText = await response.text()
    console.log(`[API-RESPONSE] ${toolName}:`, responseText)

    try {
      const data = JSON.parse(responseText)

      // Procesar respuesta según la función
      switch (toolName) {
        case "validar_dni":
          if (data.paciente) {
            const turnosProximos = data.turnos_proximos || []
            const resultado = {
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
            }
            return truncateToolResponse(resultado)
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
            const resultado = {
              exito: true,
              datos: data.subespecialidades.slice(0, 5).map((e: any) => ({
                id: e.Id,
                nombre: e.Nombre,
              })),
            }
            return truncateToolResponse(resultado)
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
            const resultado = {
              exito: true,
              datos: data.profesionales.slice(0, 3).map((p: any) => ({
                id: p.Id,
                nombre: p.Nombre_Completo,
                especialidad: p.Especialidad,
              })),
            }
            return truncateToolResponse(resultado)
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

            const resultado = {
              exito: true,
              datos: todosLosTurnos.slice(0, 40),
            }
            return truncateToolResponse(resultado)
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
    } catch (e) {
      console.error(`[API-PARSE-ERROR] ${toolName}:`, e.message)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `La API devolvió una respuesta con formato inválido: ${responseText.substring(0, 100)}...`,
        },
      }
    }
  } catch (error) {
    console.error(`[API-ERROR] ${toolName}:`, error.message)
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
  console.log(`[OPENAI-WEB] 🌐 PROCESANDO MENSAJE WEB ÚNICAMENTE`)
  console.log(`[OPENAI-WEB] 🚫 GARANTÍA: NO se enviará a WhatsApp`)
  console.log(`[OPENAI-WEB] Thread ID: ${threadId}`)
  console.log(`[OPENAI-WEB] Assistant ID: ${assistantId}`)

  const openai = getOpenAIClient()

  try {
    // Añadir el mensaje al thread
    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[OPENAI-WEB] Mensaje añadido al thread: ${messageResponse.id}`)

    // Crear un run con el asistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    console.log(`[OPENAI-WEB] Run creado: ${run.id}`)

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

    console.log(`[OPENAI-WEB] ✅ Respuesta obtenida: ${messageContent.length} caracteres`)
    console.log(`[OPENAI-WEB] ✅ CONFIRMADO: No se envió nada a WhatsApp`)

    return messageContent
  } catch (error) {
    console.error("[OPENAI-WEB] Error:", error)
    throw error
  }
}

// Función para procesar run web sin enviar a WhatsApp
async function processWebRunOnly(openai: OpenAI, threadId: string, runId: string, clienteId: string): Promise<void> {
  console.log(`[OPENAI-WEB] Procesando run web: ${runId}`)

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

        console.log(`[OPENAI-WEB] 🔧 Ejecutando herramienta: ${functionName}`)

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

  console.log(`[OPENAI-WEB] ✅ Run web completado sin enviar a WhatsApp`)
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

// Agregar logging detallado al inicio de getAssistantResponse
// Simplificar getAssistantResponse
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
) {
  console.log(`[CONVERSATION] 📱 Usuario: ${phoneNumberId.slice(-4)}`)
  console.log(`[CONVERSATION] 💬 Mensaje: "${message.split("\n").pop()}"`)

  const openai = getOpenAIClient()

  try {
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }

    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    const runStartTime = Date.now()
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    })

    await processRunWithCorrectFlow(
      openai,
      threadId,
      run.id,
      config.accessToken,
      phoneNumberId,
      config.lastUserPhoneNumber || "",
      config.cliente_id || "",
    )

    const runEndTime = Date.now()
    const runDuration = runEndTime - runStartTime
    console.log(`[CONVERSATION] ⏱️ Procesado en ${runDuration}ms`)

    return { success: true }
  } catch (error) {
    console.error("[CONVERSATION-ERROR]", error.message)
    await logError("openai", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Agregar logging detallado en processRunWithCorrectFlow
// Simplificar processRunWithCorrectFlow
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

    if (completedRun.status === "completed") {
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      if (messages.data.length === 0) {
        throw new Error("No se encontraron mensajes en el thread")
      }

      const lastMessage = messages.data[0]
      if (lastMessage.role !== "assistant") {
        throw new Error(`El último mensaje no es del asistente: ${lastMessage.role}`)
      }

      let messageContent = ""
      for (const content of lastMessage.content) {
        if (content.type === "text") {
          messageContent += content.text.value
        }
      }

      console.log(`[CONVERSATION] 🤖 Respuesta: "${messageContent}"`)

      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, messageContent)
      await incrementMetric("messages_sent")

      return { success: true }
    } else if (completedRun.status === "requires_action") {
      if (completedRun.required_action?.type === "submit_tool_outputs") {
        const toolCalls = completedRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        console.log(`[CONVERSATION] 🔧 Procesando ${toolCalls.length} herramientas`)

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[CONVERSATION] 🔧 Ejecutando: ${functionName}`)

          const waitingMessage = FUNCTION_MESSAGES[functionName] || FUNCTION_MESSAGES.default

          try {
            await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, waitingMessage)
          } catch (error) {
            // Continuar aunque falle el mensaje de espera
          }

          const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)

          const toolOutput = {
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          }

          toolOutputs.push(toolOutput)
        }

        // Submit tool outputs usando API directa
        const submitUrl = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`

        const submitHeaders = {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        }

        const submitBody = {
          tool_outputs: toolOutputs,
        }

        try {
          const submitResponse = await fetch(submitUrl, {
            method: "POST",
            headers: submitHeaders,
            body: JSON.stringify(submitBody),
          })

          if (!submitResponse.ok) {
            const errorText = await submitResponse.text()
            throw new Error(`Submit tool outputs failed: ${submitResponse.status} ${errorText}`)
          }
        } catch (error) {
          throw error
        }

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
        throw new Error(`Tipo de acción requerida no soportado: ${completedRun.required_action?.type}`)
      }
    } else if (completedRun.status === "failed") {
      throw new Error(`Run falló: ${completedRun.last_error?.message}`)
    } else {
      throw new Error(`Estado inesperado del run: ${completedRun.status}`)
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      let waitTime = RETRY_DELAY
      if (error.message && error.message.includes("Please try again in")) {
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000
        }
      }
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

// Agregar logging detallado en waitForRunCompletionOrAction
// Simplificar waitForRunCompletionOrAction
async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  if (!threadId || threadId === "undefined") {
    throw new Error(`threadId inválido: "${threadId}"`)
  }

  if (!runId || runId === "undefined") {
    throw new Error(`runId inválido: "${runId}"`)
  }

  const startTime = Date.now()

  const makeDirectAPICall = async (tId: string, rId: string) => {
    const url = `https://api.openai.com/v1/threads/${tId}/runs/${rId}`

    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API call failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      return data
    } catch (error) {
      throw error
    }
  }

  const localThreadId = String(threadId)
  const localRunId = String(runId)

  let run = await makeDirectAPICall(localThreadId, localRunId)
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++

    const elapsed = Date.now() - startTime
    if (elapsed > OPENAI_TIMEOUT) {
      throw new Error(`Timeout esperando a que el run se complete: ${OPENAI_TIMEOUT}ms`)
    }

    await wait(1000)
    run = await makeDirectAPICall(localThreadId, localRunId)
  }

  const totalTime = Date.now() - startTime
  console.log(`[CONVERSATION] ⏱️ Run completado en ${totalTime}ms con estado: ${run.status}`)
  return run
}
