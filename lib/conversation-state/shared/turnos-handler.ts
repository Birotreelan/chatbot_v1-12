/**
 * Handler compartido para búsqueda y presentación de turnos.
 *
 * Estrategia:
 * - Búsqueda única a 60 días (una sola llamada a la API).
 * - Los turnos se numeran 1..N de forma permanente durante toda la conversación.
 * - Los mensajes muestran ventanas de 15 días con paginación autoincremental.
 * - Los filtros operan sobre el array completo en memoria (sin nuevas llamadas a la API).
 */

import { createConversationLogger } from '../logger'
import { obtenerTurnos } from '../../api-tools/api-functions'
import type { TurnoOption, HandlerResult } from './types'

// ─── Constantes ──────────────────────────────────────────────────────────────

export const SEARCH_DAYS = 60
export const WINDOW_DAYS = 15

// ─── Helpers de fecha ────────────────────────────────────────────────────────

function formatDateForApi(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateForDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${dias[date.getDay()]} ${parseInt(day)} de ${meses[parseInt(month) - 1]}`
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return formatDateForApi(date)
}

// ─── Búsqueda ─────────────────────────────────────────────────────────────────

/**
 * Busca todos los turnos disponibles en los próximos 60 días.
 * Un único llamado a la API. Los turnos se numeran desde `startNumber`.
 */
export async function searchTurnosFull(
  clientId: string,
  params: {
    sedeId: string
    pacienteDNI?: string
    obraSocialId?: string
    profesionalId?: string
    especialidadId?: string
  },
  phoneNumber: string,
  startNumber: number = 1
): Promise<{
  success: boolean
  turnos?: TurnoOption[]
  infoSinTurnos?: any
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turnos_search_full')

  const today = new Date()
  const fechaDesde = formatDateForApi(today)
  const fechaHasta = formatDateForApi(new Date(today.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000))

  logger.info('Buscando turnos (60 días)', { fechaDesde, fechaHasta })

  try {
    const result = await obtenerTurnos(
      clientId,
      fechaDesde,
      fechaHasta,
      params.profesionalId,
      params.pacienteDNI,
      false,
      params.sedeId,
      params.especialidadId,
      params.obraSocialId
    )

    let infoSinTurnos: any = undefined
    if (result.info_sin_turnos) infoSinTurnos = result.info_sin_turnos
    else if (result.datos?.info_sin_turnos) infoSinTurnos = result.datos.info_sin_turnos

    if (!result.exito || !result.datos) {
      return { success: false, infoSinTurnos, error: 'Error en la API de turnos' }
    }

    // Extraer array plano de turnos (la API puede devolver distintas estructuras)
    let turnosRaw: any[] = []
    if (Array.isArray(result.datos)) {
      const firstItem = result.datos[0]
      if (firstItem?.turnos && Array.isArray(firstItem.turnos)) {
        result.datos.forEach((grupo: any) => { if (grupo.turnos) turnosRaw.push(...grupo.turnos) })
      } else {
        turnosRaw = result.datos
      }
    } else if (result.datos.turnos_disponibles) {
      const tpf = result.datos.turnos_disponibles
      if (Array.isArray(tpf)) {
        tpf.forEach((grupo: any) => {
          if (grupo.turnos && Array.isArray(grupo.turnos)) turnosRaw.push(...grupo.turnos)
          else if (grupo.Id || grupo.Hora) turnosRaw.push(grupo)
        })
      }
    } else if (result.datos.turnos) {
      turnosRaw = result.datos.turnos
    }

    if (turnosRaw.length === 0) {
      return { success: false, infoSinTurnos, error: 'No se encontraron turnos disponibles en los próximos 60 días' }
    }

    // Mapear al formato interno con numeración permanente
    const turnos: TurnoOption[] = turnosRaw.map((turno: any, index: number) => ({
      numero: startNumber + index,
      id: turno.Id || turno.Agenda_Id || turno.id || turno.agenda_id || '',
      fecha: turno.Fecha || turno.fecha || '',
      hora: (turno.Hora || turno.hora || turno.Hora_Turno || 'N/A').toString().trim().substring(0, 5),
      profesionalId: turno.Profesional_Id || turno.profesional_id || turno.ProfesionalId || '',
      profesionalNombre: (
        turno.Profesional_Nombre || turno.profesional_nombre || turno.Profesional ||
        turno.profesional || turno.nombre_profesional || turno.NombreProfesional || 'Sin asignar'
      ).toString().trim(),
      especialidad: turno.Especialidad || turno.especialidad || turno.Subespecialidad,
      sedeId: turno.Sede_Id || turno.sede_id || params.sedeId,
      sedeNombre: turno.Sede_Nombre || turno.sede_nombre || turno.Centro_Nombre,
      duracion: turno.Duracion || turno.duracion,
    }))

    logger.info('Turnos encontrados', { total: turnos.length, fechaDesde, fechaHasta })
    return { success: true, turnos, infoSinTurnos }
  } catch (error) {
    logger.error('Error buscando turnos', error instanceof Error ? error : new Error(String(error)))
    return { success: false, error: String(error) }
  }
}

// ─── Paginación ───────────────────────────────────────────────────────────────

export interface TurnosWindowResult {
  /** Turnos a mostrar en esta ventana */
  turnos: TurnoOption[]
  /** Total de turnos mostrados acumulados tras esta ventana */
  newShownCount: number
  /** Si quedan turnos por mostrar en ventanas futuras */
  hasMore: boolean
}

/**
 * Extrae la próxima ventana de WINDOW_DAYS días a partir del offset actual.
 * Si no hay turnos en los próximos WINDOW_DAYS desde hoy, toma desde la primera fecha disponible.
 */
export function getNextWindow(allTurnos: TurnoOption[], turnosMostrados: number): TurnosWindowResult {
  const remaining = allTurnos.slice(turnosMostrados)
  if (remaining.length === 0) {
    return { turnos: [], newShownCount: turnosMostrados, hasMore: false }
  }

  const windowStart = remaining[0].fecha
  const windowEnd = addDaysToDateStr(windowStart, WINDOW_DAYS - 1)

  const inWindow = remaining.filter(t => t.fecha >= windowStart && t.fecha <= windowEnd)
  const hasMore = remaining.length > inWindow.length

  return {
    turnos: inWindow,
    newShownCount: turnosMostrados + inWindow.length,
    hasMore,
  }
}

// ─── Builders de mensajes ─────────────────────────────────────────────────────

/**
 * Construye el mensaje de una ventana de turnos con paginación.
 *
 * @param windowTurnos   - Turnos a mostrar en esta ventana
 * @param totalFound     - Total de turnos encontrados en 60 días
 * @param hasMore        - Si hay más turnos para mostrar
 * @param patientName    - Nombre del paciente (para el encabezado de la primera ventana)
 * @param sedeName       - Nombre de la sede
 * @param profesionalNombre - Profesional fijo (si aplica); si es null/undefined se muestra en cada línea
 * @param isFirstWindow  - Si es la primera ventana (incluye encabezado con totales)
 */
export function buildTurnosWindowMessage(
  windowTurnos: TurnoOption[],
  totalFound: number,
  hasMore: boolean,
  patientName?: string,
  sedeName?: string,
  profesionalNombre?: string,
  isFirstWindow: boolean = true
): string {
  let message = ''

  if (isFirstWindow) {
    const primerNombre = patientName ? patientName.split(' ')[0] : null
    if (primerNombre) message += `${primerNombre}, `
    message += `encontré *${totalFound} turno${totalFound !== 1 ? 's' : ''}* disponible${totalFound !== 1 ? 's' : ''} para los próximos ${SEARCH_DAYS} días`
    if (profesionalNombre) message += ` con *${profesionalNombre}*`
    if (sedeName) message += ` en *${sedeName}*`
    message += `. Te mostraré los turnos más próximos a la fecha actual:\n\n`
  }

  // Agrupar por fecha
  const porFecha: Record<string, TurnoOption[]> = {}
  windowTurnos.forEach(t => {
    if (!porFecha[t.fecha]) porFecha[t.fecha] = []
    porFecha[t.fecha].push(t)
  })

  Object.entries(porFecha).forEach(([fecha, turnos]) => {
    const fechaFmt = formatDateForDisplay(fecha)
    message += `*${fechaFmt.charAt(0).toUpperCase() + fechaFmt.slice(1)}*\n`
    turnos.forEach(t => {
      const hora = t.hora && t.hora !== 'N/A' ? t.hora : 'Horario a confirmar'
      // Mostrar profesional por turno cuando no hay un profesional fijo (cualquier médico / especialidad)
      const profLine = profesionalNombre ? '' : ` - ${t.profesionalNombre}`
      message += `  ${t.numero}. ${hora}${profLine}\n`
    })
    message += '\n'
  })

  if (hasMore) {
    message += `Respondé con el *número* del turno que preferís o presioná el botón *Ver más* para ver los turnos disponibles en las fechas siguientes.`
  } else {
    message += `Respondé con el *número* del turno que preferís.\n\n_Esos son todos los turnos disponibles en los próximos ${SEARCH_DAYS} días._`
  }

  return message
}

/**
 * Construye el mensaje de turnos filtrados conservando la numeración original.
 * El paciente puede seleccionar por número aunque no haya "visto" esos turnos en la paginación.
 */
export function buildTurnosFilteredMessage(
  filteredTurnos: TurnoOption[],
  filterDesc: string,
  totalDisponibles: number,
  profesionalNombre?: string
): string {
  if (filteredTurnos.length === 0) {
    return (
      `No encontré turnos disponibles para *${filterDesc}* en los próximos ${SEARCH_DAYS} días.\n\n` +
      `Podés ajustar tu preferencia o elegir un número de la lista. ` +
      `Escribí *"ver más"* para continuar viendo los turnos disponibles.`
    )
  }

  let message = `Encontré *${filteredTurnos.length} turno${filteredTurnos.length !== 1 ? 's' : ''}* para *${filterDesc}*:\n\n`

  const porFecha: Record<string, TurnoOption[]> = {}
  filteredTurnos.forEach(t => {
    if (!porFecha[t.fecha]) porFecha[t.fecha] = []
    porFecha[t.fecha].push(t)
  })

  Object.entries(porFecha).forEach(([fecha, turnos]) => {
    const fechaFmt = formatDateForDisplay(fecha)
    message += `*${fechaFmt.charAt(0).toUpperCase() + fechaFmt.slice(1)}*\n`
    turnos.forEach(t => {
      const hora = t.hora && t.hora !== 'N/A' ? t.hora : 'Horario a confirmar'
      const profLine = profesionalNombre ? '' : ` - ${t.profesionalNombre}`
      message += `  ${t.numero}. ${hora}${profLine}\n`
    })
    message += '\n'
  })

  message += `Respondé con el *número* del turno que preferís.`
  if (totalDisponibles > filteredTurnos.length) {
    message += `\n\nEscribí *"ver todos"* para volver a la lista completa.`
  }

  return message
}

/**
 * Mensaje cuando no hay turnos disponibles.
 * Versiones diferentes según el tipo de búsqueda.
 */
export function buildNoTurnosMessage(
  sedeName?: string,
  profesionalName?: string,
  especialidadName?: string,
  searchType?: string,
  infoSinTurnos?: any,
  escalationPhoneNumber?: string,
  obraSocialNombre?: string
): string {
  let message = ''

  if (searchType === 'cualquier_medico' && infoSinTurnos?.profesionales_disponibles_solo_telefono?.length > 0) {
    message += `No encontré turnos disponibles para agendar online en *${sedeName || 'esta sede'}*.\n\n`
    message += `Sin embargo, hay profesionales con turnos disponibles para tu obra social que solo se pueden reservar por teléfono.\n\n`
    message += `Para agendar tu turno, comunicate directamente con la clínica`
    if (escalationPhoneNumber) message += ` al: *${escalationPhoneNumber}*`
    message += `.`
    return message
  }

  message += 'No encontré turnos disponibles'
  if (profesionalName) message += ` con *${profesionalName}*`
  if (especialidadName) message += ` en *${especialidadName}*`
  if (sedeName) message += ` en *${sedeName}*`
  if (obraSocialNombre) message += ` para tu obra social *${obraSocialNombre}*`
  message += ` en los próximos ${SEARCH_DAYS} días.\n\n`
  message += 'Podés intentar con otra búsqueda:\n\n'
  message += '1. *Médico en particular* - Buscar con otro profesional\n'
  message += '2. *Por especialidad* - Buscar en otra especialidad\n'
  message += '3. *Cualquier médico disponible* - Ver turnos más próximos\n'
  message += '4. *Buscar en otra sede* - Elegir una sede distinta\n\n'
  message += 'Respondé con el *número* de la opción que preferís.'

  return message
}

/**
 * @deprecated Usar buildTurnosWindowMessage + getNextWindow.
 * Se mantiene para compatibilidad con referencias existentes que se migrarán progresivamente.
 */
export function buildTurnosListMessage(
  turnos: TurnoOption[],
  patientName?: string,
  sedeName?: string,
  profesionalNombre?: string,
  rangoUtilizado?: number
): string {
  return buildTurnosWindowMessage(turnos, turnos.length, false, patientName, sedeName, profesionalNombre, true)
}

/**
 * @deprecated Usar searchTurnosFull.
 */
export async function searchTurnosAcumulativo(
  clientId: string,
  params: {
    sedeId: string
    pacienteDNI?: string
    obraSocialId?: string
    profesionalId?: string
    especialidadId?: string
  },
  phoneNumber: string
): Promise<{
  success: boolean
  turnos?: TurnoOption[]
  rangoUtilizado?: number
  infoSinTurnos?: any
  error?: string
}> {
  const result = await searchTurnosFull(clientId, params, phoneNumber)
  return { ...result, rangoUtilizado: SEARCH_DAYS }
}
