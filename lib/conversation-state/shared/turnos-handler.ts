/**
 * Handler compartido para busqueda acumulativa de turnos
 * Implementa la logica de rangos expandibles: 7, 14, 21, 28, 35, 42, 49, 56, 60 dias
 */

import { createConversationLogger } from '../logger'
import { obtenerTurnos } from '../../api-tools/api-functions'
import type { TurnoOption, HandlerResult } from './types'
import { TURNOS_SEARCH_RANGES, MIN_TURNOS_TO_SHOW } from './types'

/**
 * Formatea fecha para la API (YYYY-MM-DD)
 */
function formatDateForApi(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Formatea fecha para mostrar al usuario (formato argentino)
 */
function formatDateForDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  
  return `${diasSemana[date.getDay()]} ${parseInt(day)} de ${meses[date.getMonth()]}`
}

/**
 * Busca turnos de forma acumulativa expandiendo rangos
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
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turnos_search')

  const today = new Date()
  let allTurnos: TurnoOption[] = []
  let rangoUtilizado = 0

  // Iterar por rangos hasta encontrar suficientes turnos
  for (const dias of TURNOS_SEARCH_RANGES) {
    const fechaDesde = formatDateForApi(today)
    const fechaHasta = formatDateForApi(new Date(today.getTime() + dias * 24 * 60 * 60 * 1000))

    logger.info('Buscando turnos en rango', { dias, fechaDesde, fechaHasta })

    try {
      const result = await obtenerTurnos(
        clientId,
        fechaDesde,
        fechaHasta,
        params.profesionalId,
        params.pacienteDNI,
        false, // No cachear
        params.sedeId,
        params.especialidadId,
        params.obraSocialId
      )

      if (result.exito && result.datos) {
        // Procesar turnos recibidos
        // La API devuelve: { turnos_disponibles: [{ fecha: "...", turnos: [...] }, ...] }
        // O puede devolver directamente un array de turnos
        let turnosRaw: any[] = []
        
        if (Array.isArray(result.datos)) {
          // Respuesta directa como array
          turnosRaw = result.datos
        } else if (result.datos.turnos_disponibles) {
          // Respuesta agrupada por fecha: extraer todos los turnos
          const turnosPorFecha = result.datos.turnos_disponibles
          if (Array.isArray(turnosPorFecha)) {
            turnosPorFecha.forEach((grupo: any) => {
              // Cada grupo tiene { fecha: "...", turnos: [...] }
              if (grupo.turnos && Array.isArray(grupo.turnos)) {
                turnosRaw.push(...grupo.turnos)
              } else if (grupo.Id || grupo.Hora) {
                // El grupo mismo es un turno
                turnosRaw.push(grupo)
              }
            })
          }
        } else if (result.datos.turnos) {
          turnosRaw = result.datos.turnos
        }

        // Mapear turnos al formato interno
        // Los campos de la API vienen en PascalCase: Id, Fecha, Hora, Profesional_Nombre, etc.
        allTurnos = turnosRaw.map((turno: any, index: number) => ({
          numero: index + 1,
          id: turno.Id || turno.Agenda_Id || turno.id,
          fecha: turno.Fecha || turno.fecha,
          hora: turno.Hora || turno.hora,
          profesionalId: turno.Profesional_Id || turno.profesional_id,
          profesionalNombre: turno.Profesional_Nombre || turno.profesional_nombre || turno.Profesional || 'Sin asignar',
          especialidad: turno.Especialidad || turno.especialidad,
          sedeId: turno.Sede_Id || turno.sede_id || params.sedeId,
          sedeNombre: turno.Sede_Nombre || turno.sede_nombre,
          duracion: turno.Duracion || turno.duracion,
        }))

        rangoUtilizado = dias

        // Si tenemos suficientes turnos, terminar
        if (allTurnos.length >= MIN_TURNOS_TO_SHOW) {
          logger.info('Suficientes turnos encontrados', {
            total: allTurnos.length,
            rango: dias,
          })
          break
        }
      }
    } catch (error) {
      logger.error('Error buscando turnos en rango', { dias, error: error instanceof Error ? error.message : 'Unknown' })
    }
  }

  if (allTurnos.length === 0) {
    return {
      success: false,
      error: 'No se encontraron turnos disponibles en los proximos 60 dias',
    }
  }

  return {
    success: true,
    turnos: allTurnos,
    rangoUtilizado,
  }
}

/**
 * Construye el mensaje con la lista de turnos disponibles
 * Agrupa por fecha para mejor legibilidad
 */
export function buildTurnosListMessage(
  turnos: TurnoOption[],
  patientName?: string,
  sedeName?: string
): string {
  let message = ''

  if (patientName) {
    const primerNombre = patientName.split(' ')[0]
    message += `${primerNombre}, `
  }

  message += `encontre ${turnos.length} turno${turnos.length > 1 ? 's' : ''} disponible${turnos.length > 1 ? 's' : ''}`
  if (sedeName) {
    message += ` en *${sedeName}*`
  }
  message += `:\n\n`

  // Agrupar turnos por fecha
  const turnosPorFecha: Record<string, TurnoOption[]> = {}
  turnos.forEach((turno) => {
    if (!turnosPorFecha[turno.fecha]) {
      turnosPorFecha[turno.fecha] = []
    }
    turnosPorFecha[turno.fecha].push(turno)
  })

  // Construir mensaje agrupado por fecha
  Object.entries(turnosPorFecha).forEach(([fecha, turnosDia]) => {
    const fechaFormateada = formatDateForDisplay(fecha)
    message += `*${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)}*\n`

    turnosDia.forEach((turno) => {
      message += `  ${turno.numero}. ${turno.hora} - ${turno.profesionalNombre}`
      if (turno.especialidad) {
        message += ` (${turno.especialidad})`
      }
      message += '\n'
    })
    message += '\n'
  })

  message += `Responde con el *numero* del turno que prefieras.`
  return message
}

/**
 * Mensaje cuando no hay turnos disponibles
 */
export function buildNoTurnosMessage(
  sedeName?: string,
  profesionalName?: string,
  especialidadName?: string
): string {
  let message = 'No encontre turnos disponibles'

  if (profesionalName) {
    message += ` con *${profesionalName}*`
  }
  if (especialidadName) {
    message += ` en *${especialidadName}*`
  }
  if (sedeName) {
    message += ` en *${sedeName}*`
  }

  message += ' en los proximos 60 dias.\n\n'
  message += 'Podes intentar:\n'
  message += '1. Elegir otro profesional\n'
  message += '2. Elegir otra especialidad\n'
  message += '3. Elegir otra sede\n\n'
  message += 'Responde con el numero de la opcion que prefieras.'

  return message
}
