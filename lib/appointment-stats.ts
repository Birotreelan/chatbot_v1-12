import { Redis } from "@upstash/redis"
import type { AppointmentEvent, ClientAppointmentStats } from "./types"
import { getAllWhatsAppConfigs } from "./db"

// Prefijos para las claves en Redis
const APPOINTMENT_EVENT_PREFIX = "appointment_event:"
const APPOINTMENT_STATS_PREFIX = "appointment_stats:"
const TEMPLATE_TRACKING_PREFIX = "template_tracking:"
const PENDING_RESCHEDULE_PREFIX = "pending_reschedule:"
const ACTIVE_USER_CONVERSATION_PREFIX = "active_user_conversation:"

// Ventana de tiempo para considerar un reagendamiento como válido (12 horas en segundos)
const RESCHEDULE_WINDOW_SECONDS = 12 * 60 * 60 // 12 horas

// Ventana de tiempo para conversaciones user-initiated (24 horas en segundos)
const USER_CONVERSATION_WINDOW_SECONDS = 24 * 60 * 60 // 24 horas

// Obtener cliente de Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("[APPOINTMENT_STATS] Upstash Redis no está disponible:", error)
    return null
  }
}

// Registrar evento de turno
export async function trackAppointmentEvent(event: Omit<AppointmentEvent, "id">): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT_STATS] Redis no disponible, no se puede trackear evento")
    return
  }

  try {
    const eventId = `${event.clienteId}_${event.phoneNumber}_${Date.now()}`
    const fullEvent: AppointmentEvent = {
      ...event,
      id: eventId,
    }

    console.log(`[APPOINTMENT_STATS] 📊 Registrando evento: ${event.eventType} para cliente ${event.clienteId}`)
    console.log(`[APPOINTMENT_STATS] 📊 Datos del evento:`, JSON.stringify(fullEvent, null, 2))

    // Guardar evento individual (para auditoría)
    const eventKey = `${APPOINTMENT_EVENT_PREFIX}${eventId}`
    await redis.set(eventKey, JSON.stringify(fullEvent), { ex: 60 * 60 * 24 * 90 }) // 90 días
    console.log(`[APPOINTMENT_STATS] ✅ Evento individual guardado en: ${eventKey}`)

    // Actualizar estadísticas agregadas
    await updateAggregatedStats(event.clienteId, fullEvent)

    console.log(`[APPOINTMENT_STATS] ✅ Evento registrado exitosamente: ${eventId}`)
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al trackear evento:", error)
  }
}

