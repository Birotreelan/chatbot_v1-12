/**
 * Entity Extractor / Slot Filling (Sprint 50)
 *
 * Extrae entidades relevantes para el flujo de un mensaje en lenguaje libre.
 * Permite que el paciente diga todo en un solo mensaje y el bot solo pida lo que falta.
 *
 * Ejemplo:
 *   "Hola, soy Miguel Guemes DNI 13456123 y quiero un turno con el Dr Montoya"
 *   → { nombre: "Miguel", apellido: "Guemes", dni: "13456123", profesional: "Montoya" }
 *
 * Estrategia:
 *   1. DNI: siempre regex (100% fiable, patrón numérico claro)
 *   2. Resto: GPT-4o-mini con JSON schema strict (structured output)
 *   3. Si GPT falla → retorna solo lo que regex pudo extraer
 *
 * Confiabilidad:
 *   - JSON schema strict garantiza estructura (nunca inventa campos extra)
 *   - Temperatura 0 para máxima consistencia
 *   - Campos no encontrados → null (el flujo los pedirá igual)
 *   - Profesional se devuelve tal como lo menciona el usuario (fuzzy match se hace después contra la API)
 */

import { openai } from '@/lib/openai'
import { formatHistoryForPrompt, type ConversationMessage } from './conversation-history'

// ============================================================================
// TIPOS
// ============================================================================

export interface ExtractedEntities {
  /** Primer nombre del paciente (capitalizado) */
  nombre: string | null
  /** Apellido(s) del paciente (capitalizado) */
  apellido: string | null
  /** DNI sin puntos ni espacios */
  dni: string | null
  /** Nombre del profesional mencionado (tal como lo dijo el usuario) */
  profesional: string | null
  /** Nombre de la obra social o prepaga mencionada */
  obra_social: string | null
  /** Especialidad o motivo de consulta mencionado */
  motivo: string | null
}

export interface ExtractionResult {
  entities: ExtractedEntities
  /** true si al menos un campo fue extraído */
  hasData: boolean
  /** true si GPT fue consultado */
  usedGPT: boolean
}

// Schema para GPT structured output
const ENTITY_SCHEMA = {
  type: "object" as const,
  properties: {
    nombre: {
      type: ["string", "null"] as any,
      description: "Primer nombre del paciente. null si no se menciona."
    },
    apellido: {
      type: ["string", "null"] as any,
      description: "Apellido o apellidos del paciente. null si no se menciona."
    },
    profesional: {
      type: ["string", "null"] as any,
      description: "Nombre del médico o profesional que el paciente solicita. Incluir solo el apellido o nombre mencionado, sin título. null si no se menciona."
    },
    obra_social: {
      type: ["string", "null"] as any,
      description: "Nombre de la obra social, prepaga o cobertura de salud mencionada. null si no se menciona."
    },
    motivo: {
      type: ["string", "null"] as any,
      description: "Especialidad médica, motivo de consulta o tipo de turno solicitado. null si no se menciona."
    }
  },
  required: ["nombre", "apellido", "profesional", "obra_social", "motivo"],
  additionalProperties: false
}

// ============================================================================
// EXTRACCIÓN POR REGEX
// ============================================================================

/**
 * Extrae DNI del texto con regex (7-8 dígitos, opcionalmente con puntos)
 * Ejemplos: "13456123", "13.456.123", "DNI 13456123"
 */
function extractDNIWithRegex(text: string): string | null {
  // Primero buscar formato con puntos: 12.345.678
  const withDots = text.match(/\b(\d{1,2})\.(\d{3})\.(\d{3})\b/)
  if (withDots) {
    return withDots[1] + withDots[2] + withDots[3]
  }

  // Luego buscar después de "DNI" o "D.N.I"
  const afterDNI = text.match(/\b(?:dni|d\.n\.i\.?)\s*[:\-]?\s*(\d{7,8})\b/i)
  if (afterDNI) {
    return afterDNI[1]
  }

  // Número de 7-8 dígitos aislado (no parte de teléfono u otro contexto)
  const isolated = text.match(/(?<!\d)(\d{7,8})(?!\d)/)
  if (isolated) {
    return isolated[1]
  }

  return null
}

// ============================================================================
// EXTRACCIÓN CON GPT
// ============================================================================

async function extractWithGPT(
  userMessage: string,
  history: ConversationMessage[]
): Promise<Omit<ExtractedEntities, 'dni'>> {
  const historyContext = formatHistoryForPrompt(history, 4)

  const systemPrompt = `Eres un extractor de entidades para un sistema de turnos médicos en Argentina.
Tu única tarea es identificar si el paciente mencionó: su nombre, apellido, el médico que busca, su obra social y el motivo o especialidad.
Responde SOLO con el JSON solicitado. No agregues explicaciones.
Si una entidad no está claramente mencionada, devuelve null para ese campo.
No inventes datos. No asumas. Solo extrae lo que el paciente escribió explícitamente.`

  const userPrompt = historyContext
    ? `Contexto previo de la conversación:\n${historyContext}\n\nMensaje actual del paciente:\n"${userMessage}"`
    : `Mensaje del paciente:\n"${userMessage}"`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 150,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'entity_extraction',
        strict: true,
        schema: ENTITY_SCHEMA
      }
    }
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('GPT returned empty response')

  const parsed = JSON.parse(content)

  return {
    nombre: parsed.nombre || null,
    apellido: parsed.apellido || null,
    profesional: parsed.profesional || null,
    obra_social: parsed.obra_social || null,
    motivo: parsed.motivo || null,
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Extrae entidades de un mensaje libre del paciente.
 * DNI siempre por regex. Resto por GPT-4o-mini si está disponible.
 *
 * @param userMessage - Mensaje del paciente
 * @param history - Historial conversacional (para contexto GPT)
 * @param useGPT - Si false, solo usa regex (sin costo, sin latencia)
 */
export async function extractEntities(
  userMessage: string,
  history: ConversationMessage[] = [],
  useGPT: boolean = true
): Promise<ExtractionResult> {
  const dni = extractDNIWithRegex(userMessage)

  let gptEntities: Omit<ExtractedEntities, 'dni'> = {
    nombre: null,
    apellido: null,
    profesional: null,
    obra_social: null,
    motivo: null,
  }

  let usedGPT = false

  if (useGPT) {
    try {
      gptEntities = await extractWithGPT(userMessage, history)
      usedGPT = true
    } catch (error) {
      console.error('[ENTITY-EXTRACTOR] GPT extraction failed, using regex only:', error)
    }
  }

  // Capitalizar nombre y apellido si vienen de GPT
  const capitalize = (str: string | null) =>
    str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : null

  const entities: ExtractedEntities = {
    nombre: capitalize(gptEntities.nombre),
    apellido: gptEntities.apellido
      ? gptEntities.apellido.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
      : null,
    dni,
    profesional: gptEntities.profesional || null,
    obra_social: gptEntities.obra_social || null,
    motivo: gptEntities.motivo || null,
  }

  const hasData = Object.values(entities).some(v => v !== null)

  return { entities, hasData, usedGPT }
}

/**
 * Extrae solo el DNI con regex (sin GPT, sin costo)
 */
export function extractDNI(text: string): string | null {
  return extractDNIWithRegex(text)
}
