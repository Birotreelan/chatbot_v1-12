import { validateDNI, searchTurnos, reserveTurno, getSedes } from "./clinic-api"
import { getArgentinaDateTime } from "./utils/date-utils"
import { getThreadForUser, updateWhatsAppStats } from "./db"
import { getOrCreateThread, addMessageToThread, runAssistant } from "./openai"
import { getWhatsAppConfig } from "./db"
import type { WhatsAppConfig } from "./types"

interface ProcessWhatsAppMessageParams {
  message: string
  phoneNumber: string
  config: WhatsAppConfig
}

interface ProcessMessageParams {
  userPhone: string
  userName: string
  message: string
  phoneNumberId: string
}

// Función para crear el bloque [SISTEMA] para WhatsApp con datos de sedes
async function createWhatsAppSystemBlock(
  clinicName: string,
  phoneNumber: string,
  clienteId?: string,
  sedeId?: string,
): Promise<string> {
  const fechaHora = getArgentinaDateTime()

  let sedesInfo = "No disponible"

  // Obtener datos de sedes si tenemos clienteId
  if (clienteId) {
    try {
      console.log(`[WHATSAPP-PROCESSOR] 🏥 Obteniendo datos de sedes para cliente: ${clienteId}`)
      const sedesResult = await getSedes(clienteId)

      if (sedesResult.success && sedesResult.data) {
        // Formatear los datos de sedes para el bloque [SISTEMA]
        if (Array.isArray(sedesResult.data)) {
          sedesInfo = sedesResult.data
            .map(
              (sede: any) =>
                `ID: ${sede.Id || sede.id}, Nombre: ${sede.Nombre || sede.nombre || "Sin nombre"}, Direccion: ${sede.Direccion || sede.direccion || "Sin dirección"}`,
            )
            .join(" | ")
        } else if (sedesResult.data.sedes && Array.isArray(sedesResult.data.sedes)) {
          sedesInfo = sedesResult.data.sedes
            .map(
              (sede: any) =>
                `ID: ${sede.Id || sede.id}, Nombre: ${sede.Nombre || sede.nombre || "Sin nombre"}, Direccion: ${sede.Direccion || sede.direccion || "Sin dirección"}`,
            )
            .join(" | ")
        } else {
          sedesInfo = JSON.stringify(sedesResult.data).substring(0, 200) + "..."
        }
        console.log(`[WHATSAPP-PROCESSOR] ✅ Sedes obtenidas y formateadas`)
      } else {
        console.log(`[WHATSAPP-PROCESSOR] ⚠️ No se pudieron obtener sedes: ${sedesResult.error}`)
        sedesInfo = `Error: ${sedesResult.error}`
      }
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error obteniendo sedes:`, error)
      sedesInfo = "Error al obtener sedes"
    }
  }

  return `[SISTEMA]
Nombre: ${clinicName}
FechaHora: ${fechaHora}
CelularPaciente: ${phoneNumber}
Cliente_id: ${clienteId || "No configurado"}
sede_id: ${sedeId || "No configurado"}
Sedes_Disponibles: ${sedesInfo}
[/SISTEMA]`
}

export async function processWhatsAppMessage(params: ProcessWhatsAppMessageParams): Promise<string> {
  try {
    const { message, phoneNumber, config } = params
    console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO MENSAJE WHATSAPP ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Teléfono: ${phoneNumber}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente: ${config.displayName}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${config.cliente_id}`)
    console.log(`[WHATSAPP-PROCESSOR] Sede ID: ${config.sede_id}`)
    console.log(`[WHATSAPP-PROCESSOR] Mensaje: ${message}`)
    console.log(`[WHATSAPP-PROCESSOR] ================================================`)

    // Validar parámetros
    if (!phoneNumber || !message || !config?.whatsappAssistantId) {
      throw new Error("Parámetros requeridos faltantes")
    }

    // Obtener cliente_id de la configuración
    const clienteId = config.cliente_id || ""
    const sedeId = config.sede_id || ""

    if (!clienteId) {
      console.error(`[WHATSAPP-PROCESSOR] ❌ Cliente ID faltante en configuración`)
      throw new Error("Cliente ID no configurado")
    }

    // Obtener o crear thread
    const { threadId, isNewThread, isResetThread } = await getThreadForUser(phoneNumber, config.id)
    console.log(`[WHATSAPP-PROCESSOR] 🌐 Usando thread: ${threadId} (nuevo: ${isNewThread}, reset: ${isResetThread})`)

    // Crear el mensaje con bloque [SISTEMA] (ahora es async)
    const systemBlock = await createWhatsAppSystemBlock(config.displayName, phoneNumber, clienteId, sedeId)
    const fullMessage = `${systemBlock}\n\n${message}`

    console.log(`[WHATSAPP-PROCESSOR] 📋 Bloque [SISTEMA] creado:`)
    console.log(systemBlock)

    // Procesar mensaje
    const response = await processMessageWithOpenAI(threadId, fullMessage, config.whatsappAssistantId, clienteId)
    console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta: ${response.length} caracteres`)

    // Actualizar estadísticas
    await updateWhatsAppStats(config.id, { messagesProcessed: 1 })

    return response
  } catch (error) {
    console.error("[WHATSAPP-PROCESSOR] ❌ Error:", error)

    // Actualizar estadísticas de error
    if (params.config?.id) {
      await updateWhatsAppStats(params.config.id, { errors: 1 })
    }

    return "Lo siento, ha ocurrido un error. Por favor, intenta nuevamente."
  }
}

async function processMessageWithOpenAI(
  threadId: string,
  message: string,
  whatsappAssistantId: string,
  clienteId: string,
): Promise<string> {
  try {
    console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO CON OPENAI ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Thread ID: ${threadId}`)
    console.log(`[WHATSAPP-PROCESSOR] Assistant ID: ${whatsappAssistantId}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
    console.log(`[WHATSAPP-PROCESSOR] ================================================`)

    // 1. Añadir mensaje al thread
    console.log(`[WHATSAPP-PROCESSOR] Añadiendo mensaje al thread: ${threadId}`)
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: message,
      }),
    })

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text()
      throw new Error(`Error adding message: ${messageResponse.status} - ${errorText}`)
    }

    const messageData = await messageResponse.json()
    console.log(`[WHATSAPP-PROCESSOR] Mensaje añadido: ${messageData.id}`)

    // 2. Crear run
    console.log(`[WHATSAPP-PROCESSOR] Creando run con assistant: ${whatsappAssistantId}`)
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        assistant_id: whatsappAssistantId,
        tools: [
          {
            type: "function",
            function: {
              name: "validate_dni",
              description: "Valida un DNI y obtiene información del paciente",
              parameters: {
                type: "object",
                properties: {
                  dni: { type: "string", description: "DNI a validar" },
                },
                required: ["dni"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "obtener_subespecialidades",
              description: "Lista las subespecialidades disponibles",
              parameters: {
                type: "object",
                properties: {},
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "buscar_profesionales",
              description: "Busca profesionales por nombre o especialidad",
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
            type: "function",
            function: {
              name: "validar_obra_social",
              description: "Valida si la obra social ingresada por el paciente existe y permite turnos online",
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
          {
            type: "function",
            function: {
              name: "search_turnos",
              description:
                "Busca turnos disponibles. Si no se especifica rangoFechas, usa fechas actuales automáticamente.",
              parameters: {
                type: "object",
                properties: {
                  rangoFechas: {
                    type: "string",
                    description:
                      "Rango de fechas en formato YYYY-MM-DD a YYYY-MM-DD. Si no se especifica, usa fechas actuales.",
                  },
                  profesional: {
                    type: "string",
                    description: "Nombre del profesional (opcional)",
                  },
                  especialidad: {
                    type: "string",
                    description: "Nombre de la especialidad (opcional)",
                  },
                  profesionalId: {
                    type: "string",
                    description: "ID del profesional (opcional)",
                  },
                },
                required: [],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "reserve_turno",
              description:
                "Reserva un turno específico para un paciente usando los datos recopilados durante la conversación",
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
                  agendaId: {
                    type: "string",
                    description: "ID del turno/agenda a reservar",
                  },
                },
                required: [
                  "dni",
                  "nombre",
                  "apellido",
                  "telefono",
                  "email",
                  "fecha",
                  "hora",
                  "profesional",
                  "agendaId",
                ],
              },
            },
          },
        ],
      }),
    })

    if (!runResponse.ok) {
      const errorText = await runResponse.text()
      throw new Error(`Error creating run: ${runResponse.status} - ${errorText}`)
    }

    const runData = await runResponse.json()
    console.log(`[WHATSAPP-PROCESSOR] Run creado: ${runData.id}`)

    // 3. Esperar completación
    const finalResponse = await waitForRunCompletion(threadId, runData.id, clienteId)
    return finalResponse
  } catch (error) {
    console.error("[WHATSAPP-PROCESSOR] Error procesando mensaje:", error)
    throw error
  }
}

async function waitForRunCompletion(threadId: string, runId: string, clienteId: string): Promise<string> {
  let attempts = 0
  const maxAttempts = 60 // Aumentar a 60 intentos (60 segundos)

  console.log(`[WHATSAPP-PROCESSOR] ========== ESPERANDO COMPLETACIÓN ==========`)
  console.log(`[WHATSAPP-PROCESSOR] Run ID: ${runId}`)
  console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
  console.log(`[WHATSAPP-PROCESSOR] ================================================`)

  while (attempts < maxAttempts) {
    try {
      console.log(`[WHATSAPP-PROCESSOR] Verificando run ${runId} (intento ${attempts + 1}/${maxAttempts})`)

      const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
      })

      if (!runResponse.ok) {
        const errorText = await runResponse.text()
        throw new Error(`Error checking run: ${runResponse.status} - ${errorText}`)
      }

      const run = await runResponse.json()
      console.log(`[WHATSAPP-PROCESSOR] Estado del run: ${run.status}`)

      if (run.status === "completed") {
        // Obtener mensajes
        const messagesResponse = await fetch(
          `https://api.openai.com/v1/threads/${threadId}/messages?limit=1&order=desc`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
              "OpenAI-Beta": "assistants=v2",
            },
          },
        )

        if (!messagesResponse.ok) {
          const errorText = await messagesResponse.text()
          throw new Error(`Error getting messages: ${messagesResponse.status} - ${errorText}`)
        }

        const messages = await messagesResponse.json()
        if (messages.data.length > 0) {
          const lastMessage = messages.data[0]
          if (lastMessage.content[0]?.type === "text") {
            const response = lastMessage.content[0].text.value

            console.log(`[WHATSAPP-PROCESSOR] ✅ Respuesta final: ${response.length} caracteres`)
            return response
          }
        }

        return "Respuesta procesada correctamente."
      } else if (run.status === "requires_action") {
        console.log(`[WHATSAPP-PROCESSOR] Run requiere acción - procesando tool calls`)
        await handleToolCalls(threadId, runId, run, clienteId)
      } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
        console.error(`[WHATSAPP-PROCESSOR] Run falló con estado: ${run.status}`)
        if (run.last_error) {
          console.error(`[WHATSAPP-PROCESSOR] Error details:`, run.last_error)
        }
        return "Lo siento, ha ocurrido un error procesando tu solicitud."
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`[WHATSAPP-PROCESSOR] Error en intento ${attempts + 1}:`, error)
      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return "La solicitud está tomando más tiempo del esperado. Por favor, intenta nuevamente."
}

