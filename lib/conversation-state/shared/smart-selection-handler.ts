/**
 * Smart Selection Handler
 * 
 * Detecta seleccion de opciones de forma inteligente:
 * 1. Match por numero exacto
 * 2. Match por fuzzy matching del texto (normalizacion + similitud)
 * 3. NLU fallback para determinar si es seleccion o consulta diferente
 * 
 * Usado por sede-handler, specialty-handler, professional-handler, turno-selection-handler
 */

import { createConversationLogger } from '../logger'
import { openai } from '@/lib/openai'

// ============================================================================
// TIPOS
// ============================================================================

export interface SelectionOption {
  numero: number
  id: string
  displayText: string  // Texto principal para matching (ej: nombre de sede)
  alternativeTexts?: string[]  // Textos alternativos (ej: localidad, domicilio)
}

export interface SmartSelectionResult {
  matched: boolean
  matchType: 'number' | 'fuzzy' | 'nlu' | 'none'
  selectedOption?: SelectionOption
  confidence: number
  
  // Si no es seleccion, puede ser otra intencion
  isOtherIntent?: boolean
  otherIntentType?: 'consulta' | 'despedida' | 'confirmacion' | 'cancelacion' | 'otro'
  otherIntentResponse?: string
  
  // Mensaje de error si no se puede detectar
  errorMessage?: string
}

// ============================================================================
// UTILIDADES DE NORMALIZACION
// ============================================================================

/**
 * Normaliza texto para comparacion:
 * - Lowercase
 * - Elimina acentos
 * - Elimina caracteres especiales
 * - Elimina espacios multiples
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Elimina acentos
    .replace(/[^a-z0-9\s]/g, ' ')      // Reemplaza especiales por espacio
    .replace(/\s+/g, ' ')              // Espacios multiples a uno
    .trim()
}

/**
 * Extrae palabras significativas (>= 3 caracteres)
 */
function extractKeywords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter(word => word.length >= 3)
}

/**
 * Calcula similitud basica entre dos strings (Dice coefficient simplificado)
 * Retorna valor entre 0 y 1
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeText(str1)
  const s2 = normalizeText(str2)
  
  if (s1 === s2) return 1
  if (s1.length === 0 || s2.length === 0) return 0
  
  // Generar bigramas
  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2))
    }
    return bigrams
  }
  
  const bigrams1 = getBigrams(s1)
  const bigrams2 = getBigrams(s2)
  
  let intersection = 0
  bigrams1.forEach(bigram => {
    if (bigrams2.has(bigram)) intersection++
  })
  
  return (2 * intersection) / (bigrams1.size + bigrams2.size)
}

/**
 * Verifica si el input contiene palabras clave de una opcion
 * Retorna score de coincidencia (0-1)
 */
function matchByKeywords(inputKeywords: string[], optionKeywords: string[]): number {
  if (inputKeywords.length === 0 || optionKeywords.length === 0) return 0
  
  let matches = 0
  let partialMatches = 0
  
  for (const inputWord of inputKeywords) {
    for (const optionWord of optionKeywords) {
      // Match exacto
      if (inputWord === optionWord) {
        matches++
        break
      }
      // Match parcial (una palabra contiene a la otra)
      if (inputWord.length >= 3 && optionWord.length >= 3) {
        if (optionWord.includes(inputWord) || inputWord.includes(optionWord)) {
          partialMatches += 0.7
          break
        }
      }
    }
  }
  
  // Score basado en cuantas palabras del input coinciden
  const totalMatches = matches + partialMatches
  return Math.min(1, totalMatches / inputKeywords.length)
}

// ============================================================================
// FUZZY MATCHING
// ============================================================================

interface FuzzyMatchResult {
  option: SelectionOption
  score: number
  matchedOn: string  // Que texto coincidio
}

/**
 * Intenta matchear el input con las opciones usando fuzzy matching
 */
function fuzzyMatchOptions(
  userInput: string,
  options: SelectionOption[],
  minScore: number = 0.5
): FuzzyMatchResult | null {
  const inputNormalized = normalizeText(userInput)
  const inputKeywords = extractKeywords(userInput)
  
  let bestMatch: FuzzyMatchResult | null = null
  
  for (const option of options) {
    // 1. Match por texto principal
    const mainScore = Math.max(
      calculateSimilarity(userInput, option.displayText),
      matchByKeywords(inputKeywords, extractKeywords(option.displayText))
    )
    
    if (mainScore > (bestMatch?.score || minScore)) {
      bestMatch = {
        option,
        score: mainScore,
        matchedOn: option.displayText,
      }
    }
    
    // 2. Match por textos alternativos
    if (option.alternativeTexts) {
      for (const altText of option.alternativeTexts) {
        const altScore = Math.max(
          calculateSimilarity(userInput, altText),
          matchByKeywords(inputKeywords, extractKeywords(altText))
        )
        
        if (altScore > (bestMatch?.score || minScore)) {
          bestMatch = {
            option,
            score: altScore,
            matchedOn: altText,
          }
        }
      }
    }
    
    // 3. Match si el input esta contenido en alguno de los textos
    const allTexts = [option.displayText, ...(option.alternativeTexts || [])]
    for (const text of allTexts) {
      const textNormalized = normalizeText(text)
      
      // Si el input normalizado esta contenido en el texto
      if (textNormalized.includes(inputNormalized) && inputNormalized.length >= 4) {
        const containScore = 0.8  // Alto score por contencion
        if (containScore > (bestMatch?.score || minScore)) {
          bestMatch = {
            option,
            score: containScore,
            matchedOn: text,
          }
        }
      }
      
      // Si alguna palabra clave del input aparece exacta en el texto
      for (const keyword of inputKeywords) {
        if (keyword.length >= 4 && textNormalized.includes(keyword)) {
          const keywordScore = 0.7
          if (keywordScore > (bestMatch?.score || minScore)) {
            bestMatch = {
              option,
              score: keywordScore,
              matchedOn: text,
            }
          }
        }
      }
    }
  }
  
  return bestMatch
}

