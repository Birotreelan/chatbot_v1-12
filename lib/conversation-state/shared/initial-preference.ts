/**
 * lib/conversation-state/shared/initial-preference.ts
 *
 * Preferencia de día/horario expresada por el paciente en su PRIMER mensaje,
 * para aplicarla automáticamente a la primera lista de turnos que se le muestra.
 *
 * Motivo (27/8/2026, análisis de 349 conversaciones reales): los pacientes de
 * mayor intención abren la charla diciendo exactamente lo que quieren y el bot
 * descartaba todo ese contenido para mostrarles el menú genérico. Casos reales:
 *
 *   "Quería ver si el Dr Lucas tiene disponibilidad para verme mañana a la
 *    tarde o el viernes"           → el bot respondió con el menú principal
 *   "turno con el dr Scalise Claudio, un lunes por la mañana"
 *   "quiero un turno para las 15:30 en la sede de 56 con la Dra Vázquez"
 *
 * El profesional y la especialidad ya se aprovechaban (slots del dispatcher);
 * lo que se perdía era el día/franja horaria. Esto lo guarda al iniciar la
 * reserva y lo consume una sola vez, cuando llega la lista de turnos.
 *
 * Se reutiliza `detectTurnoFilter` — el mismo extractor que ya funciona cuando
 * el paciente filtra la lista ya mostrada ("¿tenés algo por la tarde?"), así
 * que la semántica de interpretación es idéntica y no hay lógica duplicada.
 */

import { getRedisClient } from '@/lib/redis'
import { recordDiag, recordDiagSample, DIAG } from '@/lib/diagnostics'
import { detectTurnoFilter } from './turno-filter-extractor'
import type { TurnoOption } from './types'

const PREF_PREFIX = 'initial_turno_pref:'
// Ventana corta: es una preferencia de ESTA gestión, no un perfil permanente.
const PREF_TTL = 30 * 60 // 30 minutos

// Si el filtro deja menos turnos que esto, se muestra la lista completa. Es
// preferible que el paciente vea opciones de más y filtre él, a que crea que
// "no hay turnos" porque interpretamos de más su preferencia.
const MIN_RESULTADOS_PARA_APLICAR = 3

function key(phone: string): string {
  return `${PREF_PREFIX}${phone}`
}

/**
 * Guarda la preferencia en crudo (texto tal cual lo dijo el paciente).
 * No-op si no hay texto o Redis no está disponible.
 */
export async function saveInitialTurnoPreference(phone: string, preferencia?: string): Promise<void> {
  const texto = (preferencia || '').trim()
  if (!texto) return

  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.setex(key(phone), PREF_TTL, texto)
    console.info(`[INITIAL-PREF] Preferencia guardada para ${phone}: "${texto.slice(0, 60)}"`)
    void recordDiag(undefined, DIAG.PREFERENCIA_GUARDADA)
  } catch (error) {
    console.error('[INITIAL-PREF] Error guardando preferencia:', error)
  }
}

/** Lee y borra la preferencia (uso único). */
async function consumeInitialTurnoPreference(phone: string): Promise<string | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null
    const k = key(phone)
    const valor = await redis.get(k)
    if (!valor) return null
    await redis.del(k)
    return typeof valor === 'string' ? valor : String(valor)
  } catch (error) {
    console.error('[INITIAL-PREF] Error leyendo preferencia:', error)
    return null
  }
}

export interface PreferenciaAplicada {
  /** Turnos a mostrar (filtrados si la preferencia aplicó, completos si no). */
  turnos: TurnoOption[]
  /** true solo si efectivamente se filtró. */
  aplicada: boolean
  /** Texto legible del filtro aplicado, para poder avisarle al paciente. */
  descripcion?: string
}

/**
 * Aplica (una sola vez) la preferencia inicial sobre la lista de turnos recién
 * buscada. Ante cualquier duda devuelve la lista completa sin tocar: este
 * camino nunca debe hacer que el paciente vea menos opciones de las que hay
 * por una interpretación equivocada.
 */
export async function applyInitialTurnoPreference(
  phone: string,
  turnos: TurnoOption[],
): Promise<PreferenciaAplicada> {
  if (!Array.isArray(turnos) || turnos.length === 0) {
    return { turnos, aplicada: false }
  }

  const preferencia = await consumeInitialTurnoPreference(phone)
  if (!preferencia) return { turnos, aplicada: false }

  try {
    const resultado = await detectTurnoFilter(preferencia, turnos)

    if (resultado.type === 'filtered' && resultado.turnos.length >= MIN_RESULTADOS_PARA_APLICAR) {
      console.info(
        `[INITIAL-PREF] Preferencia aplicada para ${phone}: ${turnos.length} → ${resultado.turnos.length} turnos (${resultado.criteria.descripcion})`,
      )
      void recordDiag(undefined, DIAG.PREFERENCIA_APLICADA)
      return { turnos: resultado.turnos, aplicada: true, descripcion: resultado.criteria.descripcion }
    }

    console.info(
      `[INITIAL-PREF] Preferencia NO aplicada para ${phone} (tipo: ${resultado.type}) — se muestra la lista completa`,
    )
    // Se muestrea: si la preferencia se descarta seguido, el extractor no está
    // entendiendo cómo hablan los pacientes y hay que revisarlo.
    void recordDiag(undefined, DIAG.PREFERENCIA_DESCARTADA)
    void recordDiagSample({
      tipo: DIAG.PREFERENCIA_DESCARTADA,
      mensaje: preferencia,
      detalle: { motivo: resultado.type, turnosDisponibles: turnos.length },
    })
    return { turnos, aplicada: false }
  } catch (error) {
    console.error('[INITIAL-PREF] Error aplicando preferencia (se muestra lista completa):', error)
    return { turnos, aplicada: false }
  }
}
