/**
 * Handler compartido para seleccion de turno
 * CRITICO: Usa campo 'numero' para mapeo, NUNCA indice de array
 *
 * Capas de deteccion (en orden):
 * 1. Numero directo ("21")
 * 2. Hora HH:MM exacta ("09:40")
 * 3. Resolucion deterministica por texto: ordinal / profesional / dia+fecha+hora
 * 4. NLU fallback con OpenAI (ultimo recurso): resuelve ambiguedades o genera pregunta de aclaracion
 */

import { createConversationLogger } from '../logger'
import { openai } from '@/lib/openai'
import { detectFlowInterruption } from './flow-interruption-handler'
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
 * Extrae hora en formato "HH:MM" desde texto libre del usuario.
 * Cubre formatos coloquiales argentinos.
 * Retorna string "HH:MM" o null si no se detecta.
 *
 * Ejemplos cubiertos:
 *   "9y40" "9 y 40" "9h40" "9:40" "9.40"  → "09:40"
 *   "9 hs" "9 hrs" "9 horas" "las 9"       → "09:00"
 *   "10 y media"                            → "10:30"
 *   "las 10:30"                             → "10:30"
 */
function extraerHoraDeTexto(input: string): string | null {
  const norm = normalizarTexto(input)

  // HH:MM o HH.MM estandar
  let m = norm.match(/\b(\d{1,2})[:\.](\d{2})\b/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`

  // "X y media" → HH:30
  m = norm.match(/\b(\d{1,2})\s+y\s+media\b/)
  if (m) return `${m[1].padStart(2, '0')}:30`

  // "X y YY" o "XyYY" → HH:MM  (9y40, 9 y 40)
  m = norm.match(/\b(\d{1,2})\s*y\s*(\d{2})\b/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`

  // "XhYY" o "X h YY" → HH:MM  (9h40)
  m = norm.match(/\b(\d{1,2})\s*h\s*(\d{2})\b/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`

  // "las X" o "la X" seguido de fin / espacio / "hs" → HH:00
  m = norm.match(/\blas?\s+(\d{1,2})(?:\s|$|\s*(?:hs?|hrs?|horas?))/)
  if (m) return `${m[1].padStart(2, '0')}:00`

  // "X hs" "X hrs" "X horas" → HH:00
  m = norm.match(/\b(\d{1,2})\s*(?:hs?|hrs?|horas?)\b/)
  if (m) return `${m[1].padStart(2, '0')}:00`

  return null
}

/**
 * Intenta extraer el numero de dia del mes (1-31) del input
 * descartando numeros que ya fueron identificados como hora.
 * Retorna el primer numero plausible como dia del mes, o null.
 */
function extraerDiaDelMes(input: string, horaExtraida: string | null): number | null {
  const norm = normalizarTexto(input)

  // Hora extraida: si tenemos "09:40", los numeros 9 y 40 no son dia del mes
  const numerosDeHora = new Set<string>()
  if (horaExtraida) {
    const [hh, mm] = horaExtraida.split(':')
    numerosDeHora.add(String(parseInt(hh, 10)))
    numerosDeHora.add(String(parseInt(mm, 10)))
  }

  // Extraer todos los numeros del input
  const matches = [...norm.matchAll(/\b(\d{1,2})\b/g)]
  for (const match of matches) {
    const num = parseInt(match[1], 10)
    // Plausible dia del mes: 1-31, y no es numero de hora/minutos
    if (num >= 1 && num <= 31 && !numerosDeHora.has(String(num))) {
      return num
    }
  }
  return null
}

/**
 * Dias de la semana: nombre normalizado → getDay() value
 */
const DIAS_SEMANA: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
}

/**
 * Intenta resolver el input de texto a un turno de forma deterministica.
 *
 * Estrategias (en orden de prioridad):
 *   1. Ordinal en español ("tercero" → turno #3)
 *   2. Nombre de profesional parcial sin ambiguedad
 *   3. Dia + numero del mes + hora  (maxima precision: "miercoles 24 a 9y40")
 *   4. Dia + numero del mes         (sin hora: si la fecha tiene un solo turno)
 *   5. Dia + hora                   (sin fecha: si la combinacion es unica)
 *   6. Solo dia                     (si hay exactamente un turno ese dia)
 *   7. Solo hora                    (si hay exactamente un turno con esa hora)
 *
 * Retorna el TurnoOption encontrado (certeza) o null si no puede resolverlo sin ambiguedad.
 */
export function resolverTextoATurno(input: string, turnosOpciones: TurnoOption[]): TurnoOption | null {
  const inputNorm = normalizarTexto(input)

  // -- ESTRATEGIA 1: Ordinal en español --
  for (const [ordinal, numero] of Object.entries(ORDINALES_ES)) {
    const regex = new RegExp(`\\b${ordinal}\\b`)
    if (regex.test(inputNorm)) {
      const turno = turnosOpciones.find((t) => t.numero === numero)
      if (turno) return turno
    }
  }

  // -- ESTRATEGIA 2: Nombre de profesional parcial --
  const turnosPorProfesional = turnosOpciones.filter((t) => {
    const profNorm = normalizarTexto(t.profesionalNombre || '')
    return inputNorm.split(/\s+/).some((palabra) => palabra.length >= 3 && profNorm.includes(palabra))
  })
  if (turnosPorProfesional.length === 1) return turnosPorProfesional[0]

  // -- Extraccion de componentes temporales --
  const horaExtraida = extraerHoraDeTexto(input)
  const diaDelMes = extraerDiaDelMes(input, horaExtraida)

  // Detectar dia de semana mencionado en el input
  let diaSemanaDetectado: number | null = null
  for (const [dia, diaN] of Object.entries(DIAS_SEMANA)) {
    if (inputNorm.includes(dia)) {
      diaSemanaDetectado = diaN
      break
    }
  }

  // Helper: obtener Date desde TurnoOption sin conversion de timezone
  const getFecha = (t: TurnoOption): Date => {
    const [y, mo, d] = t.fecha.split('-').map(Number)
    return new Date(y, mo - 1, d)
  }

  // -- ESTRATEGIA 3: Dia de semana + numero del mes + hora (maxima precision) --
  if (diaSemanaDetectado !== null && diaDelMes !== null && horaExtraida !== null) {
    const candidatos = turnosOpciones.filter((t) => {
      const f = getFecha(t)
      return (
        f.getDay() === diaSemanaDetectado &&
        f.getDate() === diaDelMes &&
        t.hora === horaExtraida
      )
    })
    if (candidatos.length === 1) return candidatos[0]
  }

  // -- ESTRATEGIA 4: Dia de semana + numero del mes (sin hora especificada) --
  if (diaSemanaDetectado !== null && diaDelMes !== null) {
    const candidatos = turnosOpciones.filter((t) => {
      const f = getFecha(t)
      return f.getDay() === diaSemanaDetectado && f.getDate() === diaDelMes
    })
    if (candidatos.length === 1) return candidatos[0]
    // Si hay varios turnos ese dia, continuar para ver si la hora los distingue
    if (candidatos.length > 1 && horaExtraida !== null) {
      const porHora = candidatos.filter((t) => t.hora === horaExtraida)
      if (porHora.length === 1) return porHora[0]
    }
  }

  // -- ESTRATEGIA 5: Dia de semana + hora (sin numero de mes) --
  if (diaSemanaDetectado !== null && horaExtraida !== null) {
    const candidatos = turnosOpciones.filter((t) => {
      const f = getFecha(t)
      return f.getDay() === diaSemanaDetectado && t.hora === horaExtraida
    })
    if (candidatos.length === 1) return candidatos[0]
  }

  // -- ESTRATEGIA 6: Solo dia de semana --
  if (diaSemanaDetectado !== null) {
    const candidatos = turnosOpciones.filter((t) => getFecha(t).getDay() === diaSemanaDetectado)
    if (candidatos.length === 1) return candidatos[0]
  }

  // -- ESTRATEGIA 7: Solo hora --
  if (horaExtraida !== null) {
    const candidatos = turnosOpciones.filter((t) => t.hora === horaExtraida)
    if (candidatos.length === 1) return candidatos[0]
  }

  return null
}

// ============================================================================
// NLU FALLBACK CON OPENAI
// ============================================================================

/**
 * Resultado posible del NLU fallback para seleccion de turno.
 * - resolved: OpenAI identifico un turno unico con certeza
 * - ambiguous: OpenAI detecto ambiguedad y genera pregunta de aclaracion
 * - unrelated: El input del usuario no tiene relacion con seleccionar un turno
 */
export type TurnoNLUResult =
  | { outcome: 'resolved'; turnoNumero: number; reasoning: string }
  | { outcome: 'ambiguous'; clarificationMessage: string; reasoning: string }
  | { outcome: 'unrelated'; reasoning: string }

/**
 * Serializa la lista de turnos en texto compacto para el prompt de OpenAI.
 * Formato: "#N. Dia DD/MM HH:MM - Profesional"
 */
function serializarTurnos(turnos: TurnoOption[]): string {
  // Agrupar por fecha para legibilidad
  const porFecha: Record<string, TurnoOption[]> = {}
  const diasNombre = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']
  const mesesNombre = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

  for (const t of turnos) {
    if (!porFecha[t.fecha]) porFecha[t.fecha] = []
    porFecha[t.fecha].push(t)
  }

  const lineas: string[] = []
  for (const [fecha, ts] of Object.entries(porFecha)) {
    const [y, mo, d] = fecha.split('-').map(Number)
    const f = new Date(y, mo - 1, d)
    const diaNombre = diasNombre[f.getDay()]
    const mesNombre = mesesNombre[mo - 1]
    lineas.push(`--- ${diaNombre} ${d}/${mesNombre} ---`)
    for (const t of ts) {
      const prof = t.profesionalNombre?.trim() || 'Sin profesional'
      lineas.push(`  #${t.numero}. ${t.hora} - ${prof}`)
    }
  }
  return lineas.join('\n')
}

