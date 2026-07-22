/**
 * lib/proxy-url-resolver.ts
 *
 * Fuente única de verdad para resolver la "Proxy URL" a usar en las llamadas
 * a la API de cada clínica (get_paciente, get_turnos, set_turno, confirmar/
 * cancelar_turno, etc.).
 *
 * Antes: TODAS las clínicas compartían una única URL estática, leída de las
 * variables de entorno globales PROXY_API_URL / CLINIC_PROXY_URL.
 *
 * Ahora (22/7/2026): cada clínica puede tener su propia URL en el campo
 * "proxy" de su WhatsAppConfig (dashboard → Configuración Avanzada →
 * Configuraciones técnicas y de desarrollo → Proxy URL). Esta función
 * resuelve esa URL dinámica por cliente y, si el campo todavía no fue
 * cargado para esa clínica, cae de vuelta a la env var global — así la
 * migración es gradual: no rompe a las clínicas que todavía no configuraron
 * el campo, y cada una pasa a usar su URL propia apenas la cargues.
 */

import { getConfigByClienteId } from "./db"
import { logger } from "./logger"

export async function resolveProxyUrl(clienteId: string): Promise<string> {
  let proxyFromConfig: string | undefined

  try {
    const config = await getConfigByClienteId(clienteId)
    proxyFromConfig = config?.proxy || undefined
  } catch (error) {
    logger.warn("PROXY-RESOLVER", `Error buscando config por cliente_id ${clienteId}, se usa fallback global`, error as Error)
  }

  const proxyUrl = proxyFromConfig || process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL

  if (!proxyUrl) {
    throw new Error(
      `No hay Proxy URL configurada para el cliente ${clienteId} (ni en su ficha ni en las variables de entorno globales PROXY_API_URL/CLINIC_PROXY_URL)`,
    )
  }

  return proxyUrl
}
