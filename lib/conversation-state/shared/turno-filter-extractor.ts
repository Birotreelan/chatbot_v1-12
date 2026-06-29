/**
 * Extractor de filtros para la selección de turnos.
 *
 * Cuando el paciente escribe texto libre durante awaiting_turno_selection
 * (ej: "¿podés los jueves o viernes a la tarde?", "segunda semana de julio"),
 * este módulo extrae criterios de filtro estructurados y los aplica sobre
 * el array completo de turnos (sin nuevas llamadas a la API).
 *
 * Capas:
 *   1. Detección de "ver más" / "ver todos" (determinístico — sin IA)
 *   2. Extracción de criterios con GPT-4o-mini
 *   3. Aplicación determinística de los criterios sobre TurnoOption[]
 */

import { openai } from '@/lib/openai'
import type { TurnoOption } from './types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FilterCriteria {
  /** Días de semana aceptados (0=dom … 6=sáb). Vacío = sin restricción. */
  dias: number[]
  /** Preferencia de horario */
  turno: 'mañana' | 'tarde' | null
  /** Hora mínima (inclusive), ej: "14:00" */
  horaDesde: string | null
  /** Hora máxima (inclusive), ej: "18:00" */
  horaHasta: string | null
  /** Fecha mínima YYYY-MM-DD */
  fechaDesde: string | null
  /** Fecha máxima YYYY-MM-DD */
  fechaHasta: string | null
  /** Descripción legible del filtro para mostrar al paciente */
  descripcion: string
}

export type TurnoFilterResult =
  | { type: 'show_more' }                                    // "ver más", siguiente ventana
  | { type: 'show_all' }                                     // "ver todos", volver a lista completa
  | { type: 'filtered'; criteria: FilterCriteria; turnos: TurnoOption[] }
  | { type: 'no_results'; criteria: FilterCriteria }         // filtro válido pero 0 resultados
  | { type: 'not_a_filter' }                                 // no se detectó intención de filtro

// ─── Capa 1: detección determinística de navegación ──────────────────────────

const VER_MAS_PATTERNS = [
  /\bver\s+m[aá]s\b/i,
  /\bm[aá]s\s+turnos?\b/i,
  /\bm[aá]s\s+opciones?\b/i,
  /\bsiguientes?\b/i,
  /\bver\s+m[aá]s\s+turnos?\b/i,
  /\bcargar\s+m[aá]s\b/i,
  /^ver_mas$/i,   // ID del botón interactivo de WhatsApp
]

const VER_TODOS_PATTERNS = [
  /\bver\s+todos\b/i,
  /\btodos\s+los\s+turnos?\b/i,
  /\bvolver\s+a\s+la\s+lista\b/i,
  /\blista\s+completa\b/i,
  /\bquitar\s+filtro\b/i,
  /\bsin\s+filtro\b/i,
]

function detectNavigation(input: string): 'show_more' | 'show_all' | null {
  if (VER_MAS_PATTERNS.some(p => p.test(input))) return 'show_more'
  if (VER_TODOS_PATTERNS.some(p => p.test(input))) return 'show_all'
  return null
}

// ─── Capa 2: extracción de criterios con GPT-4o-mini ─────────────────────────

const DIAS_SEMANA_MAP: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
  jueves: 4, viernes: 5, sabado: 6, sábado: 6,
}

/**
 * Usa GPT-4o-mini para extraer criterios de filtro del texto libre del paciente.
 * Solo se llama cuando la lógica determinística no resolvió el input como selección de turno.
 */
