import type { DaySchedule, WhatsAppConfig } from "../types"

const DAYS_ES: Record<string, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
}

/**
 * Formatea un objeto de horarios semanales para incluir en el bloque [SISTEMA]
 * @param schedule - Objeto con los horarios de cada día de la semana
 * @returns String formateado con los horarios o mensaje si está cerrado
 */
export function formatScheduleForSystem(schedule?: Record<string, DaySchedule>): string {
  if (!schedule) {
    return "No configurado"
  }

  const lines: string[] = []
  const daysOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

  for (const day of daysOrder) {
    const daySchedule = schedule[day]
    if (!daySchedule) continue

    const dayName = DAYS_ES[day]

    if (!daySchedule.enabled) {
      lines.push(`${dayName}: Cerrado`)
      continue
    }

    const periods: string[] = []

    // Primer período
    if (daySchedule.start && daySchedule.end) {
      periods.push(`${daySchedule.start}-${daySchedule.end}`)
    }

    // Segundo período (si existe)
    if (daySchedule.start2 && daySchedule.end2) {
      periods.push(`${daySchedule.start2}-${daySchedule.end2}`)
    }

    if (periods.length > 0) {
      lines.push(`${dayName}: ${periods.join(", ")}`)
    } else {
      lines.push(`${dayName}: Cerrado`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No configurado"
}

/**
 * Obtiene un resumen compacto de los horarios (para logs o notificaciones)
 * @param schedule - Objeto con los horarios de cada día de la semana
 * @returns String compacto con los horarios
 */
export function getScheduleSummary(schedule?: Record<string, DaySchedule>): string {
  if (!schedule) {
    return "No configurado"
  }

  const activeDays = Object.entries(schedule).filter(([_, daySchedule]) => daySchedule?.enabled)

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
  let result = ""

  // Agregar horarios de la clínica
  if (config.businessHours) {
    const businessHoursFormatted = formatScheduleForSystem(config.businessHours)
    result += `\nHorarios Clinica:\n${businessHoursFormatted}`
  }

  // Agregar horarios de atención por WhatsApp
  if (config.whatsappSupportHours) {
    const supportHoursFormatted = formatScheduleForSystem(config.whatsappSupportHours)
    result += `\nHorarios Atencion WhatsApp:\n${supportHoursFormatted}`
  }

  return result
}
