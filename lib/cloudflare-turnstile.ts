/**
 * Aprovisionamiento automático de widgets de Cloudflare Turnstile, uno POR
 * CLIENTE (no uno global). Cloudflare permite un máximo de 10 dominios por
 * widget, y acá va a haber cientos de clínicas — así que cada una necesita
 * su propio widget (su propio par sitekey/secret), con sólo sus 1-3 dominios.
 *
 * Se llama desde app/dashboard/actions.ts cada vez que se guarda
 * `widgetAllowedDomains` en la config de un cliente: si todavía no tiene
 * widget, se crea uno nuevo; si ya tiene, se actualizan sus dominios.
 *
 * Requiere las variables de entorno:
 * - CLOUDFLARE_API_TOKEN (permiso Account:Turnstile:Edit)
 * - CLOUDFLARE_ACCOUNT_ID
 */
const BASE_URL = "https://api.cloudflare.com/client/v4"

function parseDomains(widgetAllowedDomains: string): string[] {
  return Array.from(
    new Set(
      widgetAllowedDomains
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function getCredentials(): { token: string; accountId: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !accountId) return null
  return { token, accountId }
}

interface TurnstileWidgetResult {
  sitekey: string
  secret: string
}

/** Crea un widget de Turnstile nuevo para un cliente. Devuelve null si Cloudflare no está configurado o falla. */
export async function createTurnstileWidget(
  clinicName: string,
  widgetAllowedDomains: string,
): Promise<TurnstileWidgetResult | null> {
  const creds = getCredentials()
  const domains = parseDomains(widgetAllowedDomains)
  if (!creds || domains.length === 0) return null

  try {
    const response = await fetch(`${BASE_URL}/accounts/${creds.accountId}/challenges/widgets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Iris - ${clinicName}`.slice(0, 100),
        domains,
        mode: "managed",
      }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      console.error("[cloudflare-turnstile] Error creando widget:", JSON.stringify(data.errors || data))
      return null
    }
    return { sitekey: data.result.sitekey, secret: data.result.secret }
  } catch (error) {
    console.error("[cloudflare-turnstile] Excepción creando widget:", error)
    return null
  }
}

/** Actualiza los dominios de un widget existente. */
export async function updateTurnstileWidgetDomains(
  sitekey: string,
  clinicName: string,
  widgetAllowedDomains: string,
): Promise<boolean> {
  const creds = getCredentials()
  const domains = parseDomains(widgetAllowedDomains)
  if (!creds || domains.length === 0) return false

  try {
    const response = await fetch(`${BASE_URL}/accounts/${creds.accountId}/challenges/widgets/${sitekey}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Iris - ${clinicName}`.slice(0, 100),
        domains,
        mode: "managed",
      }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      console.error("[cloudflare-turnstile] Error actualizando widget:", JSON.stringify(data.errors || data))
      return false
    }
    return true
  } catch (error) {
    console.error("[cloudflare-turnstile] Excepción actualizando widget:", error)
    return false
  }
}

export function isCloudflareTurnstileProvisioningConfigured(): boolean {
  return getCredentials() !== null
}
