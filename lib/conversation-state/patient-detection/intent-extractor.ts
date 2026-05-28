import { Anthropic } from "@anthropic-ai/sdk";
import { createConversationLogger } from "../logger";

/**
 * Intent Extractor for Initial Contact NLU
 * Llama a Claude para interpretar texto libre del usuario
 */

const client = new Anthropic();

export interface IntentResult {
  intent: string;
  confidence: number;
  extracted_data: {
    dni?: string | null;
    nombre?: string | null;
    obra_social?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  reasoning: string;
}

/**
 * Extrae la intención del mensaje del usuario
 */
export async function extractIntent(
  userMessage: string,
  phoneNumber: string,
  clientId: string,
  context: {
    isNewPatient: boolean;
    patientName?: string;
    patientTurnos?: any[];
  }
): Promise<IntentResult | null> {
  const logger = createConversationLogger(phoneNumber, clientId, "nlu_processing");

  try {
    logger.info("Extracting intent from message", {
      message: userMessage.substring(0, 50),
      isNewPatient: context.isNewPatient,
    });

    // Construir prompt con contexto
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(userMessage, context);

    // Llamar a Claude
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Extraer respuesta
    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    logger.debug("Claude response", {
      response: responseText.substring(0, 100),
    });

    // Parsear JSON
    const result = JSON.parse(responseText) as IntentResult;

    logger.info("Intent extracted", {
      intent: result.intent,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    logger.error("Error extracting intent", error as Error);
    return null;
  }
}

/**
 * Helper: Construye el system prompt desde el documento
 */
function buildSystemPrompt(): string {
  return `# Route to Initial Contact - NLU Only

## Rol
Eres un intérprete de lenguaje natural que extrae la **INTENCIÓN principal** del mensaje del usuario. NO debes responder como un asistente, solo extraer información en JSON puro.

## Instrucciones clave
1. Analiza SOLO el último mensaje del usuario
2. Determina la INTENCIÓN principal
3. Responde SOLO con JSON válido, sin explicaciones adicionales
4. confidence debe ser 0.0-1.0 basado en claridad del mensaje

## Intenciones posibles

### Para pacientes EXISTENTES:
- **confirm_turn**: Usuario quiere confirmar un turno
- **cancel_turn**: Usuario quiere cancelar un turno
- **book_new_turn**: Usuario quiere agendar un nuevo turno
- **reschedule_turn**: Usuario quiere cambiar fecha/hora de turno
- **general_inquiry**: Preguntas sobre horarios, ubicación, espera, etc.

### Para pacientes NUEVOS (sin DNI):
- **dni_submission**: Usuario proporciona DNI
- **patient_info**: Usuario proporciona datos personales
- **pre_registration_question**: Preguntas antes de registrarse
- **abandon**: Usuario no quiere agendar

### Genéricas:
- **farewell**: Despedida
- **unclear**: Mensaje muy vago

## Formato de respuesta (JSON puro)
{
  "intent": "confirm_turn",
  "confidence": 0.95,
  "extracted_data": {
    "dni": null,
    "nombre": null,
    "obra_social": null,
    "email": null,
    "phone": null
  },
  "reasoning": "Explicación breve"
}

Responde SOLO JSON, sin markdown, sin explicaciones adicionales.`;
}

/**
 * Helper: Construye el user prompt con contexto
 */
function buildUserPrompt(
  userMessage: string,
  context: {
    isNewPatient: boolean;
    patientName?: string;
    patientTurnos?: any[];
  }
): string {
  let prompt = `Contexto: `;

  if (context.isNewPatient) {
    prompt += `Paciente NUEVO (aún no registrado)`;
  } else {
    prompt += `Paciente EXISTENTE`;
    if (context.patientName) {
      prompt += ` (${context.patientName})`;
    }
    if (context.patientTurnos && context.patientTurnos.length > 0) {
      prompt += ` con ${context.patientTurnos.length} turno(s) agendado(s)`;
    }
  }

  prompt += `\n\nMensaje del usuario: "${userMessage}"`;

  return prompt;
}

/**
 * Determina si un intent requiere procesamiento backend o envío a otro asistente
 */
export function shouldProcessLocally(intent: string): boolean {
  // Intenciones que se pueden procesar en el backend
  const localIntents = [
    "confirm_turn",
    "cancel_turn",
    "dni_submission",
    "farewell",
    "unclear",
  ];

  return localIntents.includes(intent);
}

/**
 * Mapea intención a acción para el backend
 */
export function mapIntentToAction(
  intent: string,
  isNewPatient: boolean
): string {
  const intentMap: Record<string, Record<string, string>> = {
    existing: {
      confirm_turn: "confirm_appointment",
      cancel_turn: "cancel_appointment",
      book_new_turn: "book_new_appointment",
      reschedule_turn: "reschedule_appointment",
      general_inquiry: "general_inquiry",
      farewell: "end_conversation",
      unclear: "ask_clarification",
    },
    new: {
      dni_submission: "extract_dni",
      patient_info: "extract_patient_info",
      pre_registration_question: "answer_pre_registration",
      abandon: "end_conversation",
      farewell: "end_conversation",
      unclear: "ask_clarification",
    },
  };

  const group = isNewPatient ? "new" : "existing";
  return intentMap[group]?.[intent] || "unknown";
}
