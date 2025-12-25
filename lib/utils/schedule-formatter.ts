import type { DaySchedule, WhatsAppConfig } from "../types"

const DAYS_ES: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
}

/**
 * Formatea un array de horarios semanales para incluir en el bloque [SISTEMA]
 * @param schedule - Array con los horarios de cada día de la semana
 * @returns String formateado con los horarios o mensaje si está cerrado
 */
export function formatScheduleForSystem(schedule?: DaySchedule[]): string {
  if (!schedule || schedule.length === 0) {
    return "No configurado"
  }

  const lines: string[] = []
  const daysOrder = [1, 2, 3, 4, 5, 6, 0] // Lunes a Domingo

  for (const dayNum of daysOrder) {
    const daySchedule = schedule.find((s) => s.dayOfWeek === dayNum)
    const dayName = DAYS_ES[dayNum]

    if (!daySchedule || !daySchedule.enabled) {
      lines.push(`${dayName}: Cerrado`)
      continue
    }

    if (daySchedule.periods && daySchedule.periods.length > 0) {
      const periods = daySchedule.periods.map((period) => `${period.startTime}-${period.endTime}`).join(", ")
      lines.push(`${dayName}: ${periods}`)
    } else {
      lines.push(`${dayName}: Cerrado`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No configurado"
}

/**
 * Obtiene un resumen compacto de los horarios (para logs o notificaciones)
 * @param schedule - Array con los horarios de cada día de la semana
 * @returns String compacto con los horarios
 */
export function getScheduleSummary(schedule?: DaySchedule[]): string {
  if (!schedule || schedule.length === 0) {
    return "No configurado"
  }

  const activeDays = schedule.filter((s) => s.enabled && s.periods && s.periods.length > 0)

  if (activeDays.length === 0) {
    return "Cerrado todos los días"
  }

  return `${activeDays.length} días activos`
}

/**
 * Formatea los horarios de un config de WhatsApp para el bloque [SISTEMA]
 * @param config - Configuración de WhatsApp con horarios de clínica y WhatsApp
 * @returns String formateado para incluir en el bloque SISTEMA
 */
export function formatScheduleForSystemBlock(config: WhatsAppConfig): string {
  const parts: string[] = []

  if (config.businessHours && config.businessHours.length > 0) {
    const businessHoursFormatted = formatScheduleForSystem(config.businessHours)
    parts.push(`\nHorarios Clinica:\n${businessHoursFormatted}`)
  } else {
    parts.push(`\nHorarios Clinica: No configurado`)
  }

  if (config.whatsappSupportHours && config.whatsappSupportHours.length > 0) {
    const supportHoursFormatted = formatScheduleForSystem(config.whatsappSupportHours)
    parts.push(`\nHorarios Atencion WhatsApp:\n${supportHoursFormatted}`)
  } else {
    parts.push(`\nHorarios Atencion WhatsApp: No configurado`)
  }

  return parts.join("")
}
