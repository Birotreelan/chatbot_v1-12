/**
 * Verificación server-side de Cloudflare Turnstile (CAPTCHA), usada
 * exclusivamente en el paso de CONFIRMACIÓN del widget de formulario — el
 * único punto donde de verdad importa distinguir humano de bot, justo antes
 * de consumir un turno real (ver lib/reservation-limit.ts para el tope
 * complementario de reservas por IP).
 *
 * Cada cliente tiene su PROPIO widget de Turnstile (propio sitekey/secret,
 * ver lib/cloudflare-turnstile.ts) — no hay un secret global. Se recibe el
 * secret de ese cliente como parámetro (config.widgetTurnstileSecret).
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export async function verifyTurnstileToken(
  token: string | undefined | null,
  ip: string,
  secretKey: string | undefined | null,
): Promise<boolean> {
  // Si este cliente todavía no tiene su widget de Turnstile configurado, no
  // bloqueamos — degrada a "sin CAPTCHA" para ese cliente en vez de romper
  // el widget.
  if (!secretKey) return true
  if (!token) return false

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
    })
    if (!response.ok) return false
    const data = await response.json()
    return data.success === true
  } catch (error) {
    console.error("[turnstile] Error verificando token:", error)
    // Ante un error de red con Cloudflare, no dejamos a todos los pacientes
    // sin poder reservar — se degrada a "sin CAPTCHA" para ese intento.
    return true
  }
}
