/**
 * Router de intención — Contrato de estados (backbone reutilizable)
 *
 * Cada estado conversacional declara un contrato: qué preguntó el bot, qué acciones
 * son válidas (conjunto CERRADO), cómo se cargan los datos de verdad y cómo se ejecuta
 * cada acción. El router elige una acción (fast-path o LLM) y produce un RouterEffect.
 *
 * Principio: el LLM SOLO clasifica; el texto que ve el paciente lo arma el código
 * a partir de datos reales (plantillas + endpoints). Nunca se inventa información.
 */

/** Identificador de cada estado conversacional (crece a medida que migramos). */
export type ConversationStateId =
  | 'clinica_post_cancel_offer'
  | 'clinica_post_confirm_followup'

/** Un slot que el LLM puede extraer del mensaje (opcional por acción). */
export interface SlotSpec {
  name: string
  type: 'string' | 'number' | 'enum'
  enum?: string[]
  description: string
  required?: boolean
}

/** Una acción válida dentro de un estado. */
export interface ActionSpec {
  id: string
  /** Regla que lee el LLM para saber cuándo elegir esta acción. */
  description: string
  slots?: SlotSpec[]
}

/** Contexto de verdad que necesita el estado (solo datos reales). */
export interface StateContext {
  phone: string
  configId: string
  clienteId: string
  escalationPhone?: string
  /** Datos propios del estado (ej: telefonoContacto, turnos, kind). */
  data: Record<string, any>
}

/** Base para cargar el contexto (sin `data`). */
export type StateContextBase = Omit<StateContext, 'data'>

/** Qué debe hacer whatsapp.tsx tras la decisión del router. */
export type RouterEffect =
  | { type: 'send_and_return'; message: string; buttons?: Array<{ id: string; title: string }> }
  | { type: 'clear_state_and_passthrough' }
  | { type: 'init_booking' }
  | { type: 'noop' }

/** El contrato de un estado. */
export interface StateContract {
  id: ConversationStateId
  /** Qué le preguntó el bot al paciente — se inyecta como contexto al LLM. */
  askedPrompt: string
  /** Carga el contexto de verdad. Devuelve null si el estado no aplica. */
  loadContext: (base: StateContextBase) => Promise<StateContext | null>
  /** Atajo determinístico: números puros, ids de botón, email. Devuelve actionId o null. */
  fastPath?: (message: string, ctx: StateContext) => string | null
  /** Conjunto CERRADO de acciones válidas en este estado (las que ve el LLM). */
  allowedActions: ActionSpec[]
  /** Acción a usar si el LLM no decide con confianza o falla (no elegible por el LLM). */
  fallbackActionId: string
  /** Ejecuta la acción elegida y produce el efecto (mensaje + transición). */
  execute: (
    actionId: string,
    slots: Record<string, any>,
    ctx: StateContext,
  ) => Promise<RouterEffect>
}

export interface RouterDecision {
  stateId: ConversationStateId
  actionId: string
  slots: Record<string, any>
  confidence: number
  source: 'fast_path' | 'llm' | 'fallback'
  effect: RouterEffect
}

/** Umbral de confianza mínimo para aceptar la clasificación del LLM. */
export const ROUTER_CONFIDENCE_THRESHOLD = 0.6
