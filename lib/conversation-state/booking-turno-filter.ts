/**
 * Booking Turno Filter
 *
 * Maneja mensajes de texto libre durante awaiting_turno_selection en el booking flow.
 * Capas (en orden de prioridad):
 *   1. Filtro determinístico: día de semana, horario, profesional
 *   2. Extracción de fechas para nueva búsqueda (gpt-4o-mini)
 *   3. Construcción de mensajes de lista filtrada
 *   4. Mapeo de respuesta de API a TurnoOption[]
 */

import { openai } from '@/lib/openai'
import type { TurnoOption } from './booking-flow-handler'

// ============================================================================
// TIPOS
// ============================================================================

export type FilterResult =
  | { type: 'filtered'; turnos: TurnoOption[]; filterDesc: string; originalCount: number }
  | { type: 'no_results'; filterDesc: string }
  | { type: 'not_a_filter' }

export interface NewSearchDates {
  fechaDesde: string    // YYYY-MM-DD
  fechaHasta: string    // YYYY-MM-DD
  description: string   // "el viernes", "la próxima semana", etc.
}

// ============================================================================
// NORMALIZACIÓN
// ============================================================================

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ============================================================================
// DETECCIÓN DE FILTROS (DETERMINÍSTICO)
// ============================================================================

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
}

const DIAS_NOMBRES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * Detecta si el mensaje contiene un nombre de día de semana.
 * Retorna el número de día (0=Dom … 6=Sáb) o null.
 */
function extractDayFilter(message: string): number | null {
  const n = norm(message)
  for (const [dia, num] of Object.entries(DIAS_SEMANA)) {
    if (new RegExp(`\\b${dia}\\b`).test(n)) return num
  }
  return null
}

/**
 * Detecta preferencia de horario.
 * Retorna { pref: 'morning'|'afternoon' } o { afterHour: N } o null.
 */
type TimeFilter =
  | { pref: 'morning' | 'afternoon' }
  | { afterHour: number }

function extractTimeFilter(message: string): TimeFilter | null {
  const n = norm(message)

  if (/a la manana|por la manana|temprano|matutino/.test(n)) return { pref: 'morning' }
  if (/a la tarde|por la tarde/.test(n)) return { pref: 'afternoon' }

  // "después de las X", "a partir de las X", "desde las X"
  const m = n.match(/(?:despues de las?|a partir de las?|desde las?)\s+(\d{1,2})/)
  if (m) return { afterHour: parseInt(m[1], 10) }

  return null
}

/**
 * Detecta si el mensaje menciona un nombre de profesional que existe en la lista.
 * Retorna el keyword encontrado o null.
 */
function extractProfFilter(message: string, turnos: TurnoOption[]): string | null {
  const n = norm(message)
  const profesionales = [...new Set(turnos.map(t => t.profesionalNombre))]

  for (const prof of profesionales) {
    const parts = norm(prof).split(/[\s,]+/).filter(p => p.length >= 3)
    for (const part of parts) {
      if (new RegExp(`\\b${part}\\b`).test(n)) return part
    }
  }
  return null
}

/**
 * Determina si el mensaje es una pregunta de disponibilidad (filtro)
 * y no solo una referencia a un día/hora como criterio de selección directa.
 */
function isAvailabilityQuestion(message: string): boolean {
  const n = norm(message)
  return /hay|tiene|disponible|\?|¿|para el|para la|los |alguno|algun|existe|quedan?/.test(n)
}

// ============================================================================
// APLICACIÓN DE FILTROS
// ============================================================================

function filterByDay(turnos: TurnoOption[], dayNum: number): TurnoOption[] {
  return turnos.filter(t => {
    const [y, m, d] = t.fecha.split('-').map(Number)
    return new Date(y, m - 1, d).getDay() === dayNum
  })
}

function filterByTimePref(turnos: TurnoOption[], pref: 'morning' | 'afternoon'): TurnoOption[] {
  return turnos.filter(t => {
    const h = parseInt(t.hora.split(':')[0], 10)
    return pref === 'morning' ? h < 12 : h >= 12
  })
}

