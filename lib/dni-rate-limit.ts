import { rateLimit } from "@/lib/rate-limit"

// Mismo criterio que `extractDNI()` en los flujos de widget: DNI argentino
// de 7 u 8 dígitos. Se usa acá para detectar, a nivel de endpoint, cuándo un
// mensaje entrante es un intento de búsqueda de paciente por DNI.
export function looksLikeDNI(message: string): boolean {
  return /^\d{7,8}$/.test(message.trim())
}

/**
 * Límite estricto y específico para intentos de DNI (además del rate limit
 * general del endpoint). El widget público permite buscar pacientes por DNI
 * sin autenticación, así que sin esto alguien podría scriptear intentos
 * secuenciales para enumerar pacientes reales (nombre, email, teléfono).
 * 5 intentos cada 10 minutos por IP.
 */
export async function checkDniRateLimit(ip: string): Promise<boolean> {
  const result = await rateLimit(`dni-lookup:ip:${ip}`, 5, 600000)
  return result.success
}

export const DNI_RATE_LIMIT_MESSAGE =
  "Superaste el número de intentos permitidos para buscar por DNI. Probá de nuevo en unos minutos."
