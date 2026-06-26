/**
 * Navegación "Volver al paso anterior" para los flujos conversacionales.
 *
 * Provee:
 * - Detección del comando de volver (opción `0` o palabras clave).
 * - Builder de la opción numerada que se anexa al final de cada paso.
 * - Mapas de "paso previo" por flujo (paciente existente y paciente nuevo).
 * - Helper para anexar la opción de volver al mensaje saliente de forma centralizada.
 *
 * Se mantiene SIN dependencias de los builders concretos para evitar imports
 * circulares: cada integración decide cómo re-renderizar el paso previo.
 */

export type FlowKind = 'existing' | 'new'

/** Valor especial: no hay paso previo dentro del flujo, se vuelve al menú principal. */
export const MAIN_MENU = 'MAIN_MENU' as const

/** Indica si una fase muestra opción de volver y de qué tipo. */
export type BackKind = 'first' | 'has_prev' | null

/**
 * Detecta si el mensaje del usuario es un pedido de "volver al paso anterior".
 * Acepta la opción numerada `0` o palabras clave acotadas para evitar falsos
 * positivos en pasos de texto libre (nombre, email, obra social, etc.).
 */
export function isBackCommand(input: string): boolean {
  const raw = (input || '').trim()
  if (raw === '0') return true

  const norm = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/\s+/g, ' ')
    .trim()

  // Mensajes largos no se consideran comandos de navegación (texto libre)
  if (norm.length > 30) return false

  const exactos = new Set([
    'volver',
    'atras',
    'volver atras',
    'anterior',
    'paso anterior',
    'menu anterior',
    'volver al menu',
    'volver al menu anterior',
    'volver al paso anterior',
    'volver atras por favor',
    'regresar',
    'ir atras',
    'paso previo',
  ])
  if (exactos.has(norm)) return true

  // Frases comunes: "quiero volver", "puedo regresar al paso anterior", etc.
  if (/^(quiero |puedo |me gustaria |quisiera |podria )?(volver|regresar|ir)( al| a)?( paso| menu)?( anterior| previo)?$/.test(norm)) {
    return true
  }

  return false
}

/** Construye la línea de la opción "0" según haya o no paso previo. */
export function buildBackOption(isFirstStep: boolean): string {
  return isFirstStep
    ? `\n\n0. *Volver al menú principal*`
    : `\n\n0. *Volver al paso anterior*`
}

/** Fases terminales que nunca muestran opción de volver. */
const TERMINAL_PHASES = new Set(['completed', 'abandoned', 'error'])

/** Primer paso (sin paso previo) de cada flujo. */
const FIRST_STEP: Record<FlowKind, string> = {
  existing: 'awaiting_sede',
  new: 'awaiting_apellido',
}

/**
 * Fases que ofrecen "volver al paso anterior" (no son el primer paso).
 * Las fases de modificación de datos vuelven a la confirmación.
 */
const HAS_PREV_PHASES = new Set([
  'awaiting_obra_social',
  'awaiting_obra_social_selection',
  'awaiting_sede', // sólo es "has_prev" en flujo nuevo (override más abajo)
  'awaiting_search_type',
  'awaiting_professional_name',
  'awaiting_professional_selection',
  'awaiting_specialty_selection',
  'awaiting_turno_selection',
  'awaiting_email',
  'awaiting_confirmation',
  'awaiting_modify_selection',
  'awaiting_modify_nombre',
  'awaiting_modify_dni',
  'awaiting_modify_obra_social',
])

/**
 * Determina qué tipo de opción de volver corresponde para una fase dada.
 * Devuelve `null` si la fase no debe mostrar la opción.
 */
export function backKindForPhase(phase: string | undefined, flow: FlowKind): BackKind {
  if (!phase || TERMINAL_PHASES.has(phase)) return null

  if (phase === FIRST_STEP[flow]) return 'first'

  // En el flujo existente la sede es el primer paso (cubierto arriba).
  // En el flujo nuevo, la sede tiene paso previo (obra social).
  if (HAS_PREV_PHASES.has(phase)) return 'has_prev'

  return null
}

/**
 * Anexa la opción de volver al mensaje saliente, según la fase destino.
 * No modifica mensajes vacíos ni duplica la opción si ya está presente.
 */
export function withBackOption(
  message: string | undefined,
  nextPhase: string | undefined,
  flow: FlowKind
): string | undefined {
  if (!message) return message
  const kind = backKindForPhase(nextPhase, flow)
  if (!kind) return message
  if (message.includes('Volver al menú') || message.includes('Volver al paso')) {
    return message
  }
  return message + buildBackOption(kind === 'first')
}

/**
 * Contexto necesario para resolver el paso previo de forma condicional.
 */
export interface PreviousPhaseContext {
  flow: FlowKind
  searchType?: string
}

/**
 * Resuelve la fase previa a la fase actual.
 * Devuelve `MAIN_MENU` cuando el paso actual es el primero del flujo.
 */
export function getPreviousPhase(
  currentPhase: string,
  ctx: PreviousPhaseContext
): string {
  const { flow, searchType } = ctx

  // Primer paso de cada flujo -> menú principal
  if (currentPhase === FIRST_STEP[flow]) return MAIN_MENU

  switch (currentPhase) {
    // --- Flujo nuevo (pasos previos a la sede) ---
    case 'awaiting_nombre':
      return 'awaiting_apellido'
    case 'awaiting_obra_social':
      return 'awaiting_nombre'
    case 'awaiting_obra_social_selection':
      return 'awaiting_obra_social'
    case 'awaiting_sede':
      // Sólo se alcanza en flujo nuevo (en existente es el primer paso)
      return 'awaiting_obra_social'

    // --- Pasos comunes de búsqueda ---
    case 'awaiting_search_type':
      return 'awaiting_sede'
    case 'awaiting_professional_name':
      return 'awaiting_search_type'
    case 'awaiting_professional_selection':
      return 'awaiting_professional_name'
    case 'awaiting_specialty_selection':
      return 'awaiting_search_type'

    case 'awaiting_turno_selection':
      // El paso previo depende de cómo se llegó a la lista de turnos
      if (searchType === 'especialidad') return 'awaiting_specialty_selection'
      if (searchType === 'medico_particular') return 'awaiting_professional_name'
      // cualquier_medico u otros -> volver a elegir tipo de búsqueda
      return 'awaiting_search_type'

    case 'awaiting_email':
      return 'awaiting_turno_selection'
    case 'awaiting_confirmation':
      return 'awaiting_turno_selection'

    // --- Modificación de datos -> volver a la confirmación ---
    case 'awaiting_modify_selection':
    case 'awaiting_modify_nombre':
    case 'awaiting_modify_dni':
    case 'awaiting_modify_obra_social':
      return 'awaiting_confirmation'

    default:
      return MAIN_MENU
  }
}
