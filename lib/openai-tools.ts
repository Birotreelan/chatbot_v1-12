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
export async function executeOpenAITool(
  toolName: string,
  toolArgs: Record<string, any>,
  clienteId?: string,
): Promise<any> {
  // Hardcodear la URL del proxy
  const proxy = "https://treelan.net/managment/proxy_service/"

  // Verificar que tenemos un cliente_id
  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "No se ha configurado un ID de cliente",
      },
    }
  }

  // Asegurarse de que la URL del proxy termina con una barra diagonal
  const proxyUrl = proxy.endsWith("/") ? proxy : `${proxy}/`

  try {
    console.log(`[OPENAI-TOOLS] ========== EJECUTANDO HERRAMIENTA ==========`)
    console.log(`[OPENAI-TOOLS] Función: ${toolName}`)
    console.log(`[OPENAI-TOOLS] Argumentos recibidos:`, JSON.stringify(toolArgs, null, 2))
    console.log(`[OPENAI-TOOLS] Cliente ID: ${clienteId}`)
    console.log(`[OPENAI-TOOLS] Proxy URL: ${proxyUrl}`)

    console.log(`Ejecutando ${toolName} con args:`, toolArgs)
    console.log(`Proxy URL: ${proxyUrl}`)
    console.log(`Cliente ID: ${clienteId}`)

    // Preparar el cuerpo de la solicitud según la función
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

      case "validar_obra_social":
        requestBody.Action = "get_obras_sociales"
        requestBody.busqueda = toolArgs.busqueda || ""
        break

      case "buscar_turnos_disponibles":
        requestBody.Action = "get_turnos"
        // Extraer fechas desde y hasta del rango
        if (toolArgs.rango_fechas) {
          // Manejar tanto "a" como "to" como separadores
          let fechaDesde, fechaHasta
          if (toolArgs.rango_fechas.includes(" a ")) {
            ;[fechaDesde, fechaHasta] = toolArgs.rango_fechas.split(" a ")
          } else if (toolArgs.rango_fechas.includes(" to ")) {
            ;[fechaDesde, fechaHasta] = toolArgs.rango_fechas.split(" to ")
          } else {
            // Si no tiene separador, usar como fecha única
            fechaDesde = toolArgs.rango_fechas
            fechaHasta = toolArgs.rango_fechas
          }

          requestBody.Fecha_Desde = fechaDesde.trim()
          requestBody.Fecha_Hasta = fechaHasta ? fechaHasta.trim() : fechaDesde.trim()
        } else {
          // Valores por defecto
          const hoy = new Date()
          const fechaDesde = hoy.toISOString().split("T")[0]
          const unMesDespues = new Date(hoy.setMonth(hoy.getMonth() + 1)).toISOString().split("T")[0]
          requestBody.Fecha_Desde = fechaDesde
          requestBody.Fecha_Hasta = unMesDespues
        }

        // Si tenemos el ID del profesional, usarlo directamente
        if (toolArgs.profesional_id) {
          requestBody.Profesional_Id = toolArgs.profesional_id
        }
        // Si tenemos el nombre del profesional pero no el ID, primero buscar el profesional
        else if (toolArgs.profesional) {
          // Necesitamos hacer una búsqueda previa
          const profesionalRequestBody = {
            Cliente_Id: clienteId.trim(),
            Action: "get_profesionales",
            busqueda: toolArgs.profesional,
          }

          console.log(`Buscando profesional primero:`, JSON.stringify(profesionalRequestBody))

          const profesionalResponse = await fetch(proxyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(profesionalRequestBody),
          })

          const profesionalResponseText = await profesionalResponse.text()
          console.log(`Respuesta de búsqueda de profesional:`, profesionalResponseText)

          try {
            const profesionalData = JSON.parse(profesionalResponseText)
            if (profesionalData.profesionales && profesionalData.profesionales.length > 0) {
              // Si hay múltiples profesionales, devolver la lista para que el usuario elija
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

              // Si solo hay un profesional, usar su ID para buscar turnos
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
            console.error(`Error al parsear la respuesta de búsqueda de profesional:`, e)
            return {
              exito: false,
              error: {
                codigo: "FORMATO_INVALIDO",
                mensaje: `La API devolvió una respuesta con formato inválido al buscar profesional`,
              },
            }
          }
        }
        // Si tenemos la especialidad pero no el profesional, buscar por especialidad
        else if (toolArgs.especialidad) {
          // Necesitamos hacer una búsqueda previa para obtener el ID de la subespecialidad
          const subespecialidadRequestBody = {
            Cliente_Id: clienteId.trim(),
            Action: "get_subespecialidades",
          }

          console.log(`Buscando subespecialidad primero:`, JSON.stringify(subespecialidadRequestBody))

          const subespecialidadResponse = await fetch(proxyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(subespecialidadRequestBody),
          })

          const subespecialidadResponseText = await subespecialidadResponse.text()
          console.log(`Respuesta de búsqueda de subespecialidad:`, subespecialidadResponseText)

          try {
            const subespecialidadData = JSON.parse(subespecialidadResponseText)
            if (subespecialidadData.subespecialidades && subespecialidadData.subespecialidades.length > 0) {
              // Buscar la subespecialidad que coincida con el nombre
              const subespecialidadEncontrada = subespecialidadData.subespecialidades.find((e: any) =>
                e.Nombre.toLowerCase().includes(toolArgs.especialidad.toLowerCase()),
              )

              if (subespecialidadEncontrada) {
                requestBody.Subespecialidad_Id = subespecialidadEncontrada.Id
                console.log(
                  `Subespecialidad encontrada: ${subespecialidadEncontrada.Nombre} (ID: ${subespecialidadEncontrada.Id})`,
                )
              } else {
                return {
                  exito: false,
                  error: {
                    codigo: "SUBESPECIALIDAD_NO_ENCONTRADA",
                    mensaje: `No se encontró la subespecialidad: ${toolArgs.especialidad}`,
                  },
                }
              }
            } else if (subespecialidadData.error) {
              return {
                exito: false,
                error: {
                  codigo: "SUBESPECIALIDAD_NO_ENCONTRADA",
                  mensaje: subespecialidadData.error,
                },
              }
            }
          } catch (e) {
            console.error(`Error al parsear la respuesta de búsqueda de subespecialidad:`, e)
            return {
              exito: false,
              error: {
                codigo: "FORMATO_INVALIDO",
                mensaje: `La API devolvió una respuesta con formato inválido al buscar subespecialidad`,
              },
            }
          }
        }
        break

      case "reservar_turno":
        requestBody.Action = "set_turno"
        // Primero necesitamos obtener el ID de la agenda para el turno
        // Esto requiere buscar el profesional y luego los turnos disponibles

        // 1. Buscar el profesional por nombre
        const profesionalRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_profesionales",
          busqueda: toolArgs.profesional,
        }

        console.log(`Buscando profesional para reserva:`, JSON.stringify(profesionalRequestBody))

        const profesionalResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(profesionalRequestBody),
        })

        const profesionalResponseText = await profesionalResponse.text()
        console.log(`Respuesta de búsqueda de profesional para reserva:`, profesionalResponseText)

        let profesionalId = null
        try {
          const profesionalData = JSON.parse(profesionalResponseText)
          if (profesionalData.profesionales && profesionalData.profesionales.length > 0) {
            // Tomar el primer profesional que coincida con el nombre
            // Cambiar esta línea:
            // const profesional = profesionalData.profesionales.find((p: any) =>
            //   p.Nombre.toLowerCase().includes(toolArgs.profesional.toLowerCase()),
            // ) || profesionalData.profesionales[0]

            // Por esta línea:
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
          console.error(`Error al parsear la respuesta de búsqueda de profesional para reserva:`, e)
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar el profesional para la reserva`,
            },
          }
        }

        // 2. Buscar turnos disponibles para ese profesional en esa fecha
        const turnosRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_turnos",
          Fecha_Desde: toolArgs.fecha,
          Fecha_Hasta: toolArgs.fecha,
          Profesional_Id: profesionalId,
        }

        console.log(`Buscando turnos para reserva:`, JSON.stringify(turnosRequestBody))

        const turnosResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(turnosRequestBody),
        })

        const turnosResponseText = await turnosResponse.text()
        console.log(`Respuesta de búsqueda de turnos para reserva:`, turnosResponseText)

        let agendaId = null
        try {
          const turnosData = JSON.parse(turnosResponseText)

          // Verificar si la respuesta tiene turnos_disponibles
          if (turnosData.turnos_disponibles && turnosData.turnos_disponibles.length > 0) {
            // Aplanar la estructura de turnos_disponibles
            for (const diaData of turnosData.turnos_disponibles) {
              if (diaData.turnos && Array.isArray(diaData.turnos)) {
                for (const turno of diaData.turnos) {
                  // Normalizar las horas para comparación (remover segundos si existen)
                  const turnoHoraNormalizada = turno.Hora.substring(0, 5) // "15:30:00" -> "15:30"
                  const argumentoHoraNormalizado = toolArgs.hora.length === 5 ? toolArgs.hora : toolArgs.hora + ":00"

                  if (turnoHoraNormalizada === argumentoHoraNormalizado.substring(0, 5)) {
                    agendaId = turno.Id || turno.Agenda_Id
                    break
                  }
                }
                if (agendaId) break
              }
            }
          }
          // Fallback para el formato anterior (si existe turnosData.turnos directamente)
          else if (turnosData.turnos && turnosData.turnos.length > 0) {
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
          console.error(`Error al parsear la respuesta de búsqueda de turnos para reserva:`, e)
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar turnos para la reserva`,
            },
          }
        }

        // 3. Buscar datos del paciente
        const pacienteRequestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "get_paciente",
          dni: toolArgs.dni,
        }

        console.log(`Buscando paciente para reserva:`, JSON.stringify(pacienteRequestBody))

        const pacienteResponse = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pacienteRequestBody),
        })

        const pacienteResponseText = await pacienteResponse.text()
        console.log(`Respuesta de búsqueda de paciente para reserva:`, pacienteResponseText)

        let pacienteData = null
        try {
          const parsedResponse = JSON.parse(pacienteResponseText)

          // Si encontramos al paciente, usar sus datos
          if (parsedResponse.paciente) {
            pacienteData = parsedResponse.paciente
            console.log(`Paciente encontrado en el sistema:`, pacienteData)
          }
          // Si no encontramos al paciente pero permite pacientes nuevos, continuar con los datos del contexto
          else if (parsedResponse.permite_pacientes_nuevos !== false) {
            console.log(
              `Paciente no encontrado, pero se permiten pacientes nuevos. Continuando con datos del contexto.`,
            )
            // Los datos se tomarán del contexto de la conversación - continuar con la reserva
            pacienteData = null
          }
          // Si no se permiten pacientes nuevos, devolver error
          else {
            return {
              exito: false,
              error: {
                codigo: "PACIENTE_NO_ENCONTRADO",
                mensaje: "No se encontró información del paciente y no se permiten registros nuevos",
              },
            }
          }
        } catch (e) {
          console.error(`Error al parsear la respuesta de búsqueda de paciente para reserva:`, e)
          return {
            exito: false,
            error: {
              codigo: "FORMATO_INVALIDO",
              mensaje: `Error al buscar datos del paciente para la reserva`,
            },
          }
        }

        // 4. Preparar la solicitud de reserva con los datos del usuario
        requestBody = {
          Cliente_Id: clienteId.trim(),
          Action: "set_turno",
          Agenda_Id: agendaId,
          Paciente_Id: toolArgs.dni, // Usar DNI como ID único
          Paciente_DNI: toolArgs.dni,
          Paciente_Nombre: toolArgs.nombre,
          Paciente_Apellido: toolArgs.apellido,
          Paciente_Telefono: toolArgs.telefono,
          Paciente_Email: toolArgs.email,
        }

        console.log(`Preparando reserva con datos del usuario:`, JSON.stringify(requestBody, null, 2))

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

    console.log(`[OPENAI-TOOLS] Cuerpo de la solicitud preparado:`, JSON.stringify(requestBody, null, 2))
    console.log(`Cuerpo de la solicitud para ${toolName}:`, JSON.stringify(requestBody))

    // Hacer la petición directamente con reintentos
    let lastError = null
    let response = null
    const maxRetries = 3
    let retryDelay = 1000 // 1 segundo

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[OPENAI-TOOLS] Intento ${attempt}/${maxRetries} para ${toolName}`)

        response = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          // Agregar timeout para evitar conexiones colgadas
          signal: AbortSignal.timeout(30000), // 30 segundos timeout
        })

        // Si llegamos aquí, la petición fue exitosa
        break
      } catch (error) {
        lastError = error
        console.error(`[OPENAI-TOOLS] Error en intento ${attempt}/${maxRetries} para ${toolName}:`, error)

        // Si es el último intento, no esperar
        if (attempt < maxRetries) {
          console.log(`[OPENAI-TOOLS] Esperando ${retryDelay}ms antes del siguiente intento...`)
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
          // Incrementar el delay para el siguiente intento (backoff exponencial)
          retryDelay *= 2
        }
      }
    }

    // Si después de todos los intentos no tenemos respuesta, lanzar el último error
    if (!response) {
      console.error(`[OPENAI-TOOLS] Todos los intentos fallaron para ${toolName}. Último error:`, lastError)
      throw lastError
    }

    // Obtener el texto de la respuesta
    const responseText = await response.text()
    console.log(`[OPENAI-TOOLS] ========== RESPUESTA CRUDA ==========`)
    console.log(`[OPENAI-TOOLS] Status: ${response.status} ${response.statusText}`)
    console.log(`[OPENAI-TOOLS] Headers:`, Object.fromEntries(response.headers.entries()))
    console.log(`[OPENAI-TOOLS] Texto de respuesta:`, responseText)
    console.log(`Respuesta (texto) para ${toolName}:`, responseText)

    // Intentar parsear la respuesta como JSON
    try {
      const data = JSON.parse(responseText)
      console.log(`[OPENAI-TOOLS] ========== RESPUESTA PARSEADA ==========`)
      console.log(`[OPENAI-TOOLS] JSON parseado:`, JSON.stringify(data, null, 2))
      console.log(`Respuesta (JSON) parseada para ${toolName}:`, data)

      // Procesar la respuesta según la función
      switch (toolName) {
        case "validar_dni":
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO VALIDAR_DNI ==========`)

          // Si la respuesta contiene un paciente, es exitosa
          if (data.paciente) {
            console.log(`[OPENAI-TOOLS] Paciente encontrado:`, JSON.stringify(data.paciente, null, 2))

            // Verificar si hay turnos próximos
            const turnosProximos = data.turnos_proximos || []
            console.log(`[OPENAI-TOOLS] Turnos próximos encontrados:`, JSON.stringify(turnosProximos, null, 2))
            console.log(`[OPENAI-TOOLS] Cantidad de turnos próximos: ${turnosProximos.length}`)

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
                  // Limitar a 1 turno
                  id: turno.Id,
                  fecha: turno.Fecha,
                  hora: turno.Hora,
                  profesional_nombre: turno.Profesional_Nombre,
                  centro_nombre: turno.Centro_Nombre,
                  motivo_nombre: turno.Motivo_Nombre,
                })),
                es_nuevo: false,
                permite_pacientes_nuevos: data.permite_pacientes_nuevos !== false, // Incluir siempre este parámetro
              },
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado antes de truncar: ${resultadoSize} caracteres`)
            console.log(`[OPENAI-TOOLS] ========== RESULTADO FINAL VALIDAR_DNI ==========`)
            console.log(`[OPENAI-TOOLS] Resultado que se enviará a OpenAI:`, JSON.stringify(resultado, null, 2))

            return truncateToolResponse(resultado)
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en validar_dni:`, data.error)

            // Si el error indica que el paciente no fue encontrado, verificar si permite pacientes nuevos
            if (
              data.error.toLowerCase().includes("paciente no encontrado") ||
              data.error.toLowerCase().includes("no encontrado")
            ) {
              console.log(`[OPENAI-TOOLS] Paciente no encontrado, verificando si permite pacientes nuevos`)
              console.log(`[OPENAI-TOOLS] permite_pacientes_nuevos: ${data.permite_pacientes_nuevos}`)

              return {
                exito: true,
                datos: {
                  paciente: null,
                  turnos_proximos: [],
                  es_nuevo: true,
                  permite_pacientes_nuevos: data.permite_pacientes_nuevos === true, // Usar el valor exacto de la API
                  mensaje_error: data.error,
                },
              }
            }

            // Para otros tipos de error, devolver error
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
                permite_pacientes_nuevos: data.permite_pacientes_nuevos, // Incluir también en errores
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] Paciente no encontrado, considerando como nuevo`)
            // Si no hay paciente ni error, asumimos que el paciente no existe
            return {
              exito: true,
              datos: {
                paciente: null,
                turnos_proximos: [],
                es_nuevo: true,
                permite_pacientes_nuevos: data.permite_pacientes_nuevos !== false, // Por defecto true si no se especifica
              },
            }
          }

        case "obtener_subespecialidades":
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO OBTENER_SUBESPECIALIDADES ==========`)

          if (data.subespecialidades) {
            console.log(
              `[OPENAI-TOOLS] Subespecialidades encontradas:`,
              JSON.stringify(data.subespecialidades, null, 2),
            )
            console.log(`[OPENAI-TOOLS] Cantidad de subespecialidades: ${data.subespecialidades.length}`)

            const resultado = {
              exito: true,
              datos: data.subespecialidades.slice(0, 5).map((e: any) => ({
                // Limitar a 5 subespecialidades
                id: e.Id,
                nombre: e.Nombre,
              })),
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado antes de truncar: ${resultadoSize} caracteres`)
            console.log(`[OPENAI-TOOLS] ========== RESULTADO FINAL OBTENER_SUBESPECIALIDADES ==========`)
            console.log(`[OPENAI-TOOLS] Resultado que se enviará a OpenAI:`, JSON.stringify(resultado, null, 2))

            return truncateToolResponse(resultado)
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en obtener_subespecialidades:`, data.error)
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] No se encontraron subespecialidades`)
            return {
              exito: true,
              datos: [],
            }
          }

        case "buscar_profesionales":
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO BUSCAR_PROFESIONALES ==========`)

          if (data.profesionales) {
            console.log(`[OPENAI-TOOLS] Profesionales encontrados:`, JSON.stringify(data.profesionales, null, 2))
            console.log(`[OPENAI-TOOLS] Cantidad de profesionales: ${data.profesionales.length}`)

            const resultado = {
              exito: true,
              datos: data.profesionales.slice(0, 3).map((p: any) => ({
                // Limitar a 5 profesionales
                id: p.Id,
                nombre: p.Nombre_Completo,
                especialidad: p.Especialidad,
              })),
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado antes de truncar: ${resultadoSize} caracteres`)

            return truncateToolResponse(resultado)
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en buscar_profesionales:`, data.error)
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] No se encontraron profesionales`)
            return {
              exito: true,
              datos: [],
            }
          }

        case "validar_obra_social":
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO VALIDAR_OBRA_SOCIAL ==========`)

          if (data.obras_sociales) {
            console.log(`[OPENAI-TOOLS] Obras sociales encontradas:`, JSON.stringify(data.obras_sociales, null, 2))
            console.log(`[OPENAI-TOOLS] Cantidad de obras sociales: ${data.obras_sociales.length}`)

            const resultado = {
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
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado antes de truncar: ${resultadoSize} caracteres`)

            return truncateToolResponse(resultado)
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en validar_obra_social:`, data.error)
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] No se encontraron obras sociales`)
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
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO BUSCAR_TURNOS_DISPONIBLES ==========`)

          if (data.turnos_disponibles) {
            console.log(
              `[OPENAI-TOOLS] Turnos disponibles encontrados:`,
              JSON.stringify(data.turnos_disponibles, null, 2),
            )

            // Aplanar la estructura de turnos_disponibles
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
              // Limitar a 40 turnos para evitar respuestas muy largas (5 días x 8 turnos)
              if (todosLosTurnos.length >= 40) break
            }

            console.log(`[OPENAI-TOOLS] Total de turnos procesados: ${todosLosTurnos.length}`)

            const resultado = {
              exito: true,
              datos: todosLosTurnos.slice(0, 40), // Máximo 40 turnos (5 días x 8 turnos)
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado antes de truncar: ${resultadoSize} caracteres`)
            console.log(`[OPENAI-TOOLS] ========== RESULTADO FINAL BUSCAR_TURNOS_DISPONIBLES ==========`)
            console.log(`[OPENAI-TOOLS] Resultado que se enviará a OpenAI:`, JSON.stringify(resultado, null, 2))

            return truncateToolResponse(resultado)
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en buscar_turnos_disponibles:`, data.error)
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error desconocido",
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] No se encontraron turnos disponibles`)
            return {
              exito: true,
              datos: [],
            }
          }

        case "reservar_turno":
          console.log(`[OPENAI-TOOLS] ========== PROCESANDO RESERVAR_TURNO ==========`)

          if (data.success || data.exito) {
            const resultado = {
              exito: true,
              datos: {
                mensaje: "Turno reservado exitosamente",
                confirmacion: data.confirmacion || "Reserva confirmada",
              },
            }

            const resultadoSize = JSON.stringify(resultado).length
            console.log(`[OPENAI-TOOLS] Tamaño del resultado: ${resultadoSize} caracteres`)

            return resultado
          } else if (data.error) {
            console.log(`[OPENAI-TOOLS] Error en reservar_turno:`, data.error)
            return {
              exito: false,
              error: {
                codigo: "API_ERROR",
                mensaje: typeof data.error === "string" ? data.error : "Error al reservar el turno",
              },
            }
          } else {
            console.log(`[OPENAI-TOOLS] Respuesta inesperada en reservar_turno:`, data)
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
      console.error(`[OPENAI-TOOLS] ========== ERROR AL PARSEAR JSON ==========`)
      console.error(`[OPENAI-TOOLS] Error:`, e)
      console.error(`[OPENAI-TOOLS] Texto que no se pudo parsear:`, responseText.substring(0, 500))
      console.error(`Error al parsear la respuesta JSON para ${toolName}:`, e)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `La API devolvió una respuesta con formato inválido: ${responseText.substring(0, 100)}...`,
        },
      }
    }
  } catch (error) {
    console.error(`[OPENAI-TOOLS] ========== ERROR GENERAL ==========`)
    console.error(`[OPENAI-TOOLS] Error al ejecutar la herramienta ${toolName}:`, error)
    console.error(`Error al ejecutar la herramienta ${toolName}:`, error)
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
export async function getAssistantResponse(
  threadId: string,
  message: string,
  phoneNumberId: string,
  assistantId: string = process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
) {
  console.log(`[OPENAI-TOOLS] ========== INICIANDO GETASSISTANTRESPONSE ==========`)
  console.log(`[OPENAI-TOOLS] Thread ID: ${threadId}`)
  console.log(`[OPENAI-TOOLS] Phone Number ID: ${phoneNumberId}`)
  console.log(`[OPENAI-TOOLS] Assistant ID: ${assistantId}`)
  console.log(`[OPENAI-TOOLS] Mensaje original recibido (${message.length} caracteres):`)
  console.log(`[OPENAI-TOOLS] "${message}"`)
  console.log(`[OPENAI-TOOLS] ================================================`)

  const openai = getOpenAIClient()

  try {
    // Obtener la configuración de WhatsApp
    console.log(`[OPENAI-TOOLS] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
    if (!config) {
      console.error(`[OPENAI-TOOLS] No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      throw new Error(`No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
    }
    console.log(`[OPENAI-TOOLS] Configuración encontrada: ${config.displayName}`)
    console.log(`[OPENAI-TOOLS] Cliente ID: ${config.cliente_id}`)

    // NUEVO: Obtener información del thread ANTES de enviar el mensaje
    console.log(`[OPENAI-TOOLS] ========== INFORMACIÓN DEL THREAD ANTES ==========`)
    try {
      const threadInfo = await openai.beta.threads.retrieve(threadId)
      console.log(`[OPENAI-TOOLS] Thread ID: ${threadInfo.id}`)
      console.log(`[OPENAI-TOOLS] Thread creado en: ${threadInfo.created_at}`)
      console.log(`[OPENAI-TOOLS] Thread metadata:`, JSON.stringify(threadInfo.metadata, null, 2))

      // Obtener mensajes existentes en el thread
      const existingMessages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 50, // Obtener los últimos 50 mensajes para ver el contexto
      })

      console.log(`[OPENAI-TOOLS] Mensajes existentes en el thread: ${existingMessages.data.length}`)
      console.log(`[OPENAI-TOOLS] ========== HISTORIAL DE MENSAJES ==========`)

      let totalTokensEstimated = 0
      existingMessages.data.forEach((msg, index) => {
        const content = msg.content.map((c) => (c.type === "text" ? c.text.value : `[${c.type}]`)).join(" ")
        const estimatedTokens = Math.ceil(content.length / 4) // Estimación aproximada
        totalTokensEstimated += estimatedTokens

        console.log(
          `[OPENAI-TOOLS] Mensaje ${index + 1} (${msg.role}): ${content.substring(0, 100)}... (${estimatedTokens} tokens estimados)`,
        )
      })

      console.log(`[OPENAI-TOOLS] Total de tokens estimados en el historial: ${totalTokensEstimated}`)
      console.log(`[OPENAI-TOOLS] ================================================`)
    } catch (threadError) {
      console.error(`[OPENAI-TOOLS] Error al obtener información del thread:`, threadError)
    }

    // Añadir el mensaje al thread
    console.log(`[OPENAI-TOOLS] ========== ENVIANDO MENSAJE A OPENAI ==========`)
    console.log(`[OPENAI-TOOLS] Mensaje que se enviará a OpenAI (${message.length} caracteres):`)
    console.log(`[OPENAI-TOOLS] "${message}"`)
    console.log(`[OPENAI-TOOLS] Tokens estimados del mensaje: ${Math.ceil(message.length / 4)}`)
    console.log(`[OPENAI-TOOLS] ================================================`)

    const messageResponse = await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    })

    console.log(`[OPENAI-TOOLS] Mensaje añadido al thread con ID: ${messageResponse.id}`)

    // Crear un run con el asistente
    console.log(`[OPENAI-TOOLS] ========== CREANDO RUN ==========`)
    console.log(`[OPENAI-TOOLS] Creando run con asistente ${assistantId}`)

    const runStartTime = Date.now()
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
      // Las herramientas y las instrucciones se toman del asistente configurado en OpenAI
    })

    console.log(`[OPENAI-TOOLS] Run creado con ID: ${run.id}`)
    console.log(`[OPENAI-TOOLS] Run status inicial: ${run.status}`)
    console.log(`[OPENAI-TOOLS] ================================================`)

    // Procesar el run
    console.log(`[OPENAI-TOOLS] ========== PROCESANDO RUN ==========`)
    console.log(`[OPENAI-TOOLS] Procesando run ${run.id}`)
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
    console.log(`[OPENAI-TOOLS] Run procesado exitosamente en ${runDuration}ms`)
    console.log(`[OPENAI-TOOLS] ================================================`)

    return { success: true }
  } catch (error) {
    console.error("[OPENAI-TOOLS] Error en getAssistantResponse:", error)
    await logError("openai", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Agregar logging detallado en processRunWithCorrectFlow
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
  console.log(`[OPENAI-TOOLS] ========== PROCESANDO RUN ${runId} ==========`)
  console.log(`[OPENAI-TOOLS] Parámetros de entrada:`)
  console.log(`[OPENAI-TOOLS] - threadId: "${threadId}" (tipo: ${typeof threadId})`)
  console.log(`[OPENAI-TOOLS] - runId: "${runId}" (tipo: ${typeof runId})`)
  console.log(`[OPENAI-TOOLS] - phoneNumberId: "${phoneNumberId}"`)
  console.log(`[OPENAI-TOOLS] - userPhoneNumber: "${userPhoneNumber}"`)
  console.log(`[OPENAI-TOOLS] - clienteId: "${clienteId}"`)
  console.log(`[OPENAI-TOOLS] - retryCount: ${retryCount}`)

  // Validar parámetros críticos
  if (!threadId || threadId === "undefined") {
    console.error(`[OPENAI-TOOLS] ❌ threadId inválido en processRunWithCorrectFlow: "${threadId}"`)
    throw new Error(`threadId inválido en processRunWithCorrectFlow: "${threadId}"`)
  }

  if (!runId || runId === "undefined") {
    console.error(`[OPENAI-TOOLS] ❌ runId inválido en processRunWithCorrectFlow: "${runId}"`)
    throw new Error(`runId inválido en processRunWithCorrectFlow: "${runId}"`)
  }

  console.log(
    `[OPENAI-TOOLS] Iniciando processRunWithCorrectFlow para run ${runId}, intento ${retryCount + 1}/${MAX_RETRIES + 1}`,
  )

  try {
    // Esperar a que el run se complete o requiera acción
    console.log(`[OPENAI-TOOLS] Esperando completación del run...`)
    const completedRun = await waitForRunCompletionOrAction(openai, threadId, runId)
    console.log(`[OPENAI-TOOLS] Run completado con estado: ${completedRun.status}`)

    // NUEVO: Log detallado del run completado
    console.log(`[OPENAI-TOOLS] ========== DETALLES DEL RUN COMPLETADO ==========`)
    console.log(`[OPENAI-TOOLS] Run ID: ${completedRun.id}`)
    console.log(`[OPENAI-TOOLS] Status: ${completedRun.status}`)
    console.log(`[OPENAI-TOOLS] Created at: ${completedRun.created_at}`)
    console.log(`[OPENAI-TOOLS] Started at: ${completedRun.started_at}`)
    console.log(`[OPENAI-TOOLS] Completed at: ${completedRun.completed_at}`)

    if (completedRun.usage) {
      console.log(`[OPENAI-TOOLS] ========== USO DE TOKENS ==========`)
      console.log(`[OPENAI-TOOLS] Prompt tokens: ${completedRun.usage.prompt_tokens}`)
      console.log(`[OPENAI-TOOLS] Completion tokens: ${completedRun.usage.completion_tokens}`)
      console.log(`[OPENAI-TOOLS] Total tokens: ${completedRun.usage.total_tokens}`)
      console.log(`[OPENAI-TOOLS] ================================================`)
    } else {
      console.log(`[OPENAI-TOOLS] ⚠️ No hay información de uso de tokens disponible`)
    }

    if (completedRun.last_error) {
      console.log(`[OPENAI-TOOLS] ❌ Error en el run: ${JSON.stringify(completedRun.last_error, null, 2)}`)
    }

    console.log(`[OPENAI-TOOLS] ================================================`)

    if (completedRun.status === "completed") {
      // Obtener los mensajes del asistente
      console.log(`[OPENAI-TOOLS] ========== OBTENIENDO RESPUESTA ==========`)
      console.log(`[OPENAI-TOOLS] Obteniendo mensajes del thread ${threadId}`)
      const messages = await openai.beta.threads.messages.list(threadId, {
        order: "desc",
        limit: 1,
      })

      // Verificar si hay mensajes
      if (messages.data.length === 0) {
        console.warn("[OPENAI-TOOLS] No se encontraron mensajes en el thread")
        throw new Error("No se encontraron mensajes en el thread")
      }

      // Obtener el último mensaje del asistente
      const lastMessage = messages.data[0]
      if (lastMessage.role !== "assistant") {
        console.warn(`[OPENAI-TOOLS] El último mensaje no es del asistente: ${lastMessage.role}`)
        throw new Error(`El último mensaje no es del asistente: ${lastMessage.role}`)
      }

      // Extraer el contenido del mensaje
      let messageContent = ""
      for (const content of lastMessage.content) {
        if (content.type === "text") {
          messageContent += content.text.value
        }
      }

      console.log(`[OPENAI-TOOLS] ========== RESPUESTA DEL ASISTENTE ==========`)
      console.log(`[OPENAI-TOOLS] Mensaje del asistente (${messageContent.length} caracteres):`)
      console.log(`[OPENAI-TOOLS] "${messageContent}"`)
      console.log(`[OPENAI-TOOLS] Tokens estimados de la respuesta: ${Math.ceil(messageContent.length / 4)}`)
      console.log(`[OPENAI-TOOLS] ================================================`)

      // Enviar el mensaje a WhatsApp
      console.log(`[OPENAI-TOOLS] Enviando mensaje a WhatsApp para usuario ${userPhoneNumber}`)
      await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, messageContent)
      console.log(`[OPENAI-TOOLS] Mensaje enviado exitosamente a WhatsApp`)

      // Incrementar métrica de mensajes enviados
      await incrementMetric("messages_sent")

      return { success: true }
    } else if (completedRun.status === "requires_action") {
      console.log(`[OPENAI-TOOLS] ========== PROCESANDO HERRAMIENTAS ==========`)
      console.log(`[OPENAI-TOOLS] El run requiere acción - procesando herramientas`)

      if (completedRun.required_action?.type === "submit_tool_outputs") {
        const toolCalls = completedRun.required_action.submit_tool_outputs.tool_calls
        const toolOutputs = []

        console.log(`[OPENAI-TOOLS] Procesando ${toolCalls.length} llamadas a herramientas`)

        // Procesar cada llamada a herramienta
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name
          const functionArgs = JSON.parse(toolCall.function.arguments)

          console.log(`[OPENAI-TOOLS] ========== PROCESANDO HERRAMIENTA ==========`)
          console.log(`[OPENAI-TOOLS] Función: ${functionName}`)
          console.log(`[OPENAI-TOOLS] Argumentos:`, JSON.stringify(functionArgs, null, 2))
          console.log(`[OPENAI-TOOLS] Tool Call ID: ${toolCall.id}`)
          console.log(
            `[OPENAI-TOOLS] Argumentos raw (${toolCall.function.arguments.length} caracteres): ${toolCall.function.arguments}`,
          )

          // Enviar mensaje de espera al usuario
          const waitingMessage = FUNCTION_MESSAGES[functionName] || FUNCTION_MESSAGES.default
          console.log(`[OPENAI-TOOLS] Enviando mensaje de espera: "${waitingMessage}"`)

          try {
            await sendWhatsAppMessage(phoneNumberId, accessToken, userPhoneNumber, waitingMessage)
            console.log(`[OPENAI-TOOLS] Mensaje de espera enviado exitosamente`)
          } catch (error) {
            console.error(`[OPENAI-TOOLS] Error al enviar mensaje de espera:`, error)
            // Continuar con la ejecución aunque falle el mensaje de espera
          }

          // Ejecutar la función
          console.log(`[OPENAI-TOOLS] Ejecutando función ${functionName}...`)
          const toolStartTime = Date.now()
          const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)
          const toolEndTime = Date.now()
          const toolDuration = toolEndTime - toolStartTime

          console.log(`[OPENAI-TOOLS] ========== RESULTADO DE HERRAMIENTA ==========`)
          console.log(`[OPENAI-TOOLS] Función: ${functionName}`)
          console.log(`[OPENAI-TOOLS] Duración: ${toolDuration}ms`)
          console.log(`[OPENAI-TOOLS] Resultado:`, JSON.stringify(toolResult, null, 2))

          const resultString = JSON.stringify(toolResult)
          console.log(`[OPENAI-TOOLS] Tamaño del resultado: ${resultString.length} caracteres`)
          console.log(`[OPENAI-TOOLS] Tokens estimados del resultado: ${Math.ceil(resultString.length / 4)}`)
          console.log(`[OPENAI-TOOLS] ================================================`)

          // Preparar el resultado para enviarlo de vuelta al asistente
          const toolOutput = {
            tool_call_id: toolCall.id,
            output: JSON.stringify(toolResult),
          }

          console.log(`[OPENAI-TOOLS] ========== ENVIANDO RESULTADO A OPENAI ==========`)
          console.log(`[OPENAI-TOOLS] Tool Call ID: ${toolCall.id}`)
          console.log(`[OPENAI-TOOLS] Output que se enviará (${toolOutput.output.length} caracteres):`)
          console.log(`[OPENAI-TOOLS] ${toolOutput.output.substring(0, 500)}...`)
          console.log(`[OPENAI-TOOLS] Tokens estimados del output: ${Math.ceil(toolOutput.output.length / 4)}`)
          console.log(`[OPENAI-TOOLS] ================================================`)

          toolOutputs.push(toolOutput)
        }

        // Enviar los resultados de las herramientas al asistente
        console.log(`[OPENAI-TOOLS] ========== ENVIANDO TODOS LOS RESULTADOS ==========`)
        console.log(`[OPENAI-TOOLS] Enviando resultados de ${toolOutputs.length} herramientas al asistente`)

        let totalOutputTokens = 0
        toolOutputs.forEach((output, index) => {
          const tokens = Math.ceil(output.output.length / 4)
          totalOutputTokens += tokens
          console.log(`[OPENAI-TOOLS] Output ${index + 1}: ${tokens} tokens estimados`)
        })
        console.log(`[OPENAI-TOOLS] Total de tokens estimados en outputs: ${totalOutputTokens}`)

        // Submit tool outputs using direct API call
        console.log(`[OPENAI-TOOLS] ========== ENVIANDO TOOL OUTPUTS DIRECTAMENTE ==========`)
        const submitUrl = `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`
        console.log(`[OPENAI-TOOLS] Submit URL: ${submitUrl}`)

        const submitHeaders = {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        }

        const submitBody = {
          tool_outputs: toolOutputs,
        }

        console.log(`[OPENAI-TOOLS] Submit body:`, JSON.stringify(submitBody, null, 2))

        try {
          const submitResponse = await fetch(submitUrl, {
            method: "POST",
            headers: submitHeaders,
            body: JSON.stringify(submitBody),
          })

          console.log(`[OPENAI-TOOLS] Submit response status: ${submitResponse.status}`)
          console.log(`[OPENAI-TOOLS] Submit response headers:`, Object.fromEntries(submitResponse.headers.entries()))

          if (!submitResponse.ok) {
            const errorText = await submitResponse.text()
            console.error(`[OPENAI-TOOLS] Submit error response:`, errorText)
            throw new Error(`Submit tool outputs failed: ${submitResponse.status} ${errorText}`)
          }

          const submitData = await submitResponse.json()
          console.log(`[OPENAI-TOOLS] Submit response data:`, JSON.stringify(submitData, null, 2))
        } catch (error) {
          console.error(`[OPENAI-TOOLS] Error en submit tool outputs directo:`, error)
          throw error
        }

        console.log(`[OPENAI-TOOLS] Resultados enviados exitosamente`)
        console.log(`[OPENAI-TOOLS] ================================================`)

        // Continuar procesando el run después de enviar los resultados
        console.log(`[OPENAI-TOOLS] Continuando procesamiento del run después de ejecutar herramientas`)
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
        console.error(`[OPENAI-TOOLS] Tipo de acción requerida no soportado: ${completedRun.required_action?.type}`)
        throw new Error(`Tipo de acción requerida no soportado: ${completedRun.required_action?.type}`)
      }
    } else if (completedRun.status === "failed") {
      console.error(`[OPENAI-TOOLS] ❌ Run falló: ${completedRun.last_error?.message}`)
      console.error(`[OPENAI-TOOLS] Detalles del error:`, JSON.stringify(completedRun.last_error, null, 2))
      throw new Error(`Run falló: ${completedRun.last_error?.message}`)
    } else {
      console.warn(`[OPENAI-TOOLS] Estado inesperado del run: ${completedRun.status}`)
      throw new Error(`Estado inesperado del run: ${completedRun.status}`)
    }
  } catch (error) {
    console.error(`[OPENAI-TOOLS] ❌ Error en processRunWithCorrectFlow:`, error)

    // Reintentar si no hemos alcanzado el número máximo de reintentos
    if (retryCount < MAX_RETRIES) {
      // Extraer el tiempo de espera del mensaje de error
      let waitTime = RETRY_DELAY
      if (error.message && error.message.includes("Please try again in")) {
        const match = error.message.match(/Please try again in (\d+\.?\d*)s/)
        if (match) {
          waitTime = Math.ceil(Number.parseFloat(match[1]) * 1000) + 1000 // +1s de buffer
        }
      }
      console.log(`[OPENAI-TOOLS] Reintentando en ${waitTime}ms...`)
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

    // Si hemos agotado los reintentos, lanzar el error
    await logError("openai_run", error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// Agregar logging detallado en waitForRunCompletionOrAction
async function waitForRunCompletionOrAction(openai: OpenAI, threadId: string, runId: string) {
  console.log(`[OPENAI-TOOLS] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[OPENAI-TOOLS] Parámetros recibidos:`)
  console.log(`[OPENAI-TOOLS] - threadId: "${threadId}" (tipo: ${typeof threadId})`)
  console.log(`[OPENAI-TOOLS] - runId: "${runId}" (tipo: ${typeof runId})`)

  // Validar que los parámetros no sean undefined
  if (!threadId || threadId === "undefined") {
    console.error(`[OPENAI-TOOLS] ❌ threadId inválido: "${threadId}"`)
    throw new Error(`threadId inválido: "${threadId}"`)
  }

  if (!runId || runId === "undefined") {
    console.error(`[OPENAI-TOOLS] ❌ runId inválido: "${runId}"`)
    throw new Error(`runId inválido: "${runId}"`)
  }

  console.log(`[OPENAI-TOOLS] Esperando a que el run ${runId} se complete o requiera acción...`)

  const startTime = Date.now()

  // Usar fetch directamente en lugar del SDK de OpenAI
  const makeDirectAPICall = async (tId: string, rId: string) => {
    console.log(`[OPENAI-TOOLS] ========== LLAMADA DIRECTA A API ==========`)
    console.log(`[OPENAI-TOOLS] Haciendo llamada directa con threadId="${tId}" y runId="${rId}"`)

    const url = `https://api.openai.com/v1/threads/${tId}/runs/${rId}`
    console.log(`[OPENAI-TOOLS] URL: ${url}`)

    const headers = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "assistants=v2",
    }

    console.log(`[OPENAI-TOOLS] Headers preparados (sin mostrar API key)`)

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
      })

      console.log(`[OPENAI-TOOLS] Response status: ${response.status}`)
      console.log(`[OPENAI-TOOLS] Response headers:`, Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[OPENAI-TOOLS] Error response:`, errorText)
        throw new Error(`API call failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      console.log(`[OPENAI-TOOLS] Response data:`, JSON.stringify(data, null, 2))

      return data
    } catch (error) {
      console.error(`[OPENAI-TOOLS] Error en llamada directa:`, error)
      throw error
    }
  }

  // Usar las variables locales en lugar de los parámetros directos
  const localThreadId = String(threadId)
  const localRunId = String(runId)

  console.log(`[OPENAI-TOOLS] Variables locales: threadId="${localThreadId}", runId="${localRunId}"`)

  let run = await makeDirectAPICall(localThreadId, localRunId)
  let pollCount = 0

  while (run.status === "queued" || run.status === "in_progress") {
    pollCount++

    // Verificar si hemos excedido el timeout
    const elapsed = Date.now() - startTime
    if (elapsed > OPENAI_TIMEOUT) {
      console.error(`[OPENAI-TOOLS] ❌ Timeout esperando a que el run se complete: ${OPENAI_TIMEOUT}ms`)
      throw new Error(`Timeout esperando a que el run se complete: ${OPENAI_TIMEOUT}ms`)
    }

    // Log cada 10 polls para no saturar
    if (pollCount % 10 === 0) {
      console.log(`[OPENAI-TOOLS] Poll ${pollCount}: Estado actual del run: ${run.status} (${elapsed}ms transcurridos)`)
    }

    // Esperar un poco antes de verificar de nuevo
    await wait(1000)

    console.log(`[OPENAI-TOOLS] ========== LLAMADA DIRECTA EN LOOP ==========`)
    console.log(`[OPENAI-TOOLS] Poll ${pollCount}: Haciendo llamada directa`)

    // Obtener el estado actualizado del run usando la llamada directa
    run = await makeDirectAPICall(localThreadId, localRunId)
  }

  const totalTime = Date.now() - startTime
  console.log(`[OPENAI-TOOLS] ✅ Run completado en ${totalTime}ms con estado: ${run.status} (${pollCount} polls)`)
  console.log(`[OPENAI-TOOLS] ================================================`)
  return run
}
