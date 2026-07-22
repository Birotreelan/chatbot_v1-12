/**
 * appointment-flow-state.ts
 * 
 * Maneja el estado del flujo de confirmacion/cancelacion de turnos
 * para permitir respuestas directas sin pasar por OpenAI.
 * 
 * Dos responsabilidades:
 * 1. Context: Guardar/leer Chatbot_Data estructurado (datos del turno)
 * 2. FlowState: Guardar/leer el estado del flujo pendiente (ej: awaiting_cancel_confirmation)
 */

import { getRedisClient } from "./redis"

// ============================================================================
// TYPES
// ============================================================================

export interface ChatbotDataPaciente {
  nombres: string
  apellido: string
  dni: string
  telefono: string
  mail?: string
  obra_social_id?: string
  obra_social_nombre?: string
  /** Instrucciones de la obra social/deudor (qué traer, coseguros, etc.), en HTML básico */
  indicaciones_deudor?: string
}

export interface ChatbotDataTurno {
  fecha: string
  fecha_formateada: string
  hora: string
  hora_formateada: string
  profesional: string
  profesional_id: string
  sede: string
  sede_id?: string
  direccion: string
  agenda_id: string
  admite_reagendamiento: boolean
  tipo: string
  estado?: string
}

/**
 * Snapshot del turno cancelado, preservado en Redis para uso en reagendamiento.
 * Se rellena en clearAppointmentTurnos() y no se borra hasta que expire el TTL.
 */
export interface ChatbotDataTurnoCancelado {
  fecha: string
  hora: string
  profesional: string
  profesional_id: string
  sede: string
  sede_id: string
  direccion: string
  agenda_id: string
}

export interface ChatbotData {
  paciente: ChatbotDataPaciente
  turnos: ChatbotDataTurno[]
  turnos_qx?: ChatbotDataTurno[]
  cantidad_turnos: number
  cantidad_cirugias?: number
  tiene_cirugias?: boolean
  sede_id: string
  clinica: string
  tipo_mensaje: string
  /** Datos del último turno cancelado, preservados para reagendamiento */
  turno_cancelado?: ChatbotDataTurnoCancelado
}

export type FlowStateType =
  | 'awaiting_cancel_confirmation'
  | 'awaiting_reschedule_choice'
  | 'awaiting_cancel_and_reschedule_confirm'
  | 'awaiting_turno_selection'
  | 'awaiting_cancel_all_confirmation'

// Acción pendiente que se ejecutará una vez que el paciente elija sobre cuál turno operar
// (cuando tiene más de un turno activo).
export type PendingTurnoAction =
  | 'confirm_appointment'
  | 'cancel_appointment'
  | 'cancel_and_book_new_appointment'

export interface FlowState {
  type: FlowStateType
  createdAt: string
  // Datos adicionales que puedan necesitarse durante el flujo
  turnoIndex?: number // Cual turno se esta cancelando (si hay multiples)
  // Acción a ejecutar tras una cancelación exitosa.
  // 'book_new'    → iniciar el flujo de reserva de un turno nuevo (opción "Cancelar y solicitar otro turno")
  // 'reschedule'  → redirigir al flujo de reagendamiento (menú "Cancelar el turno médico y solicitar uno nuevo")
  postCancelAction?: 'book_new' | 'reschedule'
  // Acción que el paciente eligió y que se ejecutará tras seleccionar el turno
  // (estado 'awaiting_turno_selection', cuando hay múltiples turnos)
  pendingAction?: PendingTurnoAction
}

// ============================================================================
// REDIS KEYS
// ============================================================================

const CONTEXT_PREFIX = "appointment_context"
const FLOW_STATE_PREFIX = "appointment_flow"
const CONFIRMED_PREFIX = "appointment_confirmed"

// TTLs en segundos
const CONTEXT_TTL = 48 * 60 * 60 // 48 horas - el contexto del turno
// El estado del flujo pendiente (ej: awaiting_cancel_confirmation) debe sobrevivir
// tanto como la ventana en que el paciente puede responder al recordatorio: los
// pacientes contestan el template horas después. Con 30 min se perdía la "memoria"
// del proceso y un "1" tardío se reinterpretaba (peligroso: cancelar → confirmar).
const FLOW_STATE_TTL = 24 * 60 * 60 // 24 horas - el estado del flujo pendiente
const CONFIRMED_TTL = 48 * 60 * 60 // 48 horas - marca de "turno ya confirmado"