async function handleToolCalls(threadId: string, runId: string, run: any, clienteId: string): Promise<void> {
  try {
    console.log(`[WHATSAPP-PROCESSOR] ========== PROCESANDO TOOL CALLS ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Cantidad: ${run.required_action.submit_tool_outputs.tool_calls.length}`)
    console.log(`[WHATSAPP-PROCESSOR] Cliente ID: ${clienteId}`)
    console.log(`[WHATSAPP-PROCESSOR] ================================================`)

    const toolOutputs = []

    for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
      console.log(`[WHATSAPP-PROCESSOR] ========== TOOL CALL ==========`)
      console.log(`[WHATSAPP-PROCESSOR] Función: ${toolCall.function.name}`)
      console.log(`[WHATSAPP-PROCESSOR] Argumentos: ${toolCall.function.arguments}`)
      console.log(`[WHATSAPP-PROCESSOR] ================================`)

      try {
        let output = ""
        const args = JSON.parse(toolCall.function.arguments)

        switch (toolCall.function.name) {
          case "validate_dni":
            console.log(`[WHATSAPP-PROCESSOR] 🔍 Validando DNI: ${args.dni} con cliente: ${clienteId}`)

            try {
              const dniResult = await validateDNI(args.dni, clienteId)
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado DNI:`, dniResult)
              output = JSON.stringify(dniResult)
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error validando DNI:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para gestionar tu turno.",
                fallback: true,
              })
            }
            break

          case "obtener_subespecialidades":
            console.log(`[WHATSAPP-PROCESSOR] 📋 Obteniendo subespecialidades con cliente: ${clienteId}`)

            try {
              const { obtenerSubespecialidades } = await import("@/lib/api-tools/api-functions")
              const subespecialidadesResult = await obtenerSubespecialidades(clienteId)
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado subespecialidades:`, subespecialidadesResult)
              output = JSON.stringify(subespecialidadesResult)
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error obteniendo subespecialidades:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar especialidades.",
                fallback: true,
              })
            }
            break

          case "buscar_profesionales":
            console.log(`[WHATSAPP-PROCESSOR] 👨‍⚕️ Buscando profesionales con cliente: ${clienteId}`)
            console.log(`[WHATSAPP-PROCESSOR] 📋 Búsqueda: ${args.busqueda}`)

            try {
              const { buscarProfesionales } = await import("@/lib/api-tools/api-functions")
              const profesionalesResult = await buscarProfesionales(clienteId, args.busqueda || "")
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado profesionales:`, profesionalesResult)
              output = JSON.stringify(profesionalesResult)
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error buscando profesionales:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar profesionales.",
                fallback: true,
              })
            }
            break

          case "validar_obra_social":
            console.log(`[WHATSAPP-PROCESSOR] 🏥 Validando obra social con cliente: ${clienteId}`)
            console.log(`[WHATSAPP-PROCESSOR] 📋 Búsqueda: ${args.busqueda}`)

            try {
              const { validarObraSocial } = await import("@/lib/api-tools/api-functions")
              const obraSocialResult = await validarObraSocial(clienteId, args.busqueda || "")
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado obra social:`, obraSocialResult)

              if (typeof obraSocialResult === "object") {
                output = JSON.stringify(obraSocialResult)
              } else {
                output = String(obraSocialResult)
              }
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error validando obra social:`, error)
              output = JSON.stringify({
                exito: false,
                error: {
                  codigo: "ERROR_VALIDACION_OBRA_SOCIAL",
                  mensaje:
                    "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar obras sociales.",
                },
                fallback: true,
              })
            }
            break

          case "search_turnos":
            console.log(`[WHATSAPP-PROCESSOR] 📅 Buscando turnos con cliente: ${clienteId}`)
            console.log(`[WHATSAPP-PROCESSOR] 📋 Parámetros:`, args)

            try {
              const turnosResult = await searchTurnos(
                {
                  rangoFechas: args.rangoFechas,
                  profesional: args.profesional,
                  especialidad: args.especialidad,
                  profesionalId: args.profesionalId,
                },
                clienteId,
              )
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado turnos:`, turnosResult)
              output = JSON.stringify(turnosResult)
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error buscando turnos:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para consultar turnos disponibles.",
                fallback: true,
              })
            }
            break

          case "reserve_turno":
            console.log(`[WHATSAPP-PROCESSOR] 🎯 Reservando turno con cliente: ${clienteId}`)
            console.log(`[WHATSAPP-PROCESSOR] 📋 Datos de reserva:`, args)

            try {
              const reserveResult = await reserveTurno(
                {
                  agendaId: args.agendaId,
                  dni: args.dni,
                  nombre: args.nombre,
                  apellido: args.apellido,
                  telefono: args.telefono,
                  email: args.email,
                  fecha: args.fecha,
                  hora: args.hora,
                  profesional: args.profesional,
                },
                clienteId,
              )
              console.log(`[WHATSAPP-PROCESSOR] 📋 Resultado reserva:`, reserveResult)
              output = JSON.stringify(reserveResult)
            } catch (error) {
              console.error(`[WHATSAPP-PROCESSOR] ❌ Error reservando turno:`, error)
              output = JSON.stringify({
                success: false,
                error:
                  "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica para reservar tu turno.",
                fallback: true,
              })
            }
            break

          default:
            console.log(`[WHATSAPP-PROCESSOR] ❌ Tool call no reconocido: ${toolCall.function.name}`)
            output = JSON.stringify({ error: "Función no disponible" })
        }

        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: output,
        })

        console.log(`[WHATSAPP-PROCESSOR] ✅ Tool call procesado: ${toolCall.function.name}`)
      } catch (error) {
        console.error(`[WHATSAPP-PROCESSOR] ❌ Error en tool call ${toolCall.function.name}:`, error)
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({
            error: "Servicio temporalmente no disponible. Por favor, contacta directamente a la clínica.",
            fallback: true,
          }),
        })
      }
    }

    // Enviar tool outputs
    console.log(`[WHATSAPP-PROCESSOR] ========== ENVIANDO TOOL OUTPUTS ==========`)
    console.log(`[WHATSAPP-PROCESSOR] Cantidad: ${toolOutputs.length}`)

    const submitResponse = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          tool_outputs: toolOutputs,
        }),
      },
    )

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text()
      console.error(`[WHATSAPP-PROCESSOR] ❌ Error submitting tool outputs: ${submitResponse.status} ${errorText}`)
      throw new Error(`Error submitting tool outputs: ${submitResponse.status}`)
    }

    console.log(`[WHATSAPP-PROCESSOR] ✅ Tool outputs enviados correctamente`)
    console.log(`[WHATSAPP-PROCESSOR] ================================================`)
  } catch (error) {
    console.error("[WHATSAPP-PROCESSOR] ❌ Error en handleToolCalls:", error)
    throw error
  }
}