async function extractCriteriaWithGPT(
  userInput: string,
  today: Date = new Date()
): Promise<FilterCriteria | null> {
  const todayStr = today.toISOString().split('T')[0]
  const diasNombres = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const todayName = diasNombres[today.getDay()]

  const systemPrompt = `Sos un asistente que extrae preferencias de horario de pacientes en Argentina.
El paciente está eligiendo un turno médico y escribe una preferencia en texto libre.
Hoy es ${todayName} ${todayStr}.

Extraé las preferencias del mensaje. Respondé SOLO con JSON (sin markdown):

{
  "dias": ["lunes","viernes"],     // días de semana aceptados, array de strings (vacío si no menciona)
  "turno": "tarde",                // "mañana" (antes de 13hs), "tarde" (13hs en adelante), o null
  "horaDesde": "14:00",            // hora mínima exacta si la menciona, null si no
  "horaHasta": "18:00",            // hora máxima exacta si la menciona, null si no
  "fechaDesde": "2026-07-07",      // fecha mínima YYYY-MM-DD si menciona rango/semana/mes, null si no
  "fechaHasta": "2026-07-11",      // fecha máxima YYYY-MM-DD si menciona rango/semana/mes, null si no
  "descripcion": "los lunes y viernes a la tarde",  // descripción legible en español informal
  "esFiltro": true                 // false si el mensaje no tiene ninguna preferencia de horario/día/fecha
}

Ejemplos:
- "¿podés los jueves a la tarde?" → dias:["jueves"], turno:"tarde"
- "segunda semana de julio" → fechaDesde:"2026-07-07", fechaHasta:"2026-07-11"
- "¿tenés para el viernes o sábado a la mañana?" → dias:["viernes","sábado"], turno:"mañana"
- "no tenés para julio, puedo los jueves o viernes a la tarde" → dias:["jueves","viernes"], turno:"tarde"
- "prefiero después de las 15" → horaDesde:"15:00"
- "gracias" → esFiltro:false
- "ok entendido" → esFiltro:false`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed.esFiltro) return null

    // Convertir nombres de días a números
    const diasNums = (parsed.dias as string[] || [])
      .map((d: string) => DIAS_SEMANA_MAP[d.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')])
      .filter((n: number | undefined) => n !== undefined) as number[]

    return {
      dias: diasNums,
      turno: parsed.turno || null,
      horaDesde: parsed.horaDesde || null,
      horaHasta: parsed.horaHasta || null,
      fechaDesde: parsed.fechaDesde || null,
      fechaHasta: parsed.fechaHasta || null,
      descripcion: parsed.descripcion || 'tu preferencia',
    }
  } catch {
    return null
  }
}

// ─── Capa 3: aplicación determinística de criterios ───────────────────────────

function applyFilter(allTurnos: TurnoOption[], criteria: FilterCriteria): TurnoOption[] {
  return allTurnos.filter(t => {
    // Filtro por día de semana
    if (criteria.dias.length > 0) {
      const [y, m, d] = t.fecha.split('-').map(Number)
      const diaSemana = new Date(y, m - 1, d).getDay()
      if (!criteria.dias.includes(diaSemana)) return false
    }

    // Filtro por fecha
    if (criteria.fechaDesde && t.fecha < criteria.fechaDesde) return false
    if (criteria.fechaHasta && t.fecha > criteria.fechaHasta) return false

    // Filtro por turno (mañana/tarde)
    const hora = parseInt(t.hora.split(':')[0], 10)
    if (criteria.turno === 'mañana' && hora >= 13) return false
    if (criteria.turno === 'tarde' && hora < 13) return false

    // Filtro por hora exacta
    if (criteria.horaDesde) {
      const [hd, md] = criteria.horaDesde.split(':').map(Number)
      const [ht, mt] = t.hora.split(':').map(Number)
      if (ht * 60 + mt < hd * 60 + md) return false
    }
    if (criteria.horaHasta) {
      const [hd, md] = criteria.horaHasta.split(':').map(Number)
      const [ht, mt] = t.hora.split(':').map(Number)
      if (ht * 60 + mt > hd * 60 + md) return false
    }

    return true
  })
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Intenta interpretar el texto libre del paciente como un filtro sobre los turnos.
 *
 * Flujo:
 *   1. Detectar "ver más" / "ver todos" determinísticamente.
 *   2. Si no, llamar a GPT-4o-mini para extraer criterios de filtro.
 *   3. Si hay criterios, aplicarlos sobre allTurnos.
 *   4. Si GPT no detecta filtro, retornar 'not_a_filter'.
 */
export async function detectTurnoFilter(
  userInput: string,
  allTurnos: TurnoOption[]
): Promise<TurnoFilterResult> {
  // Paso 1: navegación determinística
  const nav = detectNavigation(userInput)
  if (nav === 'show_more') return { type: 'show_more' }
  if (nav === 'show_all') return { type: 'show_all' }

  // Paso 2: extracción de criterios con GPT
  const criteria = await extractCriteriaWithGPT(userInput)
  if (!criteria) return { type: 'not_a_filter' }

  // Paso 3: aplicar filtro sobre array en memoria
  const filtered = applyFilter(allTurnos, criteria)

  if (filtered.length === 0) {
    return { type: 'no_results', criteria }
  }

  return { type: 'filtered', criteria, turnos: filtered }
}
