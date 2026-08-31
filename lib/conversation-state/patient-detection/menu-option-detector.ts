import { createConversationLogger } from '../logger'
import { classifyOptionWithAI } from '../shared/ai-option-classifier'

/**
 * Menu Option Detector - Detecta opciones de menú a partir de texto libre
 * Para el flujo inicial de detección de pacientes
 *
 * 3 capas, de más rápida/gratis a más lenta/costosa:
 * 1. Keyword matching (0ms, gratis)
 * 1.5. Match exacto/aproximado contra el label del botón (0ms, gratis) — agregado
 *      26/8/2026 (caso Rebeca, tel. 1123127066): escribir el texto exacto de un
 *      botón ("Realizar otra consulta") no siempre alcanzaba 2+ keywords, así que
 *      quedaba por debajo del umbral de confianza y no se reconocía.
 * 2. Clasificador con GPT-4o-mini (~1s, costo mínimo) — solo si 1 y 1.5 fallan.
 *    Mismo patrón híbrido "reglas → GPT-4o-mini" que ya usa nlu-fallback-handler.ts.
 */

export interface MenuOption {
  index: number
  label: string
  keywords: string[]
}

export interface DetectionResult {
  detected: boolean
  selectedOption?: number
  confidence: number
  reasoning: string
}

/**
 * Opciones del menú inicial para pacientes nuevos
 * "¿Cuál es el motivo de tu contacto?"
 */
export const NEW_PATIENT_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno médico',
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor', 'consulta médica'],
  },
  {
    index: 2,
    label: 'Solicitar turno para un familiar',
    keywords: ['familiar', 'hijo', 'hija', 'esposa', 'esposo', 'madre', 'padre', 'mama', 'mamá', 'papa', 'papá', 'pareja', 'hermano', 'hermana'],
  },
  {
    index: 3,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'info', 'duda', 'ayuda', 'soporte', 'help', 'otra'],
  },
]

/**
 * Opciones del menú para pacientes existentes SIN turnos
 * Incluye opcion para solicitar turno para un familiar
 */
export const EXISTING_PATIENT_NO_TURNOS_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno médico',
    keywords: ['turno', 'cita', 'agendar', 'reserva', 'appointment', 'médico', 'doctor'],
  },
  {
    index: 2,
    label: 'Solicitar turno para un familiar',
    keywords: ['familiar', 'hijo', 'hija', 'esposa', 'esposo', 'madre', 'padre', 'mama', 'mamá', 'papa', 'papá', 'pareja', 'hermano', 'hermana', 'familiar'],
  },
  {
    index: 3,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda'],
  },
]

/**
 * Menú de paciente existente SIN turnos cuando su obra social no admite turnos
 * online (31/8/2026). No se ofrece el turno propio y todo se corre un número —
 * debe coincidir con buildExistingPatientNoTurnosGreeting (patient-templates.ts)
 * y con el action map de patient-flow-handler.ts.
 */
export const EXISTING_PATIENT_NO_TURNOS_OS_BLOQUEADA_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Solicitar turno para un familiar',
    keywords: ['familiar', 'hijo', 'hija', 'esposa', 'esposo', 'madre', 'padre', 'mama', 'mamá', 'papa', 'papá', 'pareja', 'hermano', 'hermana'],
  },
  {
    index: 2,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda'],
  },
]

/**
 * Opciones del menú durante la solicitud de DNI del familiar
 * Solo para detección simple si el usuario escribe texto libre en vez de un DNI
 */
export const FAMILIAR_DNI_MENU: MenuOption[] = [
  {
    index: 0,
    label: 'DNI del familiar',
    keywords: [], // No se usa para keyword matching, solo para contexto
  },
]

/**
 * Opciones del menú para pacientes con 1 turno
 */
export const EXISTING_PATIENT_SINGLE_TURNO_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Confirmar asistencia al turno médico',
    keywords: ['confirmar', 'si', 'voy', 'asistencia', 'confirm', 'yes', 'iré', 'voy a ir', 'listo'],
  },
  {
    index: 2,
    label: 'Cancelar turno médico',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo', 'no puedo', 'no puedo ir'],
  },
  {
    index: 3,
    label: 'Cancelar el turno médico y solicitar uno nuevo',
    keywords: ['otro', 'nuevo', 'agendar', 'otro turno', 'another', 'más turnos', 'cancelar y', 'cambiar turno', 'reprogramar', 'cancelar otro'],
  },
  {
    index: 4,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda', 'otra consulta', 'otro tema'],
  },
]

/**
 * Opciones del menú para pacientes con UN turno PENDIENTE DE APROBACIÓN por la clínica.
 * La confirmación de asistencia NO está disponible mientras la clínica no apruebe el turno,
 * por eso esta variante omite la opción "Confirmar asistencia" y renumera el resto.
 * (El estado "No confirmado" SÍ permite confirmar y usa EXISTING_PATIENT_SINGLE_TURNO_MENU.)
 */
