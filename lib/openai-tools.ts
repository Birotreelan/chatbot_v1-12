import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { logError } from "@/lib/monitoring"
import { getAssistantResponse } from "@/lib/assistant" // Declare the variable before using it
import OpenAI from "openai"
import { wait } from "@/lib/utils"

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
            return {
              exito: false,
              error: {
                codigo: "PACIENTE_NO_ENCONTRADO",
                mensaje: "No se encontró información del paciente",
              },
            }
          }
        case "buscar_turnos_disponibles":
          // Implementación para buscar_turnos_disponibles
          break
        case "reservar_turno":
          // Implementación para reservar_turno
          break
        case "obtener_subespecialidades":
          // Implementación para obtener_subespecialidades
          break
        case "buscar_profesionales":
          // Implementación para buscar_profesionales
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
    } catch (e) {
      console.error(`Error al parsear la respuesta de ${toolName}:`, e)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `La API devolvió una respuesta con formato inválido`,
        },
      }
    }
  } catch (error) {
    console.error(`Error en executeOpenAITool:`, error)
    await logError("execute_openai_tool", error instanceof Error ? error : new Error(String(error)))
    throw error
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
  console.log(
    `[OPENAI-WEB] processWebRunOnly ENTER. Thread ID: '${threadId}' (Type: ${typeof threadId}), Run ID: '${runId}' (Type: ${typeof runId}), Cliente ID: '${clienteId}'`,
  )

  if (typeof threadId !== "string" || !threadId.startsWith("thread_")) {
    const errorMessage = `[OPENAI-WEB] CRITICAL: threadId is invalid before retrieve. Value: '${threadId}', Type: ${typeof threadId}`
    console.error(errorMessage)
    throw new Error(errorMessage)
  }
  if (typeof runId !== "string" || !runId.startsWith("run_")) {
    const errorMessage = `[OPENAI-WEB] CRITICAL: runId is invalid before retrieve. Value: '${runId}', Type: ${typeof runId}`
    console.error(errorMessage)
    throw new Error(errorMessage)
  }

  let run = await openai.beta.threads.runs.retrieve(threadId, runId)
  console.log(`[OPENAI-WEB] Retrieved run status after initial retrieve: ${run.status}`)

  while (run.status === "queued" || run.status === "in_progress") {
    await wait(1000)
    console.log(`[OPENAI-WEB] Polling run. Thread ID: '${threadId}', Run ID: '${runId}'`)
    run = await openai.beta.threads.runs.retrieve(threadId, runId)
    console.log(`[OPENAI-WEB] Polled run status: ${run.status}`)
  }

  if (run.status === "requires_action") {
    if (run.required_action?.type === "submit_tool_outputs") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls
      const toolOutputs = []

      for (const toolCall of toolCalls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments)

        console.log(`[OPENAI-WEB] 🔧 Ejecutando herramienta: ${functionName} con args: ${JSON.stringify(functionArgs)}`)

        const toolResult = await executeOpenAITool(functionName, functionArgs, clienteId)
        console.log(`[OPENAI-WEB] 🔧 Resultado herramienta ${functionName}: ${JSON.stringify(toolResult)}`)

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify(toolResult),
        })
      }

      console.log(`[OPENAI-WEB] Submitting tool outputs. Thread ID: '${threadId}', Run ID: '${runId}'`)
      await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
        tool_outputs: toolOutputs,
      })
      console.log(`[OPENAI-WEB] Tool outputs submitted. Continuing processing.`)

      // Continuar procesando
      await processWebRunOnly(openai, threadId, runId, clienteId)
    }
  } else if (run.status === "failed") {
    console.error(
      `[OPENAI-WEB] Run failed. Thread ID: '${threadId}', Run ID: '${runId}', Error: ${run.last_error?.message}`,
    )
    throw new Error(`Run falló: ${run.last_error?.message}`)
  } else if (run.status === "completed") {
    console.log(`[OPENAI-WEB] ✅ Run web completado. Thread ID: '${threadId}', Run ID: '${runId}'`)
  } else {
    console.warn(
      `[OPENAI-WEB] Run ended with unexpected status: ${run.status}. Thread ID: '${threadId}', Run ID: '${runId}'`,
    )
  }
}

// Importar getAssistantResponse desde lib/assistant.ts
export { getAssistantResponse } from "@/lib/assistant"

function getOpenAIClient() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
  return openai
}