// Actualizar estadísticas agregadas
async function updateAggregatedStats(clienteId: string, event: AppointmentEvent): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const statsKey = `${APPOINTMENT_STATS_PREFIX}${clienteId}`
  const eventDate = new Date(event.timestamp)
  const date = eventDate.toISOString().split("T")[0] // YYYY-MM-DD en UTC

  try {
    console.log(`[APPOINTMENT_STATS] 📈 Actualizando estadísticas agregadas para ${clienteId}`)
    console.log(`[APPOINTMENT_STATS] 📈 Clave de stats: ${statsKey}`)
    console.log(`[APPOINTMENT_STATS] 📈 Tipo de evento: ${event.eventType}`)
    console.log(`[APPOINTMENT_STATS] 📈 Fecha UTC: ${date}`)

    // Incrementar contadores según el tipo de evento
    switch (event.eventType) {
      case "template_sent":
        await redis.hincrby(statsKey, "totalTemplatesSent", 1)
        await redis.hincrby(`${statsKey}:daily:templates`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalTemplatesSent`)
        break

      case "confirmed":
        await redis.hincrby(statsKey, "totalConfirmed", 1)
        await redis.hincrby(`${statsKey}:daily:confirmed`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalConfirmed`)

        // Calcular tiempo de respuesta si tenemos templateSentAt
        if (event.templateSentAt) {
          const responseTime = new Date(event.timestamp).getTime() - new Date(event.templateSentAt).getTime()
          const responseTimeMinutes = Math.round(responseTime / 1000 / 60)

          await redis.lpush(`${statsKey}:response_times:confirmed`, responseTimeMinutes)
          await redis.ltrim(`${statsKey}:response_times:confirmed`, 0, 999) // Mantener últimos 1000

          await redis.lpush(`${statsKey}:response_times:confirmed:${date}`, responseTimeMinutes)
          await redis.ltrim(`${statsKey}:response_times:confirmed:${date}`, 0, 999)
          // Registrar que existe data para esta fecha
          await redis.sadd(`${statsKey}:response_times:confirmed:dates`, date)

          console.log(
            `[APPOINTMENT_STATS] ✅ Tiempo de respuesta registrado: ${responseTimeMinutes} minutos para fecha ${date}`,
          )
        }
        break

      case "cancelled":
        await redis.hincrby(statsKey, "totalCancelled", 1)
        await redis.hincrby(`${statsKey}:daily:cancelled`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalCancelled`)

        // Calcular tiempo de respuesta
        if (event.templateSentAt) {
          const responseTime = new Date(event.timestamp).getTime() - new Date(event.templateSentAt).getTime()
          const responseTimeMinutes = Math.round(responseTime / 1000 / 60)

          await redis.lpush(`${statsKey}:response_times:cancelled`, responseTimeMinutes)
          await redis.ltrim(`${statsKey}:response_times:cancelled`, 0, 999)

          await redis.lpush(`${statsKey}:response_times:cancelled:${date}`, responseTimeMinutes)
          await redis.ltrim(`${statsKey}:response_times:cancelled:${date}`, 0, 999)
          // Registrar que existe data para esta fecha
          await redis.sadd(`${statsKey}:response_times:cancelled:dates`, date)

          console.log(
            `[APPOINTMENT_STATS] ✅ Tiempo de respuesta registrado: ${responseTimeMinutes} minutos para fecha ${date}`,
          )
        }
        break

      case "rescheduled":
        await redis.hincrby(statsKey, "totalRescheduled", 1)
        await redis.hincrby(`${statsKey}:daily:rescheduled`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalRescheduled`)
        break

      case "user_initiated":
        await redis.hincrby(statsKey, "totalUserInitiated", 1)
        await redis.hincrby(`${statsKey}:daily:user_initiated`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalUserInitiated - conversación iniciada por usuario`)
        break

      case "new_appointment":
        await redis.hincrby(statsKey, "totalNewAppointments", 1)
        await redis.hincrby(`${statsKey}:daily:new_appointments`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalNewAppointments - turno nuevo sin cancelación previa`)
        break

      case "reschedule_started":
        await redis.hincrby(statsKey, "totalRescheduleStarted", 1)
        await redis.hincrby(`${statsKey}:daily:reschedule_started`, date, 1)
        console.log(`[APPOINTMENT_STATS] ✅ Incrementado totalRescheduleStarted - inicio de proceso de reagendamiento`)
        break
    }

    // Actualizar timestamp de última actualización
    await redis.hset(statsKey, "lastUpdated", new Date().toISOString())

    console.log(`[APPOINTMENT_STATS] ✅ Estadísticas actualizadas para cliente ${clienteId}`)
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al actualizar estadísticas agregadas:", error)
  }
}

async function getClientNameByClienteId(clienteId: string): Promise<string> {
  try {
    const configs = await getAllWhatsAppConfigs()
    const config = configs.find((c) => c.cliente_id === clienteId)
    return config?.displayName || "Cliente Desconocido"
  } catch (error) {
    console.error("[APPOINTMENT_STATS] Error al obtener nombre del cliente:", error)
    return "Cliente Desconocido"
  }
}