/**
 * Usa GPT-4o-mini para resolver seleccion de turno cuando la logica deterministica falla.
 *
 * Comportamiento esperado de OpenAI:
 * - Si el input identifica un turno unico con certeza → retorna { outcome: "resolved", turnoNumero: N }
 * - Si el input es ambiguo (ej: solo "miercoles" con dos miercoles) → retorna { outcome: "ambiguous", clarificationMessage: "..." }
 * - Si el input no tiene relacion con turnos → retorna { outcome: "unrelated" }
 *
 * La pregunta de aclaracion generada por OpenAI menciona las opciones concretas en conflicto,
 * por ejemplo: "Dijiste 'miercoles', pero encontre que hay turnos el Miercoles 17/jun y el Miercoles 24/jun.
 * Podrias indicarme a cual te referies?"
 */
export async function resolverTurnoConNLU(
  userInput: string,
  turnosOpciones: TurnoOption[],
): Promise<TurnoNLUResult> {
  const listaTurnos = serializarTurnos(turnosOpciones)

  const systemPrompt = `Eres un asistente especializado en interpretar selecciones de turnos medicos.
Se te dara una lista de turnos disponibles (con numero, dia, fecha, hora y profesional) y el texto que escribio el paciente.
Tu tarea es determinar con cual turno coincide el texto del paciente.

REGLAS CRITICAS:
1. Si el texto identifica UN UNICO turno con certeza → responde con outcome "resolved" y el numero exacto del turno.
2. Si el texto es ambiguo (coincide con mas de uno o falta informacion para decidir) → responde con outcome "ambiguous" y genera una pregunta corta y clara en castellano argentino informal que le pida al paciente que aclare entre las opciones en conflicto. Menciona los turnos especificos en conflicto (dia, fecha, hora segun corresponda).
3. Si el texto no tiene ninguna relacion con seleccionar un turno (ej: "ok", "gracias", saludos) → responde con outcome "unrelated".
4. NUNCA inventes un turno que no este en la lista.
5. La pregunta de aclaracion debe ser muy concisa (1-2 oraciones), conversacional y mencionar solo los datos relevantes para distinguir las opciones.

SALIDA JSON (sin markdown):
{
  "outcome": "resolved" | "ambiguous" | "unrelated",
  "turnoNumero": <numero entero, solo si outcome es "resolved">,
  "clarificationMessage": "<pregunta en castellano, solo si outcome es 'ambiguous'>",
  "reasoning": "<explicacion breve de la decision>"
}`

  const userPrompt = `Turnos disponibles:
${listaTurnos}

Texto del paciente: "${userInput}"

Retorna JSON.`

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

    const raw = response.choices[0]?.message?.content
    if (!raw) throw new Error('OpenAI: respuesta vacia')

    const parsed = JSON.parse(raw)

    if (parsed.outcome === 'resolved' && typeof parsed.turnoNumero === 'number') {
      return { outcome: 'resolved', turnoNumero: parsed.turnoNumero, reasoning: parsed.reasoning || '' }
    }

    if (parsed.outcome === 'ambiguous' && typeof parsed.clarificationMessage === 'string') {
      return { outcome: 'ambiguous', clarificationMessage: parsed.clarificationMessage, reasoning: parsed.reasoning || '' }
    }

    if (parsed.outcome === 'unrelated') {
      return { outcome: 'unrelated', reasoning: parsed.reasoning || '' }
    }

    // Si el JSON no tiene el formato esperado, tratar como unrelated
    return { outcome: 'unrelated', reasoning: 'Respuesta inesperada de NLU' }
  } catch (error) {
    // En caso de error de OpenAI, no bloquear el flujo
    return { outcome: 'unrelated', reasoning: `Error NLU: ${error}` }
  }
}

