import type { WhatsAppConfig } from "@/lib/types"

// Normaliza un hostname: minúsculas y sin el prefijo "www." — así declarar
// "clinica.com" también cubre "www.clinica.com" sin que el cliente tenga
// que listar ambas variantes.
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "")
}

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Valida que la solicitud a un endpoint de widget venga de un dominio
 * autorizado para ese cliente.
 *
 * Nota de alcance: esto se basa en los headers Origin/Referer, que un
 * atacante que llame directo a la API (curl, script) puede falsificar. No es
 * una defensa infalible tipo CSRF — es una barrera contra el uso casual/
 * automatizado del widget desde sitios no autorizados (scraping, clonado del
 * embed, reutilización del cliente_id de otra clínica). La defensa real
 * contra el embebido no autorizado es `frame-ancestors` (ver middleware.ts):
 * ese lo hace cumplir el navegador y no se falsifica desde el sitio que
 * embebe.
 *
 * ── Se cierra por defecto (24/9/2026) ──────────────────────────────────────
 *
 * Hasta hoy esta función dejaba pasar en dos casos: cuando el cliente no tenía
 * dominios cargados, y cuando la petición no traía ni Origin ni Referer. Los
 * dos eran agujeros por donde entraba exactamente lo que se quería evitar:
 * sin dominios cargados el widget funcionaba en cualquier sitio, y para
 * saltearse el chequeo alcanzaba con no mandar Referer.
 *
 * Ahora los dos casos rechazan. El costo es real y conviene tenerlo presente:
 *
 *  - Un cliente sin "Dominios permitidos" cargado se queda sin widget hasta
 *    que alguien complete el campo. Es una decisión consciente: el objetivo es
 *    que nadie use el widget sin permiso, y "sin permiso" incluye "todavía no
 *    dijimos quién tiene permiso".
 *  - Un visitante cuyo navegador o proxy omite el Referer tampoco va a poder
 *    usarlo. No es frecuente, pero pasa, y es invisible: para esa persona el
 *    widget simplemente no anda.
 *
 * Se mantiene la excepción de same-origin: así se sigue probando el widget
 * desde /demo y desde el dashboard, que no es el escenario que se restringe.
 */
export function isWidgetOriginAllowed(config: Pick<WhatsAppConfig, "widgetAllowedDomains">, request: Request): boolean {
  const originHeader = request.headers.get("origin")
  const refererHeader = request.headers.get("referer")
  const sourceUrl = originHeader || refererHeader
  const host = sourceUrl ? extractHost(sourceUrl) : null

  // Same-origin primero, y antes de mirar los dominios: si no, un cliente sin
  // el campo cargado tampoco podría probar su widget desde nuestro propio
  // dashboard, y no habría forma de darse cuenta de qué falta.
  const ownHost = extractHost(request.url)
  if (host && ownHost && normalizeHost(host) === normalizeHost(ownHost)) return true

  const allowedRaw = config.widgetAllowedDomains?.trim()
  if (!allowedRaw) return false

  const allowedHosts = allowedRaw
    .split(",")
    .map((d) => normalizeHost(d))
    .filter(Boolean)
  if (allowedHosts.length === 0) return false

  // Sin Origin ni Referer no se puede verificar de dónde viene. Antes eso
  // alcanzaba para pasar.
  if (!host) return false

  // Un dominio declarado cubre sus subdominios: quien carga "clinica.com" no
  // debería tener que acordarse también de "turnos.clinica.com".
  const normalizado = normalizeHost(host)
  return allowedHosts.some((permitido) => normalizado === permitido || normalizado.endsWith(`.${permitido}`))
}
