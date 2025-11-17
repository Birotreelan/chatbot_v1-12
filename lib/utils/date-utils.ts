/**
 * Obtiene la fecha y hora actual en formato argentino
 * @returns String con la fecha y hora en formato: "DD/MM/YYYY HH:MM:SS"
 */
export function getArgentinaDateTime(): string {
  // Crear una fecha con la zona horaria de Argentina (GMT-3)
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }

  const formatter = new Intl.DateTimeFormat("es-AR", options)
  const parts = formatter.formatToParts(new Date())

  // Construir el string de fecha y hora en formato argentino
  const dateObj: Record<string, string> = {}
  parts.forEach((part) => {
    dateObj[part.type] = part.value
  })

  return `${dateObj.day}/${dateObj.month}/${dateObj.year} ${dateObj.hour}:${dateObj.minute}:${dateObj.second}`
}

/**
 * Formatea una fecha con el día de la semana en español usando la zona horaria de Argentina
 * @param dateString - Fecha en formato ISO (YYYY-MM-DD) o cualquier formato parseable
 * @returns String con formato: "día_de_semana DD de mes de YYYY" (ej: "viernes 7 de noviembre de 2025")
 */
export function formatDateWithDayOfWeek(dateString: string): string {
  try {
    let date: Date

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      // ISO date format (YYYY-MM-DD)
      // Parse as local date to avoid timezone issues
      const [year, month, day] = dateString.split("-").map(Number)
      date = new Date(year, month - 1, day, 12, 0, 0) // Set to noon to avoid timezone issues
    } else {
      // Other formats
      date = new Date(dateString)
    }

    if (isNaN(date.getTime())) {
      console.error("[DATE-UTILS] Invalid date string:", dateString)
      return dateString // Return original if parsing fails
    }

    // Format with day of week in Spanish - removing timeZone option to use local interpretation
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }

    const formatter = new Intl.DateTimeFormat("es-AR", options)
    return formatter.format(date)
  } catch (error) {
    console.error("[DATE-UTILS] Error formatting date:", error)
    return dateString // Return original if error occurs
  }
}

/**
 * Extrae y formatea la fecha de un string que puede contener una fecha en varios formatos
 * @param text - Texto que puede contener una fecha
 * @returns Fecha formateada con día de la semana o el texto original
 */
export function extractAndFormatDate(text: string): string {
  if (!text) return text

  // Try to match ISO format (YYYY-MM-DD)
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) {
    const formatted = formatDateWithDayOfWeek(isoMatch[1])
    return text.replace(isoMatch[1], formatted)
  }

  // Try to match DD/MM/YYYY format
  const ddmmyyyyMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch
    const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    const formatted = formatDateWithDayOfWeek(isoDate)
    return text.replace(ddmmyyyyMatch[0], formatted)
  }

  return text
}
