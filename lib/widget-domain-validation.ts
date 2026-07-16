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
 * contra abuso sigue siendo el rate limiting ya aplicado.
 *
 * Comportamiento:
 * - Si el cliente no configuró `widgetAllowedDomains`, no se restringe
 *   (compatibilidad con embeds existentes).
 * - Si configuró dominios pero la solicitud no trae Origin ni Referer, se
 *   deja pasar (no se puede verificar; evita falsos positivos por headers
 *   que algunos navegadores/proxies omiten).
 * - Si trae alguno de los dos headers y el host no matchea ninguno de los
 *   dominios permitidos, se rechaza.
 */
export function isWidgetOriginAllowed(config: Pick<WhatsAppConfig, "widgetAllowedDomains">, request: Request): boolean {
  const allowedRaw = config.widgetAllowedDomains?.trim()
  if (!allowedRaw) return true

  const allowedHosts = allowedRaw
    .split(",")
    .map((d) => normalizeHost(d))
    .filter(Boolean)
  if (allowedHosts.length === 0) return true

  const originHeader = request.headers.get("origin")
  const refererHeader = request.headers.get("referer")
  const sourceUrl = originHeader || refererHeader
  if (!sourceUrl) return true

  const host = extractHost(sourceUrl)
  if (!host) return true

  // Siempre permitir same-origin: es como se prueba el widget desde /demo,
  // apuntando al mismo dominio de esta app (no es el escenario que queremos
  // restringir — el riesgo es un sitio DE TERCEROS usando el cliente_id de
  // otra clínica).
  const ownHost = extractHost(request.url)
  if (ownHost && normalizeHost(host) === normalizeHost(ownHost)) return true

  return allowedHosts.includes(normalizeHost(host))
}