// Obtener estadísticas de turnos por cliente
export async function getAppointmentStatsByClienteId(clienteId: string): Promise<ClientAppointmentStats | null> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT_STATS] Redis no disponible")
    return null
  }

  try {
    console.log(`[APPOINTMENT_STATS] 📊 Obteniendo estadísticas para cliente ${clienteId}`)

    const statsKey = `${APPOINTMENT_STATS_PREFIX}${clienteId}`
    console.log(`[APPOINTMENT_STATS] 📊 Clave de stats: ${statsKey}`)

    // Obtener totales
    const totals = (await redis.hgetall(statsKey)) as Record<string, string>
    console.log(`[APPOINTMENT_STATS] 📊 Totales obtenidos:`, JSON.stringify(totals, null, 2))

    if (!totals || Object.keys(totals).length === 0) {
      console.log(`[APPOINTMENT_STATS] ⚠️ No hay estadísticas para cliente ${clienteId}`)
      return null
    }

    // Obtener datos diarios (últimos 30 días)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const confirmedByDay = (await redis.hgetall(`${statsKey}:daily:confirmed`)) as Record<string, number>
    const cancelledByDay = (await redis.hgetall(`${statsKey}:daily:cancelled`)) as Record<string, number>
    const rescheduledByDay = (await redis.hgetall(`${statsKey}:daily:rescheduled`)) as Record<string, number>
    const templatesSentByDay = (await redis.hgetall(`${statsKey}:daily:templates`)) as Record<string, number>
    const userInitiatedByDay = (await redis.hgetall(`${statsKey}:daily:user_initiated`)) as Record<string, number>
    const newAppointmentsByDay = (await redis.hgetall(`${statsKey}:daily:new_appointments`)) as Record<string, number>
    const rescheduleStartedByDay = (await redis.hgetall(`${statsKey}:daily:reschedule_started`)) as Record<string, number>

    // Calcular tiempos promedio
    const confirmedTimes = (await redis.lrange(`${statsKey}:response_times:confirmed`, 0, -1)) as number[]
    const cancelledTimes = (await redis.lrange(`${statsKey}:response_times:cancelled`, 0, -1)) as number[]

    const avgConfirmationTime =
      confirmedTimes.length > 0
        ? confirmedTimes.reduce((sum, time) => sum + Number(time), 0) / confirmedTimes.length
        : 0

    const avgCancellationTime =
      cancelledTimes.length > 0
        ? cancelledTimes.reduce((sum, time) => sum + Number(time), 0) / cancelledTimes.length
        : 0

    const allResponseTimes = [...confirmedTimes, ...cancelledTimes]
    const avgResponseTime =
      allResponseTimes.length > 0
        ? allResponseTimes.reduce((sum, time) => sum + Number(time), 0) / allResponseTimes.length
        : 0

    // Calcular tasas de conversión
    const totalTemplatesSent = Number(totals.totalTemplatesSent) || 0
    const totalConfirmed = Number(totals.totalConfirmed) || 0
    const totalCancelled = Number(totals.totalCancelled) || 0
    const totalRescheduled = Number(totals.totalRescheduled) || 0
    const totalUserInitiated = Number(totals.totalUserInitiated) || 0
    const totalNewAppointments = Number(totals.totalNewAppointments) || 0
    const totalRescheduleStarted = Number(totals.totalRescheduleStarted) || 0

    const confirmationRate = totalTemplatesSent > 0 ? (totalConfirmed / totalTemplatesSent) * 100 : 0
    const cancellationRate = totalTemplatesSent > 0 ? (totalCancelled / totalTemplatesSent) * 100 : 0
    const responseRate = totalTemplatesSent > 0 ? ((totalConfirmed + totalCancelled) / totalTemplatesSent) * 100 : 0
    
    // Calcular tasa de conversaciones user-initiated
    // Se calcula sobre el total de respuestas (confirmadas + canceladas + user-initiated)
    const totalResponses = totalConfirmed + totalCancelled + totalUserInitiated
    const userInitiatedRate = totalResponses > 0 ? (totalUserInitiated / totalResponses) * 100 : 0
    
    // Calcular tasa de conversión de reagendamientos (completados vs iniciados)
    const rescheduleConversionRate = totalRescheduleStarted > 0 ? (totalRescheduled / totalRescheduleStarted) * 100 : 0

    const clientName = await getClientNameByClienteId(clienteId)

    const stats: ClientAppointmentStats = {
      clienteId,
      clientName,
      totalConfirmed,
      totalCancelled,
      totalRescheduled,
      totalTemplatesSent,
      confirmedByDay: confirmedByDay || {},
      cancelledByDay: cancelledByDay || {},
      rescheduledByDay: rescheduledByDay || {},
      templatesSentByDay: templatesSentByDay || {},
      confirmationRate: Math.round(confirmationRate * 100) / 100,
      cancellationRate: Math.round(cancellationRate * 100) / 100,
      responseRate: Math.round(responseRate * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
      avgConfirmationTime: Math.round(avgConfirmationTime * 100) / 100,
      avgCancellationTime: Math.round(avgCancellationTime * 100) / 100,
      lastUpdated: totals.lastUpdated || new Date().toISOString(),
      // Métricas de conversaciones user-initiated
      totalUserInitiated,
      userInitiatedByDay: userInitiatedByDay || {},
      userInitiatedRate: Math.round(userInitiatedRate * 100) / 100,
      // Métricas de turnos nuevos vs reagendamientos
      totalNewAppointments,
      newAppointmentsByDay: newAppointmentsByDay || {},
      // Métricas de inicio de proceso de reagendamiento
      totalRescheduleStarted,
      rescheduleStartedByDay: rescheduleStartedByDay || {},
      rescheduleConversionRate: Math.round(rescheduleConversionRate * 100) / 100,
    }

    console.log(`[APPOINTMENT_STATS] ✅ Estadísticas obtenidas exitosamente para cliente ${clienteId}`)
    return stats
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al obtener estadísticas:", error)
    return null
  }
}