/**
 * Opciones para el interceptor de consultas intercaladas en seleccion de turno
 */
export interface TurnoInterruptionOptions {
  /** Mensaje original con la lista de turnos para re-mostrar al usuario */
  originalTurnosMessage: string
  /** Teléfono de la clínica para derivar consultas que el bot no puede responder */
  escalationPhone?: string
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
  searchType?: SearchType,
  interruptionOptions?: TurnoInterruptionOptions
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

  // FALLBACK DETERMINISTICO: si el input contiene letras, intentar resolver por texto
  // (ordinales, profesional, dia+fecha del mes+hora)
  const esTexto = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(inputNormalizado)

  if (esTexto) {
    const turnoResuelto = resolverTextoATurno(userInput, turnosOpciones)

    if (turnoResuelto) {
      logger.info('Turno resuelto por texto deterministico', {
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

    // FALLBACK NLU: la logica deterministica no pudo resolver → delegar a OpenAI
    logger.info('Delegando seleccion de turno a NLU OpenAI', { input: userInput })

    const nluResult = await resolverTurnoConNLU(userInput, turnosOpciones)

    if (nluResult.outcome === 'resolved') {
      // OpenAI identifico un turno unico con certeza
      const turnoNLU = turnosOpciones.find((t) => t.numero === nluResult.turnoNumero)
      if (turnoNLU) {
        logger.info('Turno resuelto por NLU OpenAI', {
          input: userInput,
          turnoNumero: turnoNLU.numero,
          agendaId: turnoNLU.id,
          reasoning: nluResult.reasoning,
        })
        return {
          handled: true,
          nextPhase: 'awaiting_confirmation',
          selectedTurno: turnoNLU,
        }
      }
    }

    if (nluResult.outcome === 'ambiguous') {
      // OpenAI detecto ambiguedad → devolver pregunta de aclaracion generada por GPT
      logger.info('NLU OpenAI detecto ambiguedad, solicitando aclaracion', {
        input: userInput,
        reasoning: nluResult.reasoning,
      })
      return {
        handled: true,
        message: nluResult.clarificationMessage,
        nextPhase: 'awaiting_turno_selection',
      }
    }

    // outcome === 'unrelated' o error → verificar si es consulta intercalada antes de mostrar error
    logger.info('NLU OpenAI: input sin relacion con seleccion de turno', {
      input: userInput,
      reasoning: nluResult.reasoning,
    })

    if (interruptionOptions) {
      const interruption = await detectFlowInterruption(
        userInput,
        'awaiting_turno_selection',
        { originalPromptMessage: interruptionOptions.originalTurnosMessage },
        interruptionOptions.escalationPhone,
        phoneNumber,
        clientId
      )

      if (interruption.isInterruption && interruption.response) {
        logger.info('Consulta intercalada en seleccion de turno, respondiendo sin cambiar fase')
        return {
          handled: true,
          message: interruption.response,
          nextPhase: 'awaiting_turno_selection',
        }
      }
    }

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