function getContextKey(phone: string, configId: string): string {
  return `${CONTEXT_PREFIX}:${configId}:${phone}`
}

function getFlowStateKey(phone: string, configId: string): string {
  return `${FLOW_STATE_PREFIX}:${configId}:${phone}`
}

function getConfirmedKey(phone: string, configId: string): string {
  return `${CONFIRMED_PREFIX}:${configId}:${phone}`
}

/**
 * Devuelve un identificador del turno actual (agenda_id o appointment_id) para
 * poder asociar la marca de "confirmado" a un turno específico. Si el contexto
 * trae un turno nuevo (otro agenda_id) la marca vieja deja de aplicar.
 */
export function getAppointmentRef(chatbotData: ChatbotData | null | undefined): string | undefined {
  if (!chatbotData) return undefined
  const turno = Array.isArray(chatbotData.turnos) && chatbotData.turnos.length > 0
    ? chatbotData.turnos[0]
    : undefined
  return (
    turno?.agenda_id ||
    (chatbotData as unknown as { appointment_id?: string }).appointment_id ||
    undefined
  )
}

// ============================================================================
// MEMO EN MEMORIA DEL CONTEXTO (optimización bandwidth 2026-07-06)
// getAppointmentContext se llama 3-4 veces por mensaje desde los distintos
// interceptores (Sprint 14/16/17, router, pending-flow). Dentro de una misma
// invocación serverless este memo ahorra las lecturas repetidas del contexto
// (~2-10 KB cada una). TTL corto (3s) y toda escritura lo invalida.
// ============================================================================
const contextMemo = new Map<string, { data: ChatbotData | null; expiresAt: number }>()
const CONTEXT_MEMO_TTL_MS = 3000

function invalidateContextMemo(phone: string, configId: string): void {
  contextMemo.delete(getContextKey(phone, configId))
}

// ============================================================================
// CONTEXT FUNCTIONS (Chatbot_Data)
// ============================================================================

/**
 * Guarda el Chatbot_Data estructurado cuando se envia un template
 */
export async function saveAppointmentContext(
  phone: string,
  configId: string,
  chatbotData: ChatbotData
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede guardar contexto")
    return false
  }

  try {
    const key = getContextKey(phone, configId)
    await redis.set(key, JSON.stringify(chatbotData), { ex: CONTEXT_TTL })
    invalidateContextMemo(phone, configId)
    console.log(`[APPOINTMENT-FLOW] Contexto guardado para ${phone} (config: ${configId})`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error guardando contexto:", error)
    return false
  }
}

/**
 * Obtiene el Chatbot_Data guardado para un telefono/config
 */
export async function getAppointmentContext(
  phone: string,
  configId: string
): Promise<ChatbotData | null> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede obtener contexto")
    return null
  }

  try {
    const key = getContextKey(phone, configId)

    // Memo: evitar lecturas repetidas dentro del procesamiento del mismo mensaje.
    // structuredClone para que las mutaciones del caller no contaminen el memo.
    const memoized = contextMemo.get(key)
    if (memoized && memoized.expiresAt > Date.now()) {
      return memoized.data ? structuredClone(memoized.data) : null
    }

    const data = await redis.get<string>(key)

    if (!data) {
      console.log(`[APPOINTMENT-FLOW] No hay contexto para ${phone} (config: ${configId})`)
      contextMemo.set(key, { data: null, expiresAt: Date.now() + CONTEXT_MEMO_TTL_MS })
      return null
    }

    // Redis puede devolver el objeto ya parseado o un string
    const parsed = typeof data === 'object'
      ? (data as unknown as ChatbotData)
      : (JSON.parse(data) as ChatbotData)

    contextMemo.set(key, { data: structuredClone(parsed), expiresAt: Date.now() + CONTEXT_MEMO_TTL_MS })
    return parsed
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error obteniendo contexto:", error)
    return null
  }
}

/**
 * Elimina el contexto del turno por completo (uso legacy / situaciones sin reagendamiento)
 */