export async function getAppointmentStatsByClienteIdFiltered(
  clienteId: string,
  startDate?: string,
  endDate?: string,
): Promise<ClientAppointmentStats | null> {
  const redis = getRedisClient()
  if (!redis) {
    console.warn("[APPOINTMENT_STATS] Redis no disponible")
    return null
  }

  try {
    console.log(`[APPOINTMENT_STATS] 📊 Obteniendo estadísticas filtradas para cliente ${clienteId}`)
    console.log(`[APPOINTMENT_STATS] 📊 Rango: ${startDate} - ${endDate}`)

    const statsKey = `${APPOINTMENT_STATS_PREFIX}${clienteId}`

    // Obtener datos diarios
    const confirmedByDay = ((await redis.hgetall(`${statsKey}:daily:confirmed`)) as Record<string, number>) || {}
    const cancelledByDay = ((await redis.hgetall(`${statsKey}:daily:cancelled`)) as Record<string, number>) || {}
    const rescheduledByDay = ((await redis.hgetall(`${statsKey}:daily:rescheduled`)) as Record<string, number>) || {}
    const templatesSentByDay = ((await redis.hgetall(`${statsKey}:daily:templates`)) as Record<string, number>) || {}
    const userInitiatedByDay = ((await redis.hgetall(`${statsKey}:daily:user_initiated`)) as Record<string, number>) || {}
    const newAppointmentsByDay = ((await redis.hgetall(`${statsKey}:daily:new_appointments`)) as Record<string, number>) || {}
    const rescheduleStartedByDay = ((await redis.hgetall(`${statsKey}:daily:reschedule_started`)) as Record<string, number>) || {}

    // Filtrar por fecha si se especifica
    const filterByDateRange = (data: Record<string, number>): Record<string, number> => {
      if (!startDate && !endDate) return data

      const filtered: Record<string, number> = {}
      for (const [date, value] of Object.entries(data)) {
        const dateStr = date
        const inRange = (!startDate || dateStr >= startDate) && (!endDate || dateStr <= endDate)
        if (inRange) {
          filtered[date] = Number(value)
        }
      }
      return filtered
    }

    const filteredConfirmed = filterByDateRange(confirmedByDay)
    const filteredCancelled = filterByDateRange(cancelledByDay)
    const filteredRescheduled = filterByDateRange(rescheduledByDay)
    const filteredTemplates = filterByDateRange(templatesSentByDay)
    const filteredUserInitiated = filterByDateRange(userInitiatedByDay)
    const filteredNewAppointments = filterByDateRange(newAppointmentsByDay)
    const filteredRescheduleStarted = filterByDateRange(rescheduleStartedByDay)

    // Calcular totales filtrados
    const totalConfirmed = Object.values(filteredConfirmed).reduce((sum, val) => sum + Number(val), 0)
    const totalCancelled = Object.values(filteredCancelled).reduce((sum, val) => sum + Number(val), 0)
    const totalRescheduled = Object.values(filteredRescheduled).reduce((sum, val) => sum + Number(val), 0)
    const totalTemplatesSent = Object.values(filteredTemplates).reduce((sum, val) => sum + Number(val), 0)
    const totalUserInitiated = Object.values(filteredUserInitiated).reduce((sum, val) => sum + Number(val), 0)
    const totalNewAppointments = Object.values(filteredNewAppointments).reduce((sum, val) => sum + Number(val), 0)
    const totalRescheduleStarted = Object.values(filteredRescheduleStarted).reduce((sum, val) => sum + Number(val), 0)

    // Calcular tasas de conversión
    const confirmationRate = totalTemplatesSent > 0 ? (totalConfirmed / totalTemplatesSent) * 100 : 0
    const cancellationRate = totalTemplatesSent > 0 ? (totalCancelled / totalTemplatesSent) * 100 : 0
    const responseRate = totalTemplatesSent > 0 ? ((totalConfirmed + totalCancelled) / totalTemplatesSent) * 100 : 0
    
    // Calcular tasa de conversaciones user-initiated
    const totalResponses = totalConfirmed + totalCancelled + totalUserInitiated
    const userInitiatedRate = totalResponses > 0 ? (totalUserInitiated / totalResponses) * 100 : 0
    
    // Calcular tasa de conversión de reagendamientos (completados vs iniciados)
    const rescheduleConversionRate = totalRescheduleStarted > 0 ? (totalRescheduled / totalRescheduleStarted) * 100 : 0

    let confirmedTimes: number[] = []
    let cancelledTimes: number[] = []

    if (startDate || endDate) {
      // Obtener las fechas que tienen datos de tiempos de respuesta
      const confirmedDates = (await redis.smembers(`${statsKey}:response_times:confirmed:dates`)) as string[]
      const cancelledDates = (await redis.smembers(`${statsKey}:response_times:cancelled:dates`)) as string[]

      // Filtrar fechas dentro del rango
      const filterDates = (dates: string[]): string[] => {
        return dates.filter((date) => {
          const inRange = (!startDate || date >= startDate) && (!endDate || date <= endDate)
          return inRange
        })
      }

      const filteredConfirmedDates = filterDates(confirmedDates)
      const filteredCancelledDates = filterDates(cancelledDates)

      // Obtener tiempos de respuesta para las fechas filtradas
      for (const date of filteredConfirmedDates) {
        const times = (await redis.lrange(`${statsKey}:response_times:confirmed:${date}`, 0, -1)) as number[]
        confirmedTimes.push(...times.map((t) => Number(t)))
      }

      for (const date of filteredCancelledDates) {
        const times = (await redis.lrange(`${statsKey}:response_times:cancelled:${date}`, 0, -1)) as number[]
        cancelledTimes.push(...times.map((t) => Number(t)))
      }

      console.log(
        `[APPOINTMENT_STATS] 📊 Tiempos filtrados - Confirmed: ${confirmedTimes.length}, Cancelled: ${cancelledTimes.length}`,
      )
    } else {
      // Sin filtro de fecha, usar los datos globales
      confirmedTimes = ((await redis.lrange(`${statsKey}:response_times:confirmed`, 0, -1)) as number[]).map((t) =>
        Number(t),
      )
      cancelledTimes = ((await redis.lrange(`${statsKey}:response_times:cancelled`, 0, -1)) as number[]).map((t) =>
        Number(t),
      )
    }

    const avgConfirmationTime =
      confirmedTimes.length > 0 ? confirmedTimes.reduce((sum, time) => sum + time, 0) / confirmedTimes.length : 0

    const avgCancellationTime =
      cancelledTimes.length > 0 ? cancelledTimes.reduce((sum, time) => sum + time, 0) / cancelledTimes.length : 0

    const allResponseTimes = [...confirmedTimes, ...cancelledTimes]
    const avgResponseTime =
      allResponseTimes.length > 0 ? allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length : 0

    const clientName = await getClientNameByClienteId(clienteId)

    const stats: ClientAppointmentStats = {
      clienteId,
      clientName,
      totalConfirmed,
      totalCancelled,
      totalRescheduled,
      totalTemplatesSent,
      confirmedByDay: filteredConfirmed,
      cancelledByDay: filteredCancelled,
      rescheduledByDay: filteredRescheduled,
      templatesSentByDay: filteredTemplates,
      confirmationRate: Math.round(confirmationRate * 100) / 100,
      cancellationRate: Math.round(cancellationRate * 100) / 100,
      responseRate: Math.round(responseRate * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
      avgConfirmationTime: Math.round(avgConfirmationTime * 100) / 100,
      avgCancellationTime: Math.round(avgCancellationTime * 100) / 100,
      lastUpdated: new Date().toISOString(),
      // Métricas de conversaciones user-initiated
      totalUserInitiated,
      userInitiatedByDay: filteredUserInitiated,
      userInitiatedRate: Math.round(userInitiatedRate * 100) / 100,
      // Métricas de turnos nuevos vs reagendamientos
      totalNewAppointments,
      newAppointmentsByDay: filteredNewAppointments,
      // Métricas de inicio de proceso de reagendamiento
      totalRescheduleStarted,
      rescheduleStartedByDay: filteredRescheduleStarted,
      rescheduleConversionRate: Math.round(rescheduleConversionRate * 100) / 100,
    }

    console.log(`[APPOINTMENT_STATS] ✅ Estadísticas filtradas obtenidas para cliente ${clienteId}`)
    return stats
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al obtener estadísticas filtradas:", error)
    return null
  }
}

// Guardar timestamp de envío de template para tracking
export async function trackTemplateSent(
  clienteId: string,
  phoneNumber: string,
  appointmentInfo?: any,
): Promise<string> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para trackTemplateSent")
    return ""
  }

  try {
    const trackingId = `${clienteId}_${phoneNumber}_${Date.now()}`
    const trackingKey = `${TEMPLATE_TRACKING_PREFIX}${trackingId}`

    console.log(`[APPOINTMENT_STATS] 📊 trackTemplateSent llamado`)
    console.log(`[APPOINTMENT_STATS] 📊 - clienteId: ${clienteId}`)
    console.log(`[APPOINTMENT_STATS] 📊 - phoneNumber: ${phoneNumber}`)
    console.log(`[APPOINTMENT_STATS] 📊 - trackingKey: ${trackingKey}`)

    const trackingData = {
      clienteId,
      phoneNumber,
      sentAt: new Date().toISOString(),
      appointmentInfo,
    }

    // Guardar por 7 días (suficiente para respuestas)
    await redis.set(trackingKey, JSON.stringify(trackingData), { ex: 60 * 60 * 24 * 7 })
    console.log(`[APPOINTMENT_STATS] ✅ Template tracking guardado: ${trackingId}`)

    await trackAppointmentEvent({
      clienteId,
      phoneNumber,
      eventType: "template_sent",
      timestamp: new Date().toISOString(),
    })

    return trackingId
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al guardar tracking de template:", error)
    return ""
  }
}

