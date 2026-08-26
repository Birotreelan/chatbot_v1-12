/**
 * lib/conversation-state/shared/ai-option-classifier.ts
 *
 * Clasificador genérico "de último recurso" con IA (GPT-4o-mini) para resolver
 * a qué opción numerada de una lista se refiere un mensaje en lenguaje natural,
 * cuando ningún método determinístico (keywords, texto exacto, números,
 * ordinales, posicionales, fuzzy match, etc.) pudo resolverlo con confianza
 * suficiente.
 *
 * Pensado como pieza ÚNICA y COMPARTIDA (26/8/2026, pedido de Nicolás: "la idea
 * es que podamos armar algo global") para todos los puntos del sistema donde el
 * paciente elige una opción de una lista numerada — menú de bienvenida,
 * selección de sede/profesional/especialidad, selección de turno, confirmación
 * de cancelación, opciones de búsqueda, etc. — en vez de que cada handler tenga
 * su propia integración ad-hoc con IA.
 *
 * Mismo patrón híbrido "reglas determinísticas → GPT-4o-mini" que ya usa
 * nlu-fallback-handler.ts en este proyecto.
 */

import { openai } from '@/lib/openai'

export interface AIOptionCandidate {
  /** Número que el sistema espera de vuelta si el paciente elige esta opción. */
  index: number
  /** Texto visible de la opción tal como se le mostró al paciente. */
  label: string
  /** Info adicional opcional para ayudar a desambiguar (ej. fecha/hora de un turno). */
  details?: string
}

export interface AIOptionClassificationResult {
  detected: boolean
  selectedOption?: number
  confidence: number
  reasoning: string
}

// Confianza mínima para aceptar la respuesta del clasificador de IA.
const AI_CLASSIFIER_MIN_CONFIDENCE = 0.6

/**
 * Le pasa a GPT-4o-mini la lista de opciones (número + texto, y detalle
 * opcional) junto con el mensaje del paciente, y le pide que devuelva el
 * número de opción elegido — o null si el mensaje no corresponde a ninguna.
 *
 * No lanza excepciones: cualquier error (red, parseo, sin API key) se atrapa
 * internamente y se traduce en `{ detected: false }`, para que el caller
 * pueda usarlo como capa final sin necesidad de su propio try/catch.
 *
 * @param userMessage Mensaje del paciente, tal cual lo escribió.
 * @param candidates Opciones disponibles (número + texto que vio el paciente).
 * @param contextHint Frase corta opcional que le da contexto adicional a la IA
 *   sobre qué está eligiendo el paciente (ej. "Está eligiendo un turno de una
 *   lista de horarios disponibles."). Ayuda a desambiguar candidatos parecidos.
 */
export async function classifyOptionWithAI(
  userMessage: string,
  candidates: AIOptionCandidate[],
  contextHint?: string
): Promise<AIOptionClassificationResult> {
  if (!userMessage || !userMessage.trim()) {
    return { detected: false, confidence: 0, reasoning: 'Mensaje vacío' }
  }
  if (candidates.length === 0) {
    return { detected: false, confidence: 0, reasoning: 'Sin opciones para clasificar' }
  }

  const opcionesTexto = candidates
    .map((c) => `${c.index}. ${c.label}${c.details ? ` (${c.details})` : ''}`)
    .join('\n')
  const indicesValidos = candidates.map((c) => c.index)

  const systemPrompt = `Sos un clasificador que determina a cuál opción numerada de una lista se refiere el mensaje de un paciente, en un chatbot de WhatsApp de gestión de turnos médicos.
${contextHint ? `\nContexto: ${contextHint}\n` : ''}
Opciones disponibles:
${opcionesTexto}

Reglas:
- Elegí la opción cuyo significado coincide con lo que el paciente quiso decir, aunque no use las palabras ni el número exacto.
- Si el mensaje no corresponde claramente a ninguna opción (saludo, pregunta libre, cambio de tema), devolvé selectedOption: null.
- Nunca inventes un número que no esté en la lista de opciones disponibles.

Respondé SOLO con JSON: {"selectedOption": <número o null>, "confidence": 0.0-1.0, "reasoning": "..."}`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Mensaje del paciente: "${userMessage}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 150,
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      return { detected: false, confidence: 0, reasoning: 'Sin respuesta del clasificador de IA' }
    }

    const parsed = JSON.parse(responseText) as {
      selectedOption: number | null
      confidence?: number
      reasoning?: string
    }

    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0

    if (
      parsed.selectedOption !== null &&
      parsed.selectedOption !== undefined &&
      indicesValidos.includes(parsed.selectedOption) &&
      confidence >= AI_CLASSIFIER_MIN_CONFIDENCE
    ) {
      return {
        detected: true,
        selectedOption: parsed.selectedOption,
        confidence,
        reasoning: parsed.reasoning || 'Clasificado por IA',
      }
    }

    return {
      detected: false,
      confidence,
      reasoning: parsed.reasoning || 'IA no encontró una opción correspondiente con confianza suficiente',
    }
  } catch (error) {
    return {
      detected: false,
      confidence: 0,
      reasoning: `Error consultando clasificador de IA: ${String(error)}`,
    }
  }
}