export async function processMessage({
  userPhone,
  userName,
  message,
  phoneNumberId,
}: ProcessMessageParams): Promise<string | null> {
  console.log(`[PROCESSOR] 🚀 Iniciando procesamiento para ${userName}`)

  try {
    // Obtener configuración de WhatsApp
    const config = await getWhatsAppConfig(phoneNumberId)
    if (!config) {
      console.error(`[PROCESSOR] ❌ No se encontró configuración para ${phoneNumberId}`)
      return "Lo siento, hay un problema de configuración. Por favor contacta al administrador."
    }

    console.log(`[PROCESSOR] ⚙️ Usando asistente: ${config.assistantId}`)

    // Obtener o crear thread para el usuario
    const threadId = await getOrCreateThread(userPhone)
    console.log(`[PROCESSOR] 🧵 Thread ID: ${threadId}`)

    // Agregar mensaje del usuario al thread
    await addMessageToThread(threadId, message)
    console.log(`[PROCESSOR] ✅ Mensaje agregado al thread`)

    // Ejecutar el asistente
    console.log(`[PROCESSOR] 🤖 Ejecutando asistente...`)
    const response = await runAssistant(threadId, config.assistantId)

    if (response) {
      console.log(`[PROCESSOR] ✅ Respuesta generada: "${response.substring(0, 100)}..."`)
      return response
    } else {
      console.log(`[PROCESSOR] ⚠️ No se obtuvo respuesta del asistente`)
      return "Lo siento, no pude procesar tu mensaje en este momento. Por favor intenta de nuevo."
    }
  } catch (error) {
    console.error(`[PROCESSOR] ❌ Error procesando mensaje:`, error)

    // Respuesta de error amigable
    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        return "Lo siento, el procesamiento está tomando más tiempo del esperado. Por favor intenta de nuevo."
      } else if (error.message.includes("rate limit")) {
        return "Estoy recibiendo muchos mensajes. Por favor espera un momento antes de enviar otro mensaje."
      }
    }

    return "Lo siento, ocurrió un error procesando tu mensaje. Por favor intenta de nuevo más tarde."
  }
}
