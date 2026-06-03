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
  infoSinTurnos?: any
  error?: string
}> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turnos_search')

  const today = new Date()
  let allTurnos: TurnoOption[] = []
  let rangoUtilizado = 0
  let infoSinTurnos: any = undefined

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
        // Capturar info_sin_turnos si existe (cuando no hay turnos pero hay profesionales solo por telefono)
        if (result.datos.info_sin_turnos) {
          infoSinTurnos = result.datos.info_sin_turnos
        }
        
        // Procesar turnos recibidos
        // La API devuelve: { turnos_disponibles: [{ fecha: "...", turnos: [...] }, ...] }
        // O puede devolver directamente un array de turnos
        // NOTA: obtenerTurnos() ya extrae turnos_disponibles, asi que result.datos puede ser:
        //   - Array de grupos: [{ fecha: "...", turnos: [...] }, ...]
        //   - Array de turnos directos: [{ Id, Hora, ... }, ...]
        let turnosRaw: any[] = []
        
        if (Array.isArray(result.datos)) {
          // Verificar si es un array de grupos (con fecha+turnos) o de turnos directos
          const firstItem = result.datos[0]
          if (firstItem && firstItem.turnos && Array.isArray(firstItem.turnos)) {
            // Es un array de grupos por fecha - extraer los turnos de cada grupo
            result.datos.forEach((grupo: any) => {
              if (grupo.turnos && Array.isArray(grupo.turnos)) {
                turnosRaw.push(...grupo.turnos)
              }
            })
          } else if (firstItem && (firstItem.Id || firstItem.Hora || firstItem.id)) {
            // Es un array de turnos directos
            turnosRaw = result.datos
          } else {
            // Fallback: tratar como array de turnos
            turnosRaw = result.datos
          }
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

        logger.info('Turnos raw extraidos', { 
          count: turnosRaw.length, 
          sample: turnosRaw.length > 0 ? { 
            Id: turnosRaw[0].Id, 
            Hora: turnosRaw[0].Hora, 
            Profesional_Nombre: turnosRaw[0].Profesional_Nombre 
          } : null 
        })
        
        // Log de debug para ver TODOS los campos del primer turno
        if (turnosRaw.length > 0) {
          logger.info('[v0] DEBUG - Primer turno completo con TODOS los campos:', {
            turnoCompleto: JSON.stringify(turnosRaw[0]),
            keys: Object.keys(turnosRaw[0]),
          })
        }

        // Mapear turnos al formato interno
        // Los campos de la API pueden venir en diferentes formatos:
        // - PascalCase: Hora, Profesional_Nombre
        // - snake_case: hora, profesional_nombre
        // - camelCase: horaFormateada, profesionalNombre
        // Numeración comienza desde 1 para cada búsqueda
        const nuevosTurnos = turnosRaw.map((turno: any, index: number) => ({
          numero: index + 1,
          id: turno.Id || turno.Agenda_Id || turno.id || turno.agenda_id,
          fecha: turno.Fecha || turno.fecha,
          // Intentar todas las variaciones conocidas para hora
          hora: (turno.Hora || turno.hora || turno.hora_formateada || turno.horaFormateada || turno.Hora_Turno || 'N/A').toString().trim().substring(0, 5),
          profesionalId: turno.Profesional_Id || turno.profesional_id || turno.ProfesionalId,
          // Intentar todas las variaciones conocidas para nombre del profesional
          profesionalNombre: (
            turno.Profesional_Nombre || 
            turno.profesional_nombre || 
            turno.Profesional || 
            turno.profesional || 
            turno.nombre_profesional ||
            turno.NombreProfesional ||
            turno.Doctor ||
            turno.doctor ||
            'Sin asignar'
          ).toString().trim(),
          especialidad: turno.Especialidad || turno.especialidad || turno.Subespecialidad || turno.subespecialidad,
          sedeId: turno.Sede_Id || turno.sede_id || params.sedeId,
          sedeNombre: turno.Sede_Nombre || turno.sede_nombre || turno.Centro_Nombre || turno.centro_nombre,
          duracion: turno.Duracion || turno.duracion,
        }))
        
        // En la busqueda acumulativa, cada rango mayor REEMPLAZA los resultados 
        // (el API devuelve todos los turnos en el rango completo, no solo los nuevos)
        // Por eso tomamos los resultados del ultimo rango exitoso
        allTurnos = nuevosTurnos
        
        logger.info('Turnos mapeados', { 
          count: allTurnos.length, 
          sample: allTurnos.length > 0 ? { 
            numero: allTurnos[0].numero, 
            hora: allTurnos[0].hora, 
            profesionalNombre: allTurnos[0].profesionalNombre 
          } : null 
        })

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
      logger.error('Error buscando turnos en rango', error instanceof Error ? error : new Error(String(error)))
    }
  }

  if (allTurnos.length === 0) {
    return {
      success: false,
      infoSinTurnos,
      error: 'No se encontraron turnos disponibles en los proximos 60 dias',
    }
  }

  return {
    success: true,
    turnos: allTurnos,
    rangoUtilizado,
    infoSinTurnos,
  }
}