export async function clearAppointmentContext(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getContextKey(phone, configId)
    await redis.del(key)
    invalidateContextMemo(phone, configId)
    console.log(`[APPOINTMENT-FLOW] Contexto eliminado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error eliminando contexto:", error)
    return false
  }
}

/**
 * Limpieza selectiva post-cancelación.
 *
 * - Vacía turnos[] y cantidad_turnos → los pre-flows dejan de ver el turno
 * - Copia el turno cancelado a turno_cancelado → disponible para reagendamiento
 * - Cambia tipo_mensaje a "turno_cancelado"
 * - El bloque paciente se preserva intacto
 *
 * @param turnoIndex índice del turno en el array (normalmente 0)
 */
export async function clearAppointmentTurnos(
  phone: string,
  configId: string,
  turnoIndex = 0
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getContextKey(phone, configId)
    const raw = await redis.get<string>(key)

    if (!raw) {
      console.warn(`[APPOINTMENT-FLOW] clearAppointmentTurnos: no hay contexto para ${phone}`)
      return false
    }

    const chatbotData: ChatbotData =
      typeof raw === 'object' ? (raw as unknown as ChatbotData) : JSON.parse(raw)

    const turnoACancelar = chatbotData.turnos[turnoIndex]

    // Guardar snapshot del turno cancelado antes de vaciar el array
    if (turnoACancelar) {
      chatbotData.turno_cancelado = {
        fecha: turnoACancelar.fecha,
        hora: turnoACancelar.hora,
        profesional: turnoACancelar.profesional,
        profesional_id: turnoACancelar.profesional_id,
        sede: turnoACancelar.sede,
        sede_id: turnoACancelar.sede_id || chatbotData.sede_id || '',
        direccion: turnoACancelar.direccion,
        agenda_id: turnoACancelar.agenda_id,
      }
    }

    // Vaciar turnos activos
    chatbotData.turnos = []
    chatbotData.cantidad_turnos = 0
    chatbotData.tipo_mensaje = 'turno_cancelado'

    await redis.set(key, JSON.stringify(chatbotData), { ex: CONTEXT_TTL })
    invalidateContextMemo(phone, configId)

    // El turno fue cancelado: la marca de "confirmado" ya no aplica
    try {
      await redis.del(getConfirmedKey(phone, configId))
    } catch {
      // best-effort
    }

    console.log(`[APPOINTMENT-FLOW] Turnos limpiados para ${phone}, turno_cancelado preservado`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error en clearAppointmentTurnos:", error)
    return false
  }
}

// ============================================================================
// CONFIRMED MARKER FUNCTIONS
// ============================================================================

/**
 * Marca que el turno activo del paciente YA fue confirmado.
 * Se usa para no volver a ofrecer "Confirmar asistencia" cuando el paciente
 * escribe texto libre después de haber confirmado (ej: "¿puedo obtener otro turno?").
 *
 * @param appointmentRef agenda_id / appointment_id del turno confirmado (opcional)
 */
export async function markAppointmentConfirmed(
  phone: string,
  configId: string,
  appointmentRef?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getConfirmedKey(phone, configId)
    await redis.set(key, appointmentRef || "1", { ex: CONFIRMED_TTL })
    console.log(`[APPOINTMENT-FLOW] Turno marcado como confirmado para ${phone} (ref: ${appointmentRef || "n/a"})`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error marcando turno confirmado:", error)
    return false
  }
}

/**
 * Indica si el turno activo del paciente ya fue confirmado.
 * Si se provee appointmentRef y la marca guardada tiene una referencia distinta
 * (es decir, corresponde a otro turno), se considera NO confirmado.
 */
export async function isAppointmentConfirmed(
  phone: string,
  configId: string,
  appointmentRef?: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getConfirmedKey(phone, configId)
    const stored = await redis.get<string>(key)
    if (!stored) return false

    const storedRef = typeof stored === "string" ? stored : String(stored)

    // Marca genérica (sin ref) → aplica a cualquier turno activo
    if (storedRef === "1") return true

    // Si tenemos ref del turno actual, exigir coincidencia con la marca guardada
    if (appointmentRef) return storedRef === appointmentRef

    // Sin ref para comparar, asumimos que la marca aplica
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error leyendo marca de confirmación:", error)
    return false
  }
}

/**
 * Elimina la marca de "turno confirmado" (uso tras cancelación o nuevo turno).
 */
export async function clearAppointmentConfirmed(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getConfirmedKey(phone, configId)
    await redis.del(key)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error eliminando marca de confirmación:", error)
    return false
  }
}

// ============================================================================
// FLOW STATE FUNCTIONS
// ============================================================================

/**
 * Establece el estado del flujo pendiente (ej: esperando confirmacion de cancelacion)
 */
export async function setFlowState(
  phone: string,
  configId: string,
  state: FlowState
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT-FLOW] Redis no disponible, no se puede guardar estado de flujo")
    return false
  }

  try {
    const key = getFlowStateKey(phone, configId)
    await redis.set(key, JSON.stringify(state), { ex: FLOW_STATE_TTL })
    console.log(`[APPOINTMENT-FLOW] Estado de flujo '${state.type}' guardado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error guardando estado de flujo:", error)
    return false
  }
}