// Obtener timestamp de envío de template
export async function getTemplateSentTime(clienteId: string, phoneNumber: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para getTemplateSentTime")
    return null
  }

  try {
    console.log(`[APPOINTMENT_STATS] 📊 getTemplateSentTime llamado`)
    console.log(`[APPOINTMENT_STATS] 📊 - clienteId: ${clienteId}`)
    console.log(`[APPOINTMENT_STATS] 📊 - phoneNumber: ${phoneNumber}`)

    // Buscar el tracking más reciente para este cliente y teléfono
    const pattern = `${TEMPLATE_TRACKING_PREFIX}${clienteId}_${phoneNumber}_*`
    console.log(`[APPOINTMENT_STATS] 📊 - buscando patrón: ${pattern}`)

    const keys = await redis.keys(pattern)
    console.log(`[APPOINTMENT_STATS] 📊 - keys encontradas: ${keys.length}`)

    if (keys.length === 0) {
      console.log(`[APPOINTMENT_STATS] ⚠️ No se encontraron keys para el patrón`)
      return null
    }

    // Ordenar por timestamp (más reciente primero)
    keys.sort().reverse()
    console.log(`[APPOINTMENT_STATS] 📊 - usando key más reciente: ${keys[0]}`)

    const trackingData = await redis.get(keys[0])
    if (!trackingData) {
      console.log(`[APPOINTMENT_STATS] ⚠️ Key encontrada pero sin datos`)
      return null
    }

    const parsed = typeof trackingData === "string" ? JSON.parse(trackingData) : trackingData
    console.log(`[APPOINTMENT_STATS] ✅ Template sent time encontrado: ${parsed.sentAt}`)
    return parsed.sentAt || null
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al obtener template sent time:", error)
    return null
  }
}