/**
 * Construye el mensaje con la lista de turnos disponibles
 * Agrupa por fecha para mejor legibilidad
 */
export function buildTurnosListMessage(
  turnos: TurnoOption[],
  patientName?: string,
  sedeName?: string,
  profesionalNombre?: string,
  rangoUtilizado?: number
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
  if (profesionalNombre) {
    message += ` con *${profesionalNombre}*`
  }
  if (rangoUtilizado) {
    message += ` para los proximos ${rangoUtilizado} dias`
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
      const hora = turno.hora && turno.hora !== 'undefined' && turno.hora.trim() ? turno.hora.trim() : 'Horario a confirmar'
      const profesional = turno.profesionalNombre && turno.profesionalNombre !== 'undefined' && turno.profesionalNombre.trim() ? turno.profesionalNombre.trim() : 'Profesional a confirmar'
      message += `  ${turno.numero}. ${hora} - ${profesional}\n`
    })
    message += '\n'
  })

  message += `Responde con el *numero* del turno que prefieras.`
  return message
}

/**
 * Mensaje cuando no hay turnos disponibles
 * Versiones diferentes segun el tipo de busqueda
 * Las opciones DEBEN coincidir con awaiting_search_type para mantener consistencia
 */
export function buildNoTurnosMessage(
  sedeName?: string,
  profesionalName?: string,
  especialidadName?: string,
  searchType?: string,
  infoSinTurnos?: any,
  escalationPhoneNumber?: string
): string {
  let message = ''

  // Si la busqueda fue "Cualquier medico disponible" (tipo 3) y hay info de profesionales solo por telefono
  if (searchType === 'cualquier_medico' && infoSinTurnos?.profesionales_disponibles_solo_telefono && infoSinTurnos.profesionales_disponibles_solo_telefono.length > 0) {
    message += `No encontre turnos disponibles para agendar online en *${sedeName || 'esta sede'}*.\n\n`
    message += `Sin embargo, hay profesionales con turnos disponibles para tu obra social que solo se pueden reservar por telefono.\n\n`
    if (escalationPhoneNumber) {
      message += `Para agendar tu turno, comunicate al: *${escalationPhoneNumber}*`
    }
    return message
  }

  // Mensaje estándar para búsquedas tipo 1 o 2, o cuando no hay info de profesionales por teléfono
  message += 'No encontre turnos disponibles'

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
  message += 'Podes intentar con otra busqueda:\n\n'
  message += '1. *Medico en particular* - Buscar con otro profesional\n'
  message += '2. *Por especialidad* - Buscar en otra especialidad\n'
  message += '3. *Cualquier medico disponible* - Ver turnos mas proximos\n\n'
  message += 'Responde con el *numero* de la opcion que prefieras.'

  return message
}