/**
 * Obtiene el estado del flujo pendiente
 */
export async function getFlowState(
  phone: string,
  configId: string
): Promise<FlowState | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const key = getFlowStateKey(phone, configId)
    const data = await redis.get<string>(key)
    
    if (!data) return null

    // Redis puede devolver el objeto ya parseado o un string
    const raw: any = typeof data === 'object' ? data : JSON.parse(data)
    
    // Compatibilidad con estados guardados con campo "state" en lugar de "type"
    // (Bug en versiones anteriores donde setFlowState recibía { state: ..., timestamp: ... })
    if (raw && !raw.type && raw.state) {
      raw.type = raw.state as FlowStateType
      if (!raw.createdAt) {
        raw.createdAt = raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString()
      }
    }
    
    // Si sigue sin tipo reconocido, descartar el estado para evitar bucles
    if (!raw || !raw.type || (raw.type !== 'awaiting_cancel_confirmation' && raw.type !== 'awaiting_reschedule_choice' && raw.type !== 'awaiting_cancel_and_reschedule_confirm' && raw.type !== 'awaiting_turno_selection' && raw.type !== 'awaiting_cancel_all_confirmation')) {
      console.warn(`[APPOINTMENT-FLOW] Estado de flujo corrupto o desconocido descartado para ${phone}:`, raw)
      // Limpiar la clave para evitar que bloquee futuras requests
      const redis2 = getRedisClient()
      if (redis2) await redis2.del(getFlowStateKey(phone, configId))
      return null
    }

    return raw as FlowState
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error obteniendo estado de flujo:", error)
    return null
  }
}

/**
 * Limpia el estado del flujo (cuando se completa o se abandona)
 */
export async function clearFlowState(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  try {
    const key = getFlowStateKey(phone, configId)
    await redis.del(key)
    console.log(`[APPOINTMENT-FLOW] Estado de flujo limpiado para ${phone}`)
    return true
  } catch (error) {
    console.error("[APPOINTMENT-FLOW] Error limpiando estado de flujo:", error)
    return false
  }
}

// ============================================================================
// CLINICA CANCELLATION OFFER STATE
// Rastrea si ofrecimos al paciente reagendar tras una cancelación iniciada por la clínica.
// TTL corto (1 hora): si el paciente no responde rápido, el contexto expira.
// ============================================================================

const CLINICA_OFFER_PREFIX = "clinica_cancel_offer"
const CLINICA_OFFER_TTL = 60 * 60 // 1 hora

/**
 * Datos que persistimos junto a la oferta/seguimiento post-template de clínica.
 * - kind: 'cancelled' (con oferta 1/2 de nuevo turno) | 'confirmed' (solo seguimiento).
 * - telefonoContacto: teléfono de la clínica para derivar consultas que el bot no puede responder.
 */
export interface ClinicaFollowupData {
  kind: 'cancelled' | 'confirmed'
  telefonoContacto?: string
}

export async function saveClinicaCancellationOffer(
  phone: string,
  configId: string,
  data?: ClinicaFollowupData
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const payload = JSON.stringify({
      kind: data?.kind || 'cancelled',
      telefonoContacto: data?.telefonoContacto || '',
    })
    await redis.set(`${CLINICA_OFFER_PREFIX}:${configId}:${phone}`, payload, { ex: CLINICA_OFFER_TTL })
    return true
  } catch { return false }
}

export async function getClinicaCancellationOffer(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const val = await redis.get<string>(`${CLINICA_OFFER_PREFIX}:${configId}:${phone}`)
    return val !== null && val !== undefined
  } catch { return false }
}

/**
 * Devuelve los datos de la oferta/seguimiento post-template (o null si no hay).
 * Tolera el formato viejo ('1') y el objeto ya parseado por Upstash.
 */