// Constante para la ventana de 24 horas en milisegundos
const TEMPLATE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 horas

/**
 * Verifica si hay un template enviado dentro de las últimas 24 horas
 * @returns true si hay un template activo (dentro de ventana), false si no hay o está fuera de ventana
 */
export async function isWithinTemplateWindow(clienteId: string, phoneNumber: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para isWithinTemplateWindow")
    return false
  }

  try {
    const templateSentAt = await getTemplateSentTime(clienteId, phoneNumber)
    
    if (!templateSentAt) {
      console.log(`[APPOINTMENT_STATS] 📊 No hay template previo para ${phoneNumber} - conversación user-initiated`)
      return false
    }

    const templateTime = new Date(templateSentAt).getTime()
    const now = Date.now()
    const timeDiff = now - templateTime

    const isWithinWindow = timeDiff <= TEMPLATE_WINDOW_MS

    console.log(`[APPOINTMENT_STATS] 📊 Verificando ventana de 24h:`)
    console.log(`[APPOINTMENT_STATS] 📊 - Template enviado: ${templateSentAt}`)
    console.log(`[APPOINTMENT_STATS] 📊 - Tiempo transcurrido: ${Math.round(timeDiff / 1000 / 60)} minutos`)
    console.log(`[APPOINTMENT_STATS] 📊 - Dentro de ventana 24h: ${isWithinWindow}`)

    return isWithinWindow
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al verificar ventana de template:", error)
    return false
  }
}

