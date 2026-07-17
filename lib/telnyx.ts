/**
 * Compra de números de teléfono de Argentina vía la API de Telnyx — la mitad
 * "telco" de la línea híbrida (16/7/2026): la clínica puede seguir trayendo
 * su propia línea como siempre, o nosotros le compramos un número acá.
 *
 * IMPORTANTE — alcance de esta integración: comprar el número acá NO lo deja
 * listo para usar en WhatsApp. Todavía falta el paso de registrarlo como
 * número de WhatsApp Business en el Business Manager de Meta (manual por
 * ahora, hasta que avancemos con el programa de Tech Provider) y recién ahí
 * se obtienen el Phone Number ID y el Access Token que van en los campos
 * de siempre. Este archivo sólo resuelve "conseguir un número argentino que
 * nunca vamos a perder mientras paguemos la cuenta".
 *
 * Requiere la variable de entorno TELNYX_API_KEY (API Key v2 de Telnyx).
 *
 * No se pudo probar en vivo desde este entorno (sin salida de red a
 * api.telnyx.com en el sandbox) — implementado según la documentación
 * oficial de Telnyx. Conviene revisar los logs de Vercel en el primer uso
 * real.
 */

const BASE_URL = "https://api.telnyx.com/v2"

export interface TelnyxAvailableNumber {
  phoneNumber: string
  region: string | null
  monthlyCost: string | null
}

export interface TelnyxBuyResult {
  success: boolean
  orderId?: string
  status?: string
  phoneNumber?: string
  error?: string
}

function getApiKey(): string | null {
  return process.env.TELNYX_API_KEY || null
}

export function isTelnyxConfigured(): boolean {
  return getApiKey() !== null
}

/**
 * Busca números disponibles de Argentina. `search` es opcional — permite
 * filtrar por prefijo (ej: código de área "11" para Buenos Aires); si no se
 * pasa, Telnyx devuelve números disponibles de cualquier parte del país.
 */
export async function searchArgentinaNumbers(search?: string, limit = 10): Promise<TelnyxAvailableNumber[]> {
  const apiKey = getApiKey()
  if (!apiKey) return []

  const params = new URLSearchParams({
    "filter[country_code]": "AR",
    "filter[limit]": String(limit),
  })
  if (search?.trim()) {
    params.set("filter[phone_number][starts_with]", search.trim())
  }

  try {
    const response = await fetch(`${BASE_URL}/available_phone_numbers?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      // Búsqueda de disponibilidad: no vale la pena cachear, cambia todo el tiempo.
      cache: "no-store",
    })
    const data = await response.json()
    if (!response.ok) {
      console.error("[telnyx] Error buscando números:", JSON.stringify(data.errors || data))
      return []
    }
    const results = Array.isArray(data.data) ? data.data : []
    return results.map((r: any) => ({
      phoneNumber: r.phone_number,
      region: r.region_information?.[0]?.region_name || null,
      monthlyCost: r.cost_information?.monthly_cost || null,
    }))
  } catch (error) {
    console.error("[telnyx] Excepción buscando números:", error)
    return []
  }
}

/**
 * Compra un número puntual (el que se eligió del resultado de búsqueda).
 * Esto es una acción con costo real — sólo se debe llamar tras confirmación
 * explícita del usuario en la UI, nunca automáticamente.
 */
export async function buyPhoneNumber(phoneNumber: string): Promise<TelnyxBuyResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { success: false, error: "Telnyx no está configurado (falta TELNYX_API_KEY)." }
  }

  try {
    const response = await fetch(`${BASE_URL}/number_orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone_numbers: [{ phone_number: phoneNumber }],
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      const message = data?.errors?.[0]?.detail || "Error desconocido comprando el número."
      console.error("[telnyx] Error comprando número:", JSON.stringify(data.errors || data))
      return { success: false, error: message }
    }
    const order = data.data
    const purchasedNumber = order?.phone_numbers?.[0]?.phone_number || phoneNumber
    return {
      success: true,
      orderId: order?.id,
      status: order?.status,
      phoneNumber: purchasedNumber,
    }
  } catch (error) {
    console.error("[telnyx] Excepción comprando número:", error)
    return { success: false, error: "Error de red comprando el número. Intentá de nuevo." }
  }
}
