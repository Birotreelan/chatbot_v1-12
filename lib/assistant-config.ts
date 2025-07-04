import OpenAI from "openai"

// System prompts configurables
const SYSTEM_PROMPTS = {
  whatsapp:
    process.env.WHATSAPP_SYSTEM_PROMPT ||
    `
Eres un asistente virtual especializado en gestión de turnos médicos para WhatsApp.

INSTRUCCIONES PRINCIPALES:
- Ayuda a los pacientes a reservar turnos médicos
- Valida DNI antes de proceder con reservas
- Solicita todos los datos necesarios: nombre, apellido, teléfono, email
- Mantén un tono profesional pero amigable
- Responde de forma concisa y clara

FLUJO DE RESERVA:
1. Validar DNI del paciente
2. Si es paciente nuevo, solicitar datos completos
3. Mostrar turnos disponibles
4. Confirmar reserva con todos los datos

Siempre confirma la información antes de proceder con la reserva.
  `.trim(),

  widget:
    process.env.WIDGET_SYSTEM_PROMPT ||
    `
Eres un asistente virtual para el chat web especializado en atención al cliente.

INSTRUCCIONES PRINCIPALES:
- Proporciona información sobre servicios médicos
- Ayuda con consultas generales sobre turnos
- Mantén un tono profesional y servicial
- Responde de forma clara y concisa

CAPACIDADES:
- Información sobre especialidades médicas
- Horarios de atención
- Proceso de reserva de turnos
- Preguntas frecuentes

Si necesitan reservar un turno específico, guíalos al proceso correspondiente.
  `.trim(),
}

export async function configureAssistant(): Promise<string> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    // Verificar si existe un ID de asistente
    const assistantId = process.env.OPENAI_ASSISTANT_ID

    if (!assistantId) {
      throw new Error("OPENAI_ASSISTANT_ID no está configurado en las variables de entorno")
    }

    // Solo verificar que el asistente existe, NO actualizar las instrucciones
    const assistant = await openai.beta.assistants.retrieve(assistantId)

    console.log(`[ASSISTANT_CONFIG] Asistente ID: ${assistantId}`)
    console.log(`[ASSISTANT_CONFIG] Nombre del asistente: ${assistant.name}`)
    console.log(`[ASSISTANT_CONFIG] Modelo: ${assistant.model}`)
    console.log(`[ASSISTANT_CONFIG] Usando instrucciones del panel de OpenAI`)

    return assistantId
  } catch (error) {
    console.error("Error al verificar asistente:", error)
    throw error
  }
}

// Nueva función para crear asistente con system prompt personalizado
export async function createAssistantWithPrompt(
  name: string,
  type: "whatsapp" | "widget" = "whatsapp",
  model = "gpt-4o",
): Promise<string> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const systemPrompt = SYSTEM_PROMPTS[type]

    console.log(`[ASSISTANT_CONFIG] Creando asistente: ${name}`)
    console.log(`[ASSISTANT_CONFIG] Tipo: ${type}`)
    console.log(`[ASSISTANT_CONFIG] System prompt: ${systemPrompt.substring(0, 100)}...`)

    const assistant = await openai.beta.assistants.create({
      name: name,
      instructions: systemPrompt,
      model: model,
      tools: [
        {
          type: "function",
          function: {
            name: "validar_dni",
            description: "Valida DNI del paciente.",
            parameters: {
              type: "object",
              properties: {
                dni: { type: "string", description: "Número de DNI del paciente" },
              },
              required: ["dni"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "buscar_turnos_disponibles",
            description: "Busca turnos disponibles.",
            parameters: {
              type: "object",
              properties: {
                profesional: { type: "string", description: "Nombre del profesional (opcional)" },
                especialidad: { type: "string", description: "Nombre de la especialidad (opcional)" },
                rango_fechas: { type: "string", description: "Rango de fechas en formato YYYY-MM-DD a YYYY-MM-DD" },
              },
              required: [],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "reservar_turno",
            description: "Reserva el turno seleccionado.",
            parameters: {
              type: "object",
              properties: {
                dni: { type: "string", description: "DNI del paciente" },
                nombre: { type: "string", description: "Nombre del paciente" },
                apellido: { type: "string", description: "Apellido del paciente" },
                telefono: { type: "string", description: "Teléfono del paciente" },
                email: { type: "string", description: "Email del paciente" },
                fecha: { type: "string", description: "Fecha del turno en formato YYYY-MM-DD" },
                hora: { type: "string", description: "Hora del turno en formato HH:MM" },
                profesional: { type: "string", description: "Nombre del profesional" },
              },
              required: ["dni", "nombre", "apellido", "telefono", "email", "fecha", "hora", "profesional"],
            },
          },
        },
      ],
    })

    console.log(`[ASSISTANT_CONFIG] ✅ Asistente creado: ${assistant.id}`)
    return assistant.id
  } catch (error) {
    console.error("Error al crear asistente:", error)
    throw error
  }
}

// Función para actualizar system prompt de un asistente existente
export async function updateAssistantPrompt(
  assistantId: string,
  type: "whatsapp" | "widget" = "whatsapp",
): Promise<void> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const systemPrompt = SYSTEM_PROMPTS[type]

    console.log(`[ASSISTANT_CONFIG] Actualizando asistente: ${assistantId}`)
    console.log(`[ASSISTANT_CONFIG] Nuevo system prompt: ${systemPrompt.substring(0, 100)}...`)

    await openai.beta.assistants.update(assistantId, {
      instructions: systemPrompt,
    })

    console.log(`[ASSISTANT_CONFIG] ✅ System prompt actualizado`)
  } catch (error) {
    console.error("Error al actualizar system prompt:", error)
    throw error
  }
}

// Función para obtener el system prompt actual
export function getSystemPrompt(type: "whatsapp" | "widget" = "whatsapp"): string {
  return SYSTEM_PROMPTS[type]
}