/**
 * Verifica si una conversación es user-initiated y la registra si corresponde
 * Una conversación es user-initiated si:
 * 1. No hay ningún template enviado previamente, O
 * 2. El último template fue hace más de 24 horas
 * 
 * IMPORTANTE: Solo registra UNA conversación por cada período de 24h de inactividad.
 * Si ya se registró una conversación user-initiated activa, no registra otra hasta que expire.
 * 
 * @returns true si es user-initiated (y fue registrado), false si está dentro de ventana de template
 */
export async function checkAndTrackUserInitiated(clienteId: string, phoneNumber: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para checkAndTrackUserInitiated")
    return false
  }

  // Verificar si está dentro de ventana de template
  const isWithinWindow = await isWithinTemplateWindow(clienteId, phoneNumber)

  if (!isWithinWindow) {
    // Verificar si ya hay una conversación user-initiated activa (últimas 24h)
    const activeConversationKey = `${ACTIVE_USER_CONVERSATION_PREFIX}${clienteId}_${phoneNumber}`
    const existingConversation = await redis.get(activeConversationKey)
    
    if (existingConversation) {
      console.log(`[APPOINTMENT_STATS] 📊 Ya existe conversación user-initiated activa para ${phoneNumber} - no se registra duplicado`)
      return true // Es user-initiated pero ya está contado
    }

    // Es una conversación user-initiated NUEVA - registrar el evento
    console.log(`[APPOINTMENT_STATS] 📊 Nueva conversación USER-INITIATED detectada para ${phoneNumber}`)
    
    await trackAppointmentEvent({
      clienteId,
      phoneNumber,
      eventType: "user_initiated",
      timestamp: new Date().toISOString(),
      metadata: {
        reason: "no_template_or_outside_24h_window"
      }
    })

    // Marcar que hay una conversación user-initiated activa (expira en 24h)
    await redis.set(
      activeConversationKey, 
      JSON.stringify({
        startedAt: new Date().toISOString(),
        phoneNumber,
        clienteId
      }), 
      { ex: USER_CONVERSATION_WINDOW_SECONDS }
    )
    console.log(`[APPOINTMENT_STATS] 📊 Conversación user-initiated marcada como activa (expira en 24h)`)

    return true
  }

  console.log(`[APPOINTMENT_STATS] 📊 Conversación dentro de ventana de template para ${phoneNumber}`)
  return false
}