export const EXISTING_PATIENT_SINGLE_TURNO_PENDIENTE_MENU: MenuOption[] = [
  {
    index: 1,
    label: 'Cancelar turno médico',
    keywords: ['cancelar', 'no', 'no voy', 'cancel', 'cancelo', 'no puedo', 'no puedo ir'],
  },
  {
    index: 2,
    label: 'Cancelar el turno médico y solicitar uno nuevo',
    keywords: ['otro', 'nuevo', 'agendar', 'otro turno', 'another', 'más turnos', 'cancelar y', 'cambiar turno', 'reprogramar', 'cancelar otro'],
  },
  {
    index: 3,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda', 'otra consulta', 'otro tema'],
  },
]

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
    label: 'Cancelar un turno y solicitar uno nuevo',
    keywords: ['otro', 'nuevo', 'agendar', 'otro turno', 'cancelar y', 'cambiar turno', 'reprogramar', 'cancelar otro'],
  },
  {
    index: 4,
    label: 'Realizar otra consulta',
    keywords: ['consulta', 'pregunta', 'información', 'duda', 'ayuda', 'otra consulta', 'otro tema'],
  },
]

/**
 * Detecta qué opción seleccionó el usuario a partir de texto libre.
 * Encadena 3 capas (ver comentario arriba del archivo); cada una solo corre
 * si la anterior no llegó a una detección confiable.
 *
 * @param userMessage Mensaje del usuario
 * @param menuOptions Opciones disponibles del menú
 * @param phoneNumber Número de teléfono (para logging)
 * @param useAIFallback Si es true (default), cuando las capas gratis fallan se
 *   consulta a GPT-4o-mini antes de darse por vencido. Poner en false para
 *   contextos donde no conviene pagar la latencia/costo de una llamada a IA.
 * @returns Resultado de detección con opción seleccionada o confidence 0
 */
export async function detectMenuOption(
  userMessage: string,
  menuOptions: MenuOption[],
  phoneNumber: string,
  useAIFallback: boolean = true
): Promise<DetectionResult> {
  const logger = createConversationLogger(phoneNumber, '', 'menu-option-detection')

  // Capa 1: Keyword matching simple (< 1ms latencia)
  const keywordMatch = detectByKeywords(userMessage, menuOptions)

  // Paso 5b (Refactor, 18/8/2026): umbral subido de 0.60 a 0.90 — con la fórmula de
  // abajo (0.60 base + 0.15 por keyword), 0.60 aceptaba CUALQUIER match de 1 sola
  // keyword (0.75), lo cual en la práctica anulaba el umbral. Caso Felipe, tel.
  // 1161995183, 18/8/2026: "Y el otro ta. Bien" matcheó la keyword "otro" (1 sola
  // coincidencia) y se interpretó como elegir "cancelar y solicitar turno nuevo",
  // sin que el AI Dispatcher llegara a evaluar el mensaje. Ahora se exige 2+
  // keywords (0.90) para aceptar la detección rápida; con 1 sola coincidencia el
  // mensaje pasa a la siguiente capa. Ver PLAN-DE-TRABAJO.md.
  if (keywordMatch.detected && keywordMatch.confidence >= 0.90) {
    logger.info('Menu option detected by keywords', {
      selectedOption: keywordMatch.selectedOption,
      confidence: keywordMatch.confidence,
      message: userMessage.substring(0, 50),
    })
    return keywordMatch
  }

  // Capa 1.5: Match exacto/aproximado contra el texto del botón (< 1ms, gratis)
  const labelMatch = detectByExactOrFuzzyLabel(userMessage, menuOptions)
  if (labelMatch.detected) {
    logger.info('Menu option detected by exact/fuzzy label match', {
      selectedOption: labelMatch.selectedOption,
      confidence: labelMatch.confidence,
      message: userMessage.substring(0, 50),
    })
    return labelMatch
  }

  // Capa 2: Clasificador con GPT-4o-mini (compartido, ver shared/ai-option-classifier.ts)
  // — solo si las capas gratis no resolvieron.
  if (useAIFallback) {
    const aiMatch = await classifyOptionWithAI(
      userMessage,
      menuOptions.map((o) => ({ index: o.index, label: o.label })),
      'El paciente está eligiendo una opción de un menú de bienvenida/intención de contacto.'
    )
    if (aiMatch.detected) {
      logger.info('Menu option detected by AI classifier', {
        selectedOption: aiMatch.selectedOption,
        confidence: aiMatch.confidence,
        message: userMessage.substring(0, 50),
      })
      return aiMatch
    }
  }

  logger.info('Menu option NOT detected', {
    message: userMessage.substring(0, 50),
    confidence: keywordMatch.confidence,
  })

  // No detectado - retornar con confidence 0
  return {
    detected: false,
    confidence: 0,
    reasoning: 'No keywords, label match, or AI classification succeeded',
  }
}

