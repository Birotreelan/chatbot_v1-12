/**
 * Handler compartido para seleccion de turno
 * CRITICO: Usa campo 'numero' para mapeo, NUNCA indice de array
 */

import { createConversationLogger } from '../logger'
import type { TurnoOption, HandlerResult, SearchType } from './types'

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
 * Construye el mensaje de seleccion invalida con lista de turnos y opcion de rebusqueda
 */
export function buildInvalidSelectionMessage(
  turnosOpciones: TurnoOption[],
  searchType?: SearchType
): string {
  let message = `No encontre esa opcion entre las disponibles.\n\n`
  
  // Agrupar turnos por fecha
  const turnosPorFecha: Record<string, TurnoOption[]> = {}
  turnosOpciones.forEach((turno) => {
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

  // Agregar opcion extra al final (N+1)
  const opcionExtra = turnosOpciones.length + 1
  if (searchType === 'cualquier_medico') {
    message += `*${opcionExtra}. Buscar mas turnos*\n\n`
  } else {
    message += `*${opcionExtra}. Buscar con cualquier medico disponible*\n\n`
  }
  
  message += `Responde con el *numero* de la opcion que prefieras.`
  return message
}

/**
 * Mapa de ordinales en español a su valor numerico
 */
const ORDINALES_ES: Record<string, number> = {
  primero: 1, primera: 1, uno: 1,
  segundo: 2, segunda: 2, dos: 2,
  tercero: 3, tercera: 3, tres: 3,
  cuarto: 4, cuarta: 4, cuatro: 4,
  quinto: 5, quinta: 5, cinco: 5,
  sexto: 6, sexta: 6, seis: 6,
  septimo: 7, septima: 7, siete: 7,
  octavo: 8, octava: 8, ocho: 8,
  noveno: 9, novena: 9, nueve: 9,
  decimo: 10, decima: 10, diez: 10,
  once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25,
}

/**
 * Normaliza texto eliminando tildes para comparacion
 */
function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Intenta resolver el input de texto a un numero de turno.
 * Estrategias (en orden de prioridad):
 * 1. Ordinal en español ("tercero" → 3)
 * 2. Nombre de profesional parcial ("moreira" → primero de Moreira)
 * 3. Nombre de dia ("lunes" → primero del lunes)
 * 4. Hora expresada en texto ("las diez" / "10 y media")
 * Retorna el numero del turno encontrado o null si no puede resolverlo.
 */
function resolverTextoATurno(input: string, turnosOpciones: TurnoOption[]): TurnoOption | null {
  const inputNorm = normalizarTexto(input)

  // 1. Ordinal en español
  for (const [ordinal, numero] of Object.entries(ORDINALES_ES)) {
    // Coincidencia exacta o como palabra completa dentro del input
    const regex = new RegExp(`\\b${ordinal}\\b`)
    if (regex.test(inputNorm)) {
      const turno = turnosOpciones.find((t) => t.numero === numero)
      if (turno) return turno
    }
  }

  // 2. Nombre de profesional (apellido o nombre parcial)
  const turnosPorProfesional = turnosOpciones.filter((t) => {
    const profNorm = normalizarTexto(t.profesionalNombre || '')
    // Busca si alguna palabra del input aparece en el nombre del profesional
    return inputNorm.split(/\s+/).some((palabra) => palabra.length >= 3 && profNorm.includes(palabra))
  })
  if (turnosPorProfesional.length === 1) {
    // Unico profesional que coincide → selecciona ese turno
    return turnosPorProfesional[0]
  }

  // 3. Dia de la semana
  const diasSemana: Record<string, number> = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3,
    jueves: 4, viernes: 5, sabado: 6,
  }
  for (const [dia, diaN] of Object.entries(diasSemana)) {
    if (inputNorm.includes(dia)) {
      const turnosDia = turnosOpciones.filter((t) => {
        const [year, month, day] = t.fecha.split('-')
        const fecha = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
        return fecha.getDay() === diaN
      })
      // Solo resuelve si hay exactamente uno para no ambiguar
      if (turnosDia.length === 1) return turnosDia[0]
      break
    }
  }

  return null
}

/**
 * Maneja la seleccion de turno por parte del usuario
 * IMPORTANTE: Mapea por campo 'numero', NO por indice de array
 */
export async function handleTurnoSelection(
  userInput: string,
  turnosOpciones: TurnoOption[],
  phoneNumber: string,
  clientId: string,
  searchType?: SearchType
): Promise<HandlerResult & { selectedTurno?: TurnoOption; requestedRebusqueda?: boolean; noMoreTurnos?: boolean }> {
  const logger = createConversationLogger(phoneNumber, clientId, 'turno_selection')

  // Normalizar input
  const inputNormalizado = userInput.trim().toLowerCase()

  // Intentar extraer numero
  const numeroMatch = inputNormalizado.match(/^\d+$/)

  if (numeroMatch) {
    const numero = parseInt(numeroMatch[0], 10)
    
    // Verificar si eligio la opcion extra (N+1 = rebusqueda)
    const opcionExtra = turnosOpciones.length + 1
    if (numero === opcionExtra) {
      logger.info('Usuario solicito rebusqueda', { searchType })
      
      if (searchType === 'cualquier_medico') {
        // Para cualquier_medico, no hay mas opciones - mostrar mensaje final
        return {
          handled: true,
          noMoreTurnos: true,
          message: `Lo siento, los turnos que te he mostrado son todos los disponibles en este momento.\n\nResponde con el *numero* del turno que prefieras o podes consultarme mas adelante cuando haya mas disponibilidad.`,
          nextPhase: 'awaiting_turno_selection',
        }
      } else {
        // Para medico_particular o especialidad, permitir buscar con cualquier medico
        return {
          handled: true,
          requestedRebusqueda: true,
        }
      }
    }

    // CRITICO: Buscar turno por campo 'numero', NO por indice
    const turnoSeleccionado = turnosOpciones.find((t) => t.numero === numero)

    if (turnoSeleccionado) {
      logger.info('Turno seleccionado correctamente', {
        numeroInput: numero,
        turnoNumero: turnoSeleccionado.numero,
        agendaId: turnoSeleccionado.id,
        fecha: turnoSeleccionado.fecha,
        hora: turnoSeleccionado.hora,
        profesional: turnoSeleccionado.profesionalNombre,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_confirmation',
        selectedTurno: turnoSeleccionado,
      }
    } else {
      // Numero fuera de rango
      logger.info('Numero de turno fuera de rango', {
        numeroInput: numero,
        rangoValido: `1-${turnosOpciones.length}`,
        opcionExtra,
      })

      return {
        handled: true,
        message: buildInvalidSelectionMessage(turnosOpciones, searchType),
        nextPhase: 'awaiting_turno_selection',
      }
    }
  }

  // Intentar detectar hora (HH:MM)
  const horaMatch = inputNormalizado.match(/(\d{1,2})[:\.](\d{2})/)
  if (horaMatch) {
    const hora = `${horaMatch[1].padStart(2, '0')}:${horaMatch[2]}`
    const turnoByHora = turnosOpciones.find((t) => t.hora === hora)

    if (turnoByHora) {
      logger.info('Turno seleccionado por hora', {
        horaInput: hora,
        turnoNumero: turnoByHora.numero,
        agendaId: turnoByHora.id,
      })

      return {
        handled: true,
        nextPhase: 'awaiting_confirmation',
        selectedTurno: turnoByHora,
      }
    }
  }

  // FALLBACK: si el input contiene letras, intentar resolver por texto (ordinales, profesional, dia)
  const esTexto = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(inputNormalizado)

  if (esTexto) {
    const turnoResuelto = resolverTextoATurno(userInput, turnosOpciones)

    if (turnoResuelto) {
      logger.info('Turno resuelto por texto', {
        input: userInput,
        turnoNumero: turnoResuelto.numero,
        agendaId: turnoResuelto.id,
      })
      return {
        handled: true,
        nextPhase: 'awaiting_confirmation',
        selectedTurno: turnoResuelto,
      }
    }

    logger.info('Seleccion de turno por texto no reconocido - solicitando numero', { input: userInput })
    return {
      handled: true,
      message: buildInvalidSelectionMessage(turnosOpciones, searchType),
      nextPhase: 'awaiting_turno_selection',
    }
  }

  // Numero fuera de rango o invalido
  logger.info('Seleccion de turno no reconocida', { input: userInput })

  return {
    handled: true,
    message: buildInvalidSelectionMessage(turnosOpciones, searchType),
    nextPhase: 'awaiting_turno_selection',
  }
}

/**
 * Construye el mensaje de confirmacion previo al email
 */
export function buildTurnoSelectedMessage(turno: TurnoOption): string {
  const fechaFormateada = formatDateForDisplay(turno.fecha)

  return `Seleccionaste el turno:

*Fecha:* ${fechaFormateada.charAt(0).toUpperCase() + fechaFormateada.slice(1)}
*Hora:* ${turno.hora}
*Profesional:* ${turno.profesionalNombre}${turno.especialidad ? `\n*Especialidad:* ${turno.especialidad}` : ''}${turno.sedeNombre ? `\n*Sede:* ${turno.sedeNombre}` : ''}`
}

/**
 * Valida que el turno seleccionado coincida con la lista mostrada
 * Funcion de seguridad para evitar inconsistencias
 */
export function validateTurnoSelection(
  turnoSeleccionado: TurnoOption,
  turnosOpciones: TurnoOption[]
): boolean {
  const turnoEnLista = turnosOpciones.find((t) => t.numero === turnoSeleccionado.numero)

  if (!turnoEnLista) {
    return false
  }

  // Verificar que los datos coincidan
  return (
    turnoEnLista.id === turnoSeleccionado.id &&
    turnoEnLista.fecha === turnoSeleccionado.fecha &&
    turnoEnLista.hora === turnoSeleccionado.hora
  )
}
