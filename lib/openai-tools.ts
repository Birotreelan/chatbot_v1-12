import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { logError } from "@/lib/monitoring"
import { getAssistantResponse } from "@/lib/assistant"
import OpenAI from "openai"

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
      const truncatedData = response.datos.slice(0, 40)
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
      console.log(`[OPENAI-TOOLS] ================================================`)

      return truncatedResponse
    } else if (typeof response.datos === "object") {
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
  console.log(`[OPENAI-TOOLS] ================================================`)

  return fallbackResponse
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
    console.log(`[OPENAI-TOOLS] ========== EJECUTANDO HERRAMIENTA ==========`)
    console.log(`[OPENAI-TOOLS] Función: ${toolName}`)
    console.log(`[OPENAI-TOOLS] Argumentos recibidos:`, JSON.stringify(toolArgs, null, 2))
    console.log(`[OPENAI-TOOLS] Cliente ID: ${clienteId}`)
    console.log(`[OPENAI-TOOLS] Proxy URL: ${proxyUrl}`)

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
        }
        break

      case "reservar_turno":
        // Implementación simplificada para el ejemplo
        requestBody.Action = "set_turno"
        requestBody.Agenda_Id = "placeholder" // Se necesitaría lógica adicional
        requestBody.Paciente_DNI = toolArgs.dni
        requestBody.Paciente_Nombre = toolArgs.nombre
        requestBody.Paciente_Apellido = toolArgs.apellido
        requestBody.Paciente_Telefono = toolArgs.telefono
        requestBody.Paciente_Email = toolArgs.email
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

    // Hacer la petición con reintentos
    let lastError = null
    let response = null
    const maxRetries = 3
    let retryDelay = 1000

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[OPENAI-TOOLS] Intento ${attempt}/${maxRetries} para ${toolName}`)

        response = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30000),
        })

        break
      } catch (error) {
        lastError = error
        console.error(`[OPENAI-TOOLS] Error en intento ${attempt}/${maxRetries} para ${toolName}:`, error)

        if (attempt < maxRetries) {
          console.log(`[OPENAI-TOOLS] Esperando ${retryDelay}ms antes del siguiente intento...`)
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
          retryDelay *= 2
        }
      }
    }

    if (!response) {
      console.error(`[OPENAI-TOOLS] Todos los intentos fallaron para ${toolName}. Último error:`, lastError)
      throw lastError
    }

    const responseText = await response.text()
    console.log(`[OPENAI-TOOLS] Respuesta recibida para ${toolName}:`, responseText)

    try {
      const data = JSON.parse(responseText)

      // Procesar respuesta según la función
      switch (toolName) {
        case "validar_dni":
          if (data.paciente) {
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
                turnos_proximos: (data.turnos_proximos || []).slice(0, 1).map((turno: any) => ({
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
              exito: false,
              error: {
                codigo: "PACIENTE_NO_ENCONTRADO",
                mensaje: "No se encontró información del paciente",
              },
            }
          }

        default:
          // Para otras funciones, devolver la respuesta tal como viene
          return data
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

// Exportar getAssistantResponse desde lib/assistant.ts
export { getAssistantResponse } from "@/lib/assistant"

function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}
