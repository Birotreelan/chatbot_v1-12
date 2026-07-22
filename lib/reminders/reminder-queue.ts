/**
 * lib/reminders/reminder-queue.ts
 *
 * Coordina dos cosas en Redis para los recordatorios de reintento:
 *
 * 1) El contador secuencial de la ventana del "segundo recordatorio": muchos
 *    turnos distintos caen en la MISMA ventana fija (ej: todos los turnos de
 *    mañana del 24/07 comparten la ventana 18:30-20:30 del 23/07). Para no
 *    mandar todos esos recordatorios en el mismo segundo, cada uno toma el
 *    siguiente "turno de salida" dentro de la ventana (10:00:00, 10:00:01, ...)
 *    vía un INCR atómico.
 *
 * 2) La cola de recordatorios pendientes por paciente (messageIds de QStash),
 *    para poder cancelarlos en bloque apenas el paciente responde algo.
 */

import { getRedisClient } from "../redis"
import { logger } from "../logger"
import { cancelQStashMessages } from "../queue"
import type { PlannedReminder } from "./schedule-calculator"

const WINDOW_COUNTER_PREFIX = "reminder_window_counter"
const REMINDER_QUEUE_PREFIX = "reminder_queue"

export type ReminderKind = PlannedReminder["kind"]

export interface QueuedReminder {
  messageId: string
  kind: ReminderKind
  sendAtUnix: number
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

// ============================================================================
// CONTADOR DE VENTANA (segundo recordatorio)
// ============================================================================

/**
 * Asigna el próximo segundo disponible dentro de la ventana del segundo
 * recordatorio para este cliente. Si Redis no está disponible o algo falla,
 * degrada a "inicio de ventana" en vez de romper todo el encolado.
 */
export async function assignSegundoRecordatorioSlot(
  configId: string,
  ventanaKey: string,
  ventanaInicioUnix: number,
  ventanaFinUnix: number,
): Promise<number> {
  const duracionSegundos = Math.max(1, ventanaFinUnix - ventanaInicioUnix)
  const redis = getRedisClient()
  if (!redis) return ventanaInicioUnix

  try {
    const counterKey = `${WINDOW_COUNTER_PREFIX}:${configId}:${ventanaKey}`
    const indice = await redis.incr(counterKey)

    // TTL solo la primera vez que se crea la key (no pisar el TTL en cada incremento)
    if (indice === 1) {
      const ttl = Math.max(60, ventanaFinUnix - nowUnix() + 3600)
      await redis.expire(counterKey, ttl)
    }

    // indice arranca en 1 -> el primer mensaje sale en el segundo 0 de la ventana
    const offsetSegundos = Math.min(indice - 1, duracionSegundos - 1)
    return ventanaInicioUnix + offsetSegundos
  } catch (error) {
    logger.warn("REMINDERS", "Error asignando slot de segundo recordatorio, se usa inicio de ventana", error as Error)
    return ventanaInicioUnix
  }
}

// ============================================================================
// COLA DE RECORDATORIOS PENDIENTES POR PACIENTE
// ============================================================================

function getQueueKey(configId: string, phone: string): string {
  return `${REMINDER_QUEUE_PREFIX}:${configId}:${phone}`
}

/**
 * Guarda (reemplazando) la cola completa de recordatorios pendientes de un
 * paciente. Se llama una vez, después de programar todos los recordatorios de
 * una tanda en QStash.
 */
export async function saveReminderQueue(
  configId: string,
  phone: string,
  reminders: QueuedReminder[],
): Promise<void> {
  if (reminders.length === 0) return
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = getQueueKey(configId, phone)
    const maxSendAt = Math.max(...reminders.map((r) => r.sendAtUnix))
    const ttl = Math.max(60, maxSendAt - nowUnix() + 3600)
    await redis.set(key, JSON.stringify(reminders), { ex: ttl })
    logger.info("REMINDERS", `Cola guardada para ${phone}: ${reminders.length} recordatorio(s)`)
  } catch (error) {
    logger.warn("REMINDERS", "Error guardando cola de recordatorios", error as Error)
  }
}

export async function getReminderQueue(configId: string, phone: string): Promise<QueuedReminder[]> {
  const redis = getRedisClient()
  if (!redis) return []

  try {
    const key = getQueueKey(configId, phone)
    const raw = await redis.get(key)
    if (!raw) return []
    return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as QueuedReminder[])
  } catch (error) {
    logger.warn("REMINDERS", "Error leyendo cola de recordatorios", error as Error)
    return []
  }
}

/**
 * Quita un recordatorio puntual de la cola (se llama desde el endpoint de
 * entrega, justo después de reenviar exitosamente uno de los recordatorios).
 */
export async function removeReminderFromQueue(
  configId: string,
  phone: string,
  messageId: string,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  try {
    const key = getQueueKey(configId, phone)
    const actuales = await getReminderQueue(configId, phone)
    const restantes = actuales.filter((r) => r.messageId !== messageId)

    if (restantes.length === 0) {
      await redis.del(key)
    } else {
      const maxSendAt = Math.max(...restantes.map((r) => r.sendAtUnix))
      const ttl = Math.max(60, maxSendAt - nowUnix() + 3600)
      await redis.set(key, JSON.stringify(restantes), { ex: ttl })
    }
  } catch (error) {
    logger.warn("REMINDERS", "Error actualizando cola de recordatorios", error as Error)
  }
}

/**
 * Cancela (bulk, una sola llamada a QStash) todos los recordatorios
 * pendientes de un paciente y limpia la cola en Redis. Se dispara ante
 * CUALQUIER respuesta del paciente — ver hook en lib/whatsapp.tsx.
 */
export async function cancelPendingReminders(configId: string, phone: string): Promise<void> {
  const reminders = await getReminderQueue(configId, phone)
  if (reminders.length === 0) return

  try {
    await cancelQStashMessages(reminders.map((r) => r.messageId))
    logger.info("REMINDERS", `Cancelados ${reminders.length} recordatorio(s) pendiente(s) para ${phone} (respondió)`)
  } catch (error) {
    logger.warn("REMINDERS", "Error cancelando recordatorios en QStash", error as Error)
  } finally {
    const redis = getRedisClient()
    if (redis) {
      try {
        await redis.del(getQueueKey(configId, phone))
      } catch {
        /* best-effort */
      }
    }
  }
}
