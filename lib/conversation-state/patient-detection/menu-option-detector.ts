import Anthropic from '@anthropic-ai/sdk';

/**
 * Menu Option Detector - Detecta opciones de menú a partir de texto libre
 * Para el flujo inicial de detección de pacientes
 */

const client = new Anthropic();

export interface MenuOption {
  index: number;
  label: string;
  keywords: string[];
}

export interface DetectionResult {
  detected: boolean;
  selectedOption?: number;
  confidence: number;
  reasoning: string;
}

/**
 * Opciones del menú inicial para pacientes nuevos
 * "¿Cuál es el motivo de tu contacto?"
 */
export const NEW_PATIENT_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar un turno médico',
    keywords: ['turno', 'cita', 'citsación', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'info', 'duda', 'ayuda', 'soporte', 'help'],
  },
];

/**
 * Opciones del menú para pacientes existentes SIN turnos
 */
export const EXISTING_PATIENT_NO_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno médico',
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda'],
  },
];

/**
 * Opciones del menú para pacientes con 1 turno
 */
export const EXISTING_PATIENT_SINGLE_TURNO_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia al turno médico',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes', 'iré'],
  },
  {
    index: 2,
    label: 'Cancelar turno médico',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo', 'no puedo'],
  },
  {
    index: 3,
    label: 'Solicitar otro turno médico',
    keywords: ['otro', 'nuevo', 'turno', 'agendar', 'otro turno', 'another'],
  },
];

/**
 * Opciones del menú para pacientes con múltiples turnos
 */
export const EXISTING_PATIENT_MULTIPLE_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia a un turno',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes'],
  },
  {
    index: 2,
    label: 'Cancelar un turno',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo'],
  },
  {
    index: 3,
    label: 'Solicitar otro turno médico',
    keywords: ['otro', 'nuevo', 'turno', 'agendar', 'otro turno'],
  },
];

/**
 * Detecta qué opción seleccionó el usuario a partir de texto libre
 * Usa 2 estrategias: keyword matching + NLU (Claude)
 *
 * @param userMessage Mensaje del usuario
 * @param menuOptions Opciones disponibles del menú
 * @param phoneNumber Número de teléfono (para logging)
 * @returns Resultado de detección con opción seleccionada o confidence 0
 */
export async function detectMenuOption(
  userMessage: string,
  menuOptions: MenuOption[],
  phoneNumber: string
): Promise<DetectionResult> {
  // Estrategia 1: Keyword matching simple (0ms latencia)
  const keywordMatch = detectByKeywords(userMessage, menuOptions);
  if (keywordMatch.detected && keywordMatch.confidence >= 0.85) {
    return keywordMatch;
  }

  // Estrategia 2: NLU con Claude (200ms latencia)
  try {
    const nluResult = await detectWithNLU(userMessage, menuOptions, phoneNumber);
    if (nluResult.detected && nluResult.confidence >= 0.70) {
      return nluResult;
    }
  } catch (error) {
    console.error('[v0] NLU detection failed, falling back to keyword match', error);
  }

  // Retornar keyword match con confianza baja o no detectado
  return keywordMatch;
}

/**
 * Detecta opciones usando keyword matching
 * Rápido (0ms), pero con falsos negativos en texto natural
 */
function detectByKeywords(
  userMessage: string,
  menuOptions: MenuOption[]
): DetectionResult {
  const normalizedMessage = userMessage.toLowerCase().trim();

  // Buscar coincidencias de palabras clave
  let bestMatch: { option: MenuOption; matches: number } | null = null;

  for (const option of menuOptions) {
    let matches = 0;
    for (const keyword of option.keywords) {
      // Buscar palabra clave completa o como substring
      if (normalizedMessage.includes(keyword)) {
        matches++;
      }
    }

    if (matches > 0) {
      if (!bestMatch || matches > bestMatch.matches) {
        bestMatch = { option, matches };
      }
    }
  }

  if (bestMatch) {
    const confidence = Math.min(0.95, 0.5 + bestMatch.matches * 0.15);
    return {
      detected: true,
      selectedOption: bestMatch.option.index,
      confidence,
      reasoning: `Keyword match (${bestMatch.matches} keywords)`,
    };
  }

  return {
    detected: false,
    confidence: 0,
    reasoning: 'No keywords matched',
  };
}

/**
 * Detecta opciones usando Claude NLU
 * Más preciso pero más lento (200ms)
 */
async function detectWithNLU(
  userMessage: string,
  menuOptions: MenuOption[],
  phoneNumber: string
): Promise<DetectionResult> {
  const systemPrompt = buildNLUSystemPrompt(menuOptions);
  const userPrompt = `Usuario dice: "${userMessage}"`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parsear JSON de respuesta
    const result = JSON.parse(responseText);

    if (result.selected_option && result.confidence >= 0.70) {
      return {
        detected: true,
        selectedOption: result.selected_option,
        confidence: result.confidence,
        reasoning: result.reasoning || 'NLU detection',
      };
    }

    return {
      detected: false,
      confidence: result.confidence || 0,
      reasoning: result.reasoning || 'NLU confidence too low',
    };
  } catch (error) {
    throw new Error(`NLU detection failed: ${String(error)}`);
  }
}

/**
 * Construye el system prompt para Claude
 */
function buildNLUSystemPrompt(menuOptions: MenuOption[]): string {
  const optionsText = menuOptions
    .map((opt) => `${opt.index}. ${opt.label}`)
    .join('\n');

  return `Eres un intérprete de intenciones de usuario para un sistema de turnos médicos.

El usuario está viendo un menú con estas opciones:
${optionsText}

Tu tarea: Determina qué opción seleccionó el usuario basándote en su mensaje.

Responde SOLO con JSON válido (sin markdown, sin explicaciones):
{
  "selected_option": 1,
  "confidence": 0.95,
  "reasoning": "El usuario claramente dice 'turno'"
}

Si la intención no es clara o no coincide con ninguna opción, devuelve:
{
  "selected_option": null,
  "confidence": 0.3,
  "reasoning": "Mensaje ambiguo o irrelevante"
}`;
}