export async function getClinicaFollowupData(
  phone: string,
  configId: string
): Promise<ClinicaFollowupData | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const val = await redis.get(`${CLINICA_OFFER_PREFIX}:${configId}:${phone}`)
    if (val === null || val === undefined) return null
    if (typeof val === 'object') return val as ClinicaFollowupData // Upstash ya lo parseó
    if (typeof val === 'string') {
      if (val === '1') return { kind: 'cancelled' } // formato viejo
      try {
        return JSON.parse(val) as ClinicaFollowupData
      } catch {
        return { kind: 'cancelled' }
      }
    }
    return { kind: 'cancelled' }
  } catch {
    return null
  }
}

export async function clearClinicaCancellationOffer(
  phone: string,
  configId: string
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    await redis.del(`${CLINICA_OFFER_PREFIX}:${configId}:${phone}`)
    return true
  } catch { return false }
}

// ============================================================================
// BOTONES DEL PASO ACTUAL
// Guarda los botones del último paso mostrado, para poder re-mostrarlos (con botones)
// cuando el router responde una consulta intercalada y retoma el paso.
// ============================================================================

const STEP_BUTTONS_PREFIX = "step_buttons"
const STEP_BUTTONS_TTL = 60 * 60 // 1 hora

export async function saveStepButtons(
  phone: string,
  configId: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    const key = `${STEP_BUTTONS_PREFIX}:${configId}:${phone}`
    if (buttons && buttons.length > 0) {
      await redis.set(key, JSON.stringify(buttons), { ex: STEP_BUTTONS_TTL })
    } else {
      await redis.del(key)
    }
  } catch {
    /* noop */
  }
}