// ============================================================================
// NLU FALLBACK
// ============================================================================

interface NLUSelectionResult {
  isSelection: boolean
  selectedOptionNumber?: number
  isOtherIntent: boolean
  otherIntentType?: 'consulta' | 'despedida' | 'confirmacion' | 'cancelacion' | 'otro'
  otherIntentResponse?: string
  confidence: number
  reasoning: string
}

/**
 * Usa NLU (GPT-4o-mini) para determinar si el mensaje es una seleccion de opcion
 */
async function classifyWithNLU(
  userInput: string,
  options: SelectionOption[],
  contextDescription: string
): Promise<NLUSelectionResult> {
  const logger = createConversationLogger('smart-selection', '', 'nlu')
  
  const optionsList = options.map(o => 
    `${o.numero}. ${o.displayText}${o.alternativeTexts ? ` (${o.alternativeTexts.join(', ')})` : ''}`
  ).join('\n')
  
  const systemPrompt = `Eres un clasificador de intenciones para un chatbot de turnos medicos.

El sistema le presento al usuario estas opciones para ${contextDescription}:
${optionsList}

Tu tarea es analizar el mensaje del usuario y determinar:
1. Si el usuario esta intentando seleccionar una de las opciones (aunque con typos o texto parcial)
2. Si el usuario esta haciendo otra consulta diferente (pregunta, comentario, despedida, etc.)

**INSTRUCCIONES:**
- Si el usuario menciona parte del nombre de una opcion (con typos), es una SELECCION
- Si el usuario pregunta algo ("donde queda?", "que horarios tienen?"), es OTRA INTENCION tipo "consulta"
- Si el usuario se despide o agradece, es OTRA INTENCION tipo "despedida"
- Si el usuario confirma o cancela algo, es OTRA INTENCION tipo "confirmacion" o "cancelacion"
- Para CONSULTAS: genera una respuesta breve y util (1-2 oraciones), pero indica que debe seleccionar la opcion para continuar

**SALIDA JSON:**
{
  "isSelection": true/false,
  "selectedOptionNumber": numero de la opcion si es seleccion (null si no),
  "isOtherIntent": true/false,
  "otherIntentType": "consulta" | "despedida" | "confirmacion" | "cancelacion" | "otro" | null,
  "otherIntentResponse": "Respuesta a la consulta + recordatorio de seleccionar opcion" | null,
  "confidence": 0.0-1.0,
  "reasoning": "Explicacion breve"
}`

  const userPrompt = `Mensaje del usuario: "${userInput}"

Analiza y clasifica el mensaje.`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
    })
    
    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      throw new Error('No response from OpenAI')
    }
    
    const parsed = JSON.parse(responseText) as NLUSelectionResult
    logger.info('NLU classification result', parsed)
    return parsed
    
  } catch (error) {
    logger.error('Error in NLU classification', { error })
    return {
      isSelection: false,
      isOtherIntent: false,
      confidence: 0,
      reasoning: 'Error en clasificacion NLU',
    }
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Detecta seleccion de opcion de forma inteligente
 * 
 * @param userInput - Mensaje del usuario
 * @param options - Opciones disponibles
 * @param contextDescription - Descripcion del contexto (ej: "seleccionar sede")
 * @param useNLU - Si usar NLU como fallback (default: true)
 */
export async function detectSmartSelection(
  userInput: string,
  options: SelectionOption[],
  contextDescription: string,
  useNLU: boolean = true
): Promise<SmartSelectionResult> {
  const logger = createConversationLogger('smart-selection', '', 'detect')
  const inputTrimmed = userInput.trim()
  
  logger.info('Detecting selection', { 
    input: inputTrimmed.substring(0, 50), 
    optionsCount: options.length,
    context: contextDescription,
  })
  
  // 1. MATCH POR NUMERO EXACTO
  const numeroMatch = inputTrimmed.match(/^(\d+)$/)
  if (numeroMatch) {
    const numero = parseInt(numeroMatch[1], 10)
    const optionByNumber = options.find(o => o.numero === numero)
    
    if (optionByNumber) {
      logger.info('Matched by number', { numero, option: optionByNumber.displayText })
      return {
        matched: true,
        matchType: 'number',
        selectedOption: optionByNumber,
        confidence: 1.0,
      }
    }
    
    // Numero invalido
    return {
      matched: false,
      matchType: 'none',
      confidence: 0,
      errorMessage: `No existe la opcion ${numero}. Por favor, indica un numero del 1 al ${options.length}.`,
    }
  }
  
  // 2. FUZZY MATCHING
  const fuzzyResult = fuzzyMatchOptions(inputTrimmed, options, 0.5)
  
  if (fuzzyResult && fuzzyResult.score >= 0.6) {
    logger.info('Matched by fuzzy', { 
      score: fuzzyResult.score, 
      option: fuzzyResult.option.displayText,
      matchedOn: fuzzyResult.matchedOn,
    })
    return {
      matched: true,
      matchType: 'fuzzy',
      selectedOption: fuzzyResult.option,
      confidence: fuzzyResult.score,
    }
  }
  
  // 3. NLU FALLBACK
  if (useNLU) {
    logger.info('Using NLU fallback', { input: inputTrimmed })
    const nluResult = await classifyWithNLU(inputTrimmed, options, contextDescription)
    
    // Si NLU detecta seleccion con alta confianza
    if (nluResult.isSelection && nluResult.selectedOptionNumber && nluResult.confidence >= 0.7) {
      const optionByNLU = options.find(o => o.numero === nluResult.selectedOptionNumber)
      if (optionByNLU) {
        logger.info('Matched by NLU', { option: optionByNLU.displayText })
        return {
          matched: true,
          matchType: 'nlu',
          selectedOption: optionByNLU,
          confidence: nluResult.confidence,
        }
      }
    }
    
    // Si NLU detecta otra intencion
    if (nluResult.isOtherIntent && nluResult.confidence >= 0.6) {
      logger.info('Other intent detected by NLU', { 
        type: nluResult.otherIntentType,
        response: nluResult.otherIntentResponse?.substring(0, 50),
      })
      return {
        matched: false,
        matchType: 'none',
        confidence: nluResult.confidence,
        isOtherIntent: true,
        otherIntentType: nluResult.otherIntentType,
        otherIntentResponse: nluResult.otherIntentResponse,
      }
    }
  }
  
  // 4. NO SE PUDO DETECTAR
  logger.info('No match found', { input: inputTrimmed })
  return {
    matched: false,
    matchType: 'none',
    confidence: 0,
    errorMessage: `No logre identificar tu seleccion. Por favor, indica el *numero* de la opcion que prefieras (1-${options.length}).`,
  }
}

// ============================================================================
// HELPERS PARA CONVERTIR TIPOS ESPECIFICOS A SelectionOption
// ============================================================================

/**
 * Convierte SedeOption a SelectionOption
 */
export function sedeToSelectionOption(sede: {
  numero: number
  id: string
  nombre: string
  domicilio?: string
  localidad?: string
  provincia?: string
}): SelectionOption {
  const alternativeTexts: string[] = []
  
  if (sede.localidad) alternativeTexts.push(sede.localidad)
  if (sede.domicilio) alternativeTexts.push(sede.domicilio)
  if (sede.provincia) alternativeTexts.push(sede.provincia)
  
  // Combinar localidad y nombre para mejor matching
  if (sede.localidad) {
    alternativeTexts.push(`${sede.nombre} ${sede.localidad}`)
  }
  
  return {
    numero: sede.numero,
    id: sede.id,
    displayText: sede.nombre,
    alternativeTexts: alternativeTexts.length > 0 ? alternativeTexts : undefined,
  }
}

/**
 * Convierte SpecialtyOption a SelectionOption
 */
export function specialtyToSelectionOption(specialty: {
  numero: number
  id: string
  nombre: string
}): SelectionOption {
  return {
    numero: specialty.numero,
    id: specialty.id,
    displayText: specialty.nombre,
  }
}

/**
 * Convierte ProfessionalOption a SelectionOption
 */
export function professionalToSelectionOption(professional: {
  numero: number
  id: string
  nombre: string
  especialidad?: string
}): SelectionOption {
  return {
    numero: professional.numero,
    id: professional.id,
    displayText: professional.nombre,
    alternativeTexts: professional.especialidad ? [professional.especialidad] : undefined,
  }
}

/**
 * Convierte TurnoOption a SelectionOption
 */
export function turnoToSelectionOption(turno: {
  numero: number
  id: string
  fecha: string
  hora: string
  profesionalNombre: string
  sedeNombre?: string
}): SelectionOption {
  const displayText = `${turno.fecha} ${turno.hora} - ${turno.profesionalNombre}`
  const alternativeTexts: string[] = [
    turno.fecha,
    turno.hora,
    turno.profesionalNombre,
  ]
  
  if (turno.sedeNombre) {
    alternativeTexts.push(turno.sedeNombre)
  }
  
  return {
    numero: turno.numero,
    id: turno.id,
    displayText,
    alternativeTexts,
  }
}
