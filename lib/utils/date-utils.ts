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