function filterByAfterHour(turnos: TurnoOption[], hour: number): TurnoOption[] {
  return turnos.filter(t => parseInt(t.hora.split(':')[0], 10) >= hour)
}

function filterByProfKeyword(turnos: TurnoOption[], keyword: string): TurnoOption[] {
  return turnos.filter(t => norm(t.profesionalNombre).includes(keyword))
}

function renumber(turnos: TurnoOption[]): TurnoOption[] {
  return turnos.map((t, i) => ({ ...t, numero: i + 1 }))
}

// ============================================================================
// FUNCIÓN PRINCIPAL DE FILTRO
// ============================================================================

/**
 * Intenta detectar y aplicar un filtro de día/horario/profesional al mensaje del usuario.
 * Retorna:
 *   - 'filtered': lista filtrada y re-numerada
 *   - 'no_results': había filtro pero no hay turnos que lo cumplan
 *   - 'not_a_filter': no se detectó ningún filtro → dejar que otro handler lo resuelva
 */
export function detectAndApplyFilter(
  message: string,
  turnoOptions: TurnoOption[]
): FilterResult {
  const dayNum = extractDayFilter(message)
  const timeFilter = extractTimeFilter(message)
  const profKeyword = extractProfFilter(message, turnoOptions)

  // Sin señales de filtro → no aplicar
  if (dayNum === null && timeFilter === null && profKeyword === null) {
    return { type: 'not_a_filter' }
  }

  // Si solo hay día mencionado SIN pregunta, puede ser selección directa → dejar pasar
  if (dayNum !== null && timeFilter === null && profKeyword === null) {
    if (!isAvailabilityQuestion(message)) {
      return { type: 'not_a_filter' }
    }
  }

  // Aplicar filtros en cascada
  let filtered = [...turnoOptions]
  const parts: string[] = []

  if (dayNum !== null) {
    filtered = filterByDay(filtered, dayNum)
    parts.push(`el ${DIAS_NOMBRES_ES[dayNum].toLowerCase()}`)
  }

  if (timeFilter) {
    if ('pref' in timeFilter) {
      filtered = filterByTimePref(filtered, timeFilter.pref)
      parts.push(timeFilter.pref === 'morning' ? 'a la mañana' : 'a la tarde')
    } else {
      filtered = filterByAfterHour(filtered, timeFilter.afterHour)
      parts.push(`después de las ${timeFilter.afterHour}:00`)
    }
  }

  if (profKeyword) {
    filtered = filterByProfKeyword(filtered, profKeyword)
    // Encontrar nombre display del prof
    const profDisplay = turnoOptions.find(t => norm(t.profesionalNombre).includes(profKeyword))?.profesionalNombre
    parts.push(`con ${profDisplay || profKeyword}`)
  }

  const filterDesc = parts.join(' ')

  if (filtered.length === 0) {
    return { type: 'no_results', filterDesc }
  }

  return {
    type: 'filtered',
    turnos: renumber(filtered),
    filterDesc,
    originalCount: turnoOptions.length,
  }
}

// ============================================================================
// EXTRACCIÓN DE FECHAS PARA NUEVA BÚSQUEDA (GPT-4o-mini)
// ============================================================================

/**
 * Usa gpt-4o-mini para extraer un rango de fechas del mensaje.
 * Se usa cuando el usuario pide turnos en fechas fuera de la lista actual.
 */