/**
 * Marca que un usuario canceló un turno y está pendiente de reagendar
 * Esta marca expira en 12 horas
 */
export async function markPendingReschedule(clienteId: string, phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para markPendingReschedule")
    return
  }

  try {
    const key = `${PENDING_RESCHEDULE_PREFIX}${clienteId}_${phoneNumber}`
    const data = {
      cancelledAt: new Date().toISOString(),
      phoneNumber,
      clienteId
    }
    
    // Guardar por 12 horas
    await redis.set(key, JSON.stringify(data), { ex: RESCHEDULE_WINDOW_SECONDS })
    console.log(`[APPOINTMENT_STATS] 📊 Marcado pending reschedule para ${phoneNumber} (expira en 12h)`)
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al marcar pending reschedule:", error)
  }
}

/**
 * Trackea el inicio del proceso de reagendamiento cuando se llama a route_to_reagendamiento
 */
export async function trackRescheduleStarted(clienteId: string, phoneNumber: string): Promise<void> {
  await trackAppointmentEvent({
    clienteId,
    phoneNumber,
    eventType: "reschedule_started",
    timestamp: new Date().toISOString(),
  })
  console.log(`[APPOINTMENT_STATS] 📊 Trackeado inicio de proceso de reagendamiento para ${phoneNumber}`)
}

/**
 * Verifica si hay una cancelación pendiente de reagendar (dentro de 12 horas)
 * Si existe, la elimina y retorna true
 * Si no existe, retorna false
 */
export async function checkAndClearPendingReschedule(clienteId: string, phoneNumber: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    console.log("[APPOINTMENT_STATS] ⚠️ Redis no disponible para checkPendingReschedule")
    return false
  }

  try {
    const key = `${PENDING_RESCHEDULE_PREFIX}${clienteId}_${phoneNumber}`
    const data = await redis.get(key)
    
    if (data) {
      // Existe una cancelación pendiente - eliminar el flag
      await redis.del(key)
      console.log(`[APPOINTMENT_STATS] 📊 Cancelación pendiente encontrada y limpiada para ${phoneNumber} - es un REAGENDAMIENTO`)
      return true
    }
    
    console.log(`[APPOINTMENT_STATS] 📊 No hay cancelación pendiente para ${phoneNumber} - es un TURNO NUEVO`)
    return false
  } catch (error) {
    console.error("[APPOINTMENT_STATS] ❌ Error al verificar pending reschedule:", error)
    return false
  }
}