export async function getStepButtons(
  phone: string,
  configId: string,
): Promise<Array<{ id: string; title: string }> | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const val = await redis.get(`${STEP_BUTTONS_PREFIX}:${configId}:${phone}`)
    if (!val) return null
    if (Array.isArray(val)) return val as Array<{ id: string; title: string }>
    if (typeof val === "string") return JSON.parse(val)
    return null
  } catch {
    return null
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Detecta si el mensaje expresa intenci\u00f3n de ASISTIR al turno
 * (aunque venga mezclado con afirmaciones: "si si voy!!", "confirmo asistencia").
 *
 * Se usa como GUARDA en la doble confirmaci\u00f3n de cancelaci\u00f3n: cualquier se\u00f1al
 * de asistencia anula la interpretaci\u00f3n como "s\u00ed, cancelar". Cancelar un turno
 * es irreversible (lo borra de la base), mantenerlo no \u2014 ante ambig\u00fcedad, se mantiene.
 *
 * Tolerante a typos frecuentes: "asisencia", "asistensia" (v\u00eda \basis\w*).
 */
export function isAttendanceAffirmation(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // Negaciones o menciones de cancelar anulan la se\u00f1al de asistencia
  // ("no voy", "no puedo asistir", "si, cancelar")
  if (/\bno\b/.test(normalized)) return false
  if (/cancel/.test(normalized)) return false

  const attendancePatterns = [
    /\bvoy\b/,                          // "voy", "si si voy!!", "ahi voy"
    /\bire\b/,                          // "ire" (ir\u00e9 sin acento)
    /\basis\w*/,                        // "asisto", "asistire", "asistencia", "asisencia" (typo)
    /\bestare\b/,                       // "estare", "ahi estare"
    /^confirmar\.?!*$/,                 // bot\u00f3n "Confirmar" del template de recordatorio
    /confirmo\s+(mi\s+|la\s+)?asis\w*/, // "confirmo asistencia" (y typos)
    /confirmo\s+(el\s+)?turno/,         // "confirmo el turno"
    /mantener/,                         // "mantener el turno"
  ]
  return attendancePatterns.some(pattern => pattern.test(normalized))
}

/**
 * Detecta si una respuesta del usuario confirma la CANCELACI\u00d3N del turno.
 *
 * POL\u00cdTICA ESTRICTA (incidentes 2026-07-05): la cancelaci\u00f3n borra el turno de la
 * base de datos y es irreversible. Solo se acepta como confirmaci\u00f3n:
 *   - "1" (la opci\u00f3n expl\u00edcita)
 *   - un "si"/"s\u00ed" EXACTO y solo (respuesta directa a "1- S\u00ed, cancelar el turno")
 *   - un mensaje que contenga la palabra "cancelar"/"cancelo"/"cancelaci\u00f3n" sin negaci\u00f3n
 *
 * Todo lo dem\u00e1s ("si gracias", "ok", "dale", "confirmo", "si si voy") NO cancela:
 * cae al NLU contextual o al re-prompt. Adem\u00e1s, cualquier se\u00f1al de asistencia
 * (isAttendanceAffirmation) anula la cancelaci\u00f3n aunque contenga afirmaciones.
 */
export function isConfirmCancelResponse(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .trim()

  // GUARDA 1: se\u00f1al de asistencia \u2192 jam\u00e1s interpretar como cancelaci\u00f3n
  if (isAttendanceAffirmation(message)) return false

  // GUARDA 2: negaci\u00f3n de cancelar ("no quiero cancelar", "no cancelen", "no lo cancelo")
  if (/\bno\b[\s\S]{0,30}cancel/.test(normalized)) return false

  const confirmPatterns = [
    /^1\.?$/,       // "1" o "1."
    /^si\.?!*$/,    // "si" EXACTO (nada m\u00e1s) \u2014 respuesta directa a "1- S\u00ed, cancelar"
    /cancel/,       // contiene "cancelar", "cancelo", "cancelen", "cancelacion", "si, cancelar"
    /^no\s+(puedo|voy|ire|asistire|asisto)\b/, // no-asistencia inequ\u00edvoca: "no puedo ir", "no voy a poder"
  ]

  return confirmPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Detecta si una respuesta del usuario es para mantener el turno ("2", "no", etc).
 *
 * Maneja respuestas compuestas (ej: "no gracias", "no, prefiero mantener") que contienen
 * la negaci\u00f3n como primer token significativo.
 */
export function isKeepAppointmentResponse(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // "no puedo ir" / "no voy" / "no asistire" NO es mantener: es no-asistencia
  // (la maneja isConfirmCancelResponse). Sin esta guarda, un "no puedo ir" en la
  // doble confirmación mantendría el turno Y confirmaría asistencia — lo contrario
  // de lo que el paciente dijo.
  if (/^no\s+(puedo|voy|ire|asistire|asisto)\b/.test(normalized)) return false

  const keepPatterns = [
    /^2\.?$/,              // "2" o "2."
    /^no\b/,               // empieza con "no" (cubre "no gracias", "no, prefiero", etc.)
    /^n$/,                 // "n"
    /^nop(e)?\b/,          // "nope", "nop"
    /mantener/,            // contiene "mantener"
  ]

  return keepPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Detecta si el usuario quiere reagendar ("1") o no reagendar ("2")
 * despues de una cancelacion exitosa
 */
export function isRescheduleChoice(message: string): 'reschedule' | 'no_reschedule' | null {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // Quiere reagendar
  if (/^1\.?$/.test(normalized) || /reagendar/.test(normalized)) {
    return 'reschedule'
  }

  // No quiere reagendar
  if (/^2\.?$/.test(normalized) || /no\s*(quiero\s*)?reagendar/.test(normalized)) {
    return 'no_reschedule'
  }

  return null
}

/**
 * Detecta la elección del paciente en el menú de 2 opciones para reagendar
 * cuando hay un turno activo (debe cancelar primero y luego sacar uno nuevo).
 *
 * Menú mostrado:
 *   1- Confirmar asistencia al turno médico
 *   2- Cancelar el turno médico y solicitar uno nuevo
 *
 * Retorna:
 *   'confirm_attendance' → El paciente quiere confirmar asistencia (opción 1)
 *   'cancel_and_reschedule' → El paciente quiere cancelar y sacar turno nuevo (opción 2)
 *   null → No se reconoció la respuesta
 */
export function isCancelAndRescheduleChoice(message: string): 'confirm_attendance' | 'cancel_and_reschedule' | null {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

  // Opción 1: confirmar asistencia
  if (/^1\.?$/.test(normalized) || /confirm|asistir|asistire|ahi voy|ahi estare|voy a ir/.test(normalized)) {
    return 'confirm_attendance'
  }

  // Opción 2: cancelar y sacar nuevo turno
  if (/^2\.?$/.test(normalized) || /cancel|nuevo turno|otro turno|cambiar|cambio|reagendar/.test(normalized)) {
    return 'cancel_and_reschedule'
  }

  return null
}