/**
 * Normaliza texto para comparación: minúsculas, sin tildes, sin puntuación,
 * espacios colapsados. "¡Realizar OTRA consulta!" → "realizar otra consulta"
 */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar diacríticos (tildes)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}

/** Distancia de Levenshtein clásica (sin dependencias externas). */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const prevRow = new Array(n + 1)
  const currRow = new Array(n + 1)
  for (let j = 0; j <= n; j++) prevRow[j] = j

  for (let i = 1; i <= m; i++) {
    currRow[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currRow[j] = Math.min(
        prevRow[j] + 1, // eliminación
        currRow[j - 1] + 1, // inserción
        prevRow[j - 1] + cost // sustitución
      )
    }
    for (let j = 0; j <= n; j++) prevRow[j] = currRow[j]
  }

  return prevRow[n]
}

/** Similitud entre 0 (nada parecido) y 1 (idéntico), basada en Levenshtein. */
function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

// Umbral de similitud para aceptar un match aproximado contra el label del botón.
// 0.82 tolera algún typo/variación menor ("realiar otra consulta", "opcion 3 otra
// consulta") sin aceptar textos genuinamente distintos.
const FUZZY_LABEL_THRESHOLD = 0.82

/**
 * Detecta la opción cuando el paciente escribió el texto del botón tal cual
 * (o muy parecido) — típico cuando WhatsApp reenvía el título del botón como
 * texto plano, o el paciente lo copia/tipea a mano.
 */
function detectByExactOrFuzzyLabel(
  userMessage: string,
  menuOptions: MenuOption[]
): DetectionResult {
  const normalizedMessage = normalizeForCompare(userMessage)
  if (!normalizedMessage) {
    return { detected: false, confidence: 0, reasoning: 'Mensaje vacío tras normalizar' }
  }

  let bestMatch: { option: MenuOption; similarity: number } | null = null

  for (const option of menuOptions) {
    const normalizedLabel = normalizeForCompare(option.label)

    // Match exacto (o el mensaje contiene el label completo, ej. "elijo: realizar otra consulta")
    if (normalizedMessage === normalizedLabel || normalizedMessage.includes(normalizedLabel)) {
      return {
        detected: true,
        selectedOption: option.index,
        confidence: 1,
        reasoning: `Texto exacto/contiene el label del botón: "${option.label}"`,
      }
    }

    const similarity = similarityRatio(normalizedMessage, normalizedLabel)
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = { option, similarity }
    }
  }

  if (bestMatch && bestMatch.similarity >= FUZZY_LABEL_THRESHOLD) {
    return {
      detected: true,
      selectedOption: bestMatch.option.index,
      confidence: bestMatch.similarity,
      reasoning: `Texto muy similar al label del botón "${bestMatch.option.label}" (similitud ${bestMatch.similarity.toFixed(2)})`,
    }
  }

  return { detected: false, confidence: 0, reasoning: 'Sin match exacto/aproximado contra ningún label' }
}

/**
 * ¿El mensaje contiene el keyword como palabra/frase completa (no como substring
 * pegado a otras letras)? Evita falsos positivos como "no" matcheando dentro de
 * "turno", "notas", "nosotros", etc. — antes se usaba un `.includes()` plano.
 * Caso real: "1 confirmo el turno para el día 31 de julio..." matcheaba la
 * keyword "no" (de "Cancelar turno médico") por estar contenida en "turNO",
 * disparando erróneamente el flujo de cancelación. Ver PLAN-DE-TRABAJO.md.
 */
function containsKeyword(normalizedMessage: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Bordes "manuales" Unicode-aware: no debe estar pegado a otra letra/número.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
  return re.test(normalizedMessage)
}

/**
 * Detecta opciones usando keyword matching
 * Rápido (< 1ms), altamente confiable
 */
function detectByKeywords(
  userMessage: string,
  menuOptions: MenuOption[]
): DetectionResult {
  const normalizedMessage = userMessage.toLowerCase().trim()

  // Buscar coincidencias de palabras clave
  let bestMatch: { option: MenuOption; matches: number } | null = null

  for (const option of menuOptions) {
    let matches = 0
    for (const keyword of option.keywords) {
      // Palabra/frase completa, no substring pegado (ver containsKeyword arriba).
      if (containsKeyword(normalizedMessage, keyword)) {
        matches++
      }
    }

    if (matches > 0) {
      if (!bestMatch || matches > bestMatch.matches) {
        bestMatch = { option, matches }
      }
    }
  }

  if (bestMatch) {
    // Confianza: base 0.60 + 0.20 por cada keyword matching
    const confidence = Math.min(0.95, 0.60 + bestMatch.matches * 0.15)
    return {
      detected: true,
      selectedOption: bestMatch.option.index,
      confidence,
      reasoning: `Keyword match (${bestMatch.matches} keywords)`,
    }
  }

  return {
    detected: false,
    confidence: 0,
    reasoning: 'No keywords matched',
  }
}