export async function extractNewSearchDates(
  message: string,
  today: Date = new Date()
): Promise<NewSearchDates | null> {
  const todayStr = today.toISOString().split('T')[0]
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const todayName = dias[today.getDay()]

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Sos un asistente que extrae rangos de fechas de mensajes en español de Argentina.
Hoy es ${todayName} ${todayStr}.

El usuario está buscando turnos médicos FUERA de la lista actual (próximos 14 días).
Extraé el rango de fechas que pide. Máximo 14 días por rango.

Reglas:
- "el viernes" = próximo viernes que no esté en la lista actual
- "la próxima semana" = lunes a domingo de la semana siguiente
- "el mes que viene" = primero al último del mes siguiente
- "en julio" = 1 al 31 de julio del año actual o siguiente
- Si la intención no es buscar en fechas concretas → null

Respondé SOLO con JSON (sin markdown):
{"fechaDesde":"YYYY-MM-DD","fechaHasta":"YYYY-MM-DD","description":"texto breve"}
Si no aplica: {"fechaDesde":null,"fechaHasta":null,"description":null}`,
        },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 80,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) return null

    const parsed = JSON.parse(raw) as { fechaDesde: string | null; fechaHasta: string | null; description: string | null }
    if (!parsed.fechaDesde || !parsed.fechaHasta) return null

    return {
      fechaDesde: parsed.fechaDesde,
      fechaHasta: parsed.fechaHasta,
      description: parsed.description || 'las fechas solicitadas',
    }
  } catch {
    return null
  }
}

// ============================================================================
// BUILDER: LISTA FILTRADA
// ============================================================================

/**
 * Construye el mensaje de lista de turnos filtrados para mostrar al usuario.
 */
export function buildFilteredTurnoListMessage(
  turnos: TurnoOption[],
  filterDesc: string,
  originalCount: number,
  clinicName?: string
): string {
  const byDate: Record<string, TurnoOption[]> = {}
  for (const t of turnos) {
    if (!byDate[t.fecha]) byDate[t.fecha] = []
    byDate[t.fecha].push(t)
  }

  const clinicaStr = clinicName ? ` en *${clinicName}*` : ''
  let msg = `Encontré ${turnos.length} turno${turnos.length !== 1 ? 's' : ''}${clinicaStr} para ${filterDesc}:\n\n`

  for (const [fecha, dayTurnos] of Object.entries(byDate)) {
    const [y, mo, d] = fecha.split('-').map(Number)
    const date = new Date(y, mo - 1, d)
    const fechaStr = `${DIAS_NOMBRES_ES[date.getDay()]} ${d} de ${MESES_ES[mo - 1]}`
    msg += `*${fechaStr}*\n`
    for (const t of dayTurnos) {
      const hora = t.horaFormateada || t.hora.substring(0, 5)
      msg += ` ${t.numero}. ${hora} - ${t.profesionalNombre}\n`
    }
    msg += '\n'
  }

  msg += `Respondé con el *número* del turno que preferís.\n\n`
  if (turnos.length < originalCount) {
    msg += `_Para ver todos los ${originalCount} turnos disponibles escribí "ver todos"_\n\n`
  }
  msg += `0. *Volver al paso anterior*`

  return msg
}

/**
 * Construye el mensaje cuando no hay turnos para el filtro solicitado.
 * Re-muestra la lista original para que el usuario pueda elegir.
 */
export function buildNoFilterResultsMessage(
  filterDesc: string,
  originalTurnos: TurnoOption[],
  clinicName?: string
): string {
  const clinicaStr = clinicName ? ` en *${clinicName}*` : ''
  let msg = `No encontré turnos${clinicaStr} para ${filterDesc} en la lista actual.\n\n`

  // Re-mostrar lista original
  const byDate: Record<string, TurnoOption[]> = {}
  for (const t of originalTurnos) {
    if (!byDate[t.fecha]) byDate[t.fecha] = []
    byDate[t.fecha].push(t)
  }

  for (const [fecha, dayTurnos] of Object.entries(byDate)) {
    const [y, mo, d] = fecha.split('-').map(Number)
    const date = new Date(y, mo - 1, d)
    const fechaStr = `${DIAS_NOMBRES_ES[date.getDay()]} ${d} de ${MESES_ES[mo - 1]}`
    msg += `*${fechaStr}*\n`
    for (const t of dayTurnos) {
      const hora = t.horaFormateada || t.hora.substring(0, 5)
      msg += ` ${t.numero}. ${hora} - ${t.profesionalNombre}\n`
    }
    msg += '\n'
  }

  const opcionExtra = originalTurnos.length + 1
  msg += `*${opcionExtra}. Buscar más turnos*\n\n`
  msg += `Respondé con el *número* de la opción que preferís.\n\n`
  msg += `0. *Volver al paso anterior*`

  return msg
}

/**
 * Construye mensaje para nueva búsqueda por fechas.
 */
export function buildNewDateSearchTurnoListMessage(
  turnos: TurnoOption[],
  description: string,
  clinicName?: string
): string {
  if (turnos.length === 0) {
    return `No encontré turnos disponibles para ${description}. ¿Querés buscar en otras fechas o volver a las opciones anteriores?\n\n0. *Volver al paso anterior*`
  }

  const clinicaStr = clinicName ? ` en *${clinicName}*` : ''
  const byDate: Record<string, TurnoOption[]> = {}
  for (const t of turnos) {
    if (!byDate[t.fecha]) byDate[t.fecha] = []
    byDate[t.fecha].push(t)
  }

  let msg = `Encontré ${turnos.length} turno${turnos.length !== 1 ? 's' : ''}${clinicaStr} para ${description}:\n\n`

  for (const [fecha, dayTurnos] of Object.entries(byDate)) {
    const [y, mo, d] = fecha.split('-').map(Number)
    const date = new Date(y, mo - 1, d)
    const fechaStr = `${DIAS_NOMBRES_ES[date.getDay()]} ${d} de ${MESES_ES[mo - 1]}`
    msg += `*${fechaStr}*\n`
    for (const t of dayTurnos) {
      const hora = t.horaFormateada || t.hora.substring(0, 5)
      msg += ` ${t.numero}. ${hora} - ${t.profesionalNombre}\n`
    }
    msg += '\n'
  }

  msg += `Respondé con el *número* del turno que preferís.\n\n`
  msg += `0. *Volver al paso anterior*`

  return msg
}

// ============================================================================
// MAPEO: API → TurnoOption[]
// ============================================================================

/**
 * Convierte la respuesta cruda de get_turnos (array de grupos por fecha) a TurnoOption[].
 * Compatible con el formato que usa el OpenAI assistant.
 */
export function mapApiTurnosToOptions(rawResponse: any): TurnoOption[] {
  const options: TurnoOption[] = []
  let counter = 1

  // La API puede devolver:
  //   { turnos_disponibles: [ { fecha, turnos: [...] }, ... ] }  ← grouped
  //   [ { Id, Fecha, Hora, ... }, ... ]                          ← flat array

  let rawTurnos: any[] = []

  if (Array.isArray(rawResponse)) {
    // Puede ser flat array o grouped array
    if (rawResponse.length > 0 && rawResponse[0].turnos) {
      // Grouped: [ { fecha, turnos: [...] } ]
      for (const group of rawResponse) {
        rawTurnos.push(...(group.turnos || []))
      }
    } else {
      rawTurnos = rawResponse
    }
  } else if (rawResponse?.turnos_disponibles) {
    for (const group of rawResponse.turnos_disponibles) {
      rawTurnos.push(...(group.turnos || []))
    }
  }

  for (const t of rawTurnos) {
    const fecha = t.Fecha || t.fecha || ''
    const hora = t.Hora || t.hora || ''

    if (!fecha || !hora) continue

    // Formatear fecha: "2026-06-25" → "jueves 25 de junio de 2026"
    let fechaFormateada = fecha
    try {
      const [y, mo, d] = fecha.split('-').map(Number)
      const date = new Date(y, mo - 1, d)
      const diasFull = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
      fechaFormateada = `${diasFull[date.getDay()]} ${d} de ${MESES_ES[mo - 1]} de ${y}`
    } catch { /* use raw if parse fails */ }

    options.push({
      numero: counter++,
      idTurno: t.Id || t.id || '',
      fecha,
      hora,
      fechaFormateada,
      horaFormateada: hora.substring(0, 5),
      profesionalNombre: t.Profesional_Nombre || t.profesional_nombre || '',
      sedeNombre: t.Sede_Nombre || t.sede_nombre || '',
      profesionalId: t.Profesional_Id || t.profesional_id,
    })
  }

  return options
}
