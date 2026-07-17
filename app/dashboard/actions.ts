"use server"

import { revalidatePath } from "next/cache"
import {
  createWhatsAppConfig as createConfig,
  updateWhatsAppConfig as updateConfig,
  deleteWhatsAppConfig as deleteConfig,
} from "@/lib/db"
import type { WhatsAppConfig } from "@/lib/types"
import { createTurnstileWidget, updateTurnstileWidgetDomains } from "@/lib/cloudflare-turnstile"
import { searchArgentinaNumbers, buyPhoneNumber, type TelnyxAvailableNumber } from "@/lib/telnyx"
import { requireAuthForApi } from "@/lib/auth"

/**
 * Aprovisiona/actualiza el widget de Turnstile de este cliente cuando se
 * guardaron dominios permitidos. Un widget de Cloudflare por CLIENTE (no
 * uno global) porque cada widget soporta máx. 10 dominios y acá va a haber
 * cientos de clínicas. Si Cloudflare no está configurado (faltan las env
 * vars) o falla la llamada, no rompe el guardado de la config — el widget
 * de formulario simplemente sigue sin CAPTCHA para ese cliente hasta que se
 * resuelva.
 */
async function provisionTurnstileIfNeeded(config: WhatsAppConfig): Promise<WhatsAppConfig> {
  const domains = config.widgetAllowedDomains?.trim()
  if (!domains) return config

  if (config.widgetTurnstileSiteKey) {
    await updateTurnstileWidgetDomains(config.widgetTurnstileSiteKey, config.displayName || config.id, domains)
    return config
  }

  const widget = await createTurnstileWidget(config.displayName || config.id, domains)
  if (!widget) return config

  return (
    (await updateConfig(config.id, {
      widgetTurnstileSiteKey: widget.sitekey,
      widgetTurnstileSecret: widget.secret,
    })) || config
  )
}

export async function createWhatsAppConfig(data: Partial<WhatsAppConfig>) {
  let config = await createConfig(data)
  config = await provisionTurnstileIfNeeded(config)
  revalidatePath("/dashboard")
  return config
}

export async function updateWhatsAppConfig(id: string, data: Partial<WhatsAppConfig>) {
  let config = await updateConfig(id, data)
  if (config) {
    config = await provisionTurnstileIfNeeded(config)
  }
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/config/${id}`)
  return config
}

export async function deleteWhatsAppConfig(id: string) {
  const result = await deleteConfig(id)
  revalidatePath("/dashboard")
  return result
}

/**
 * Línea híbrida (16/7/2026): búsqueda y compra de números de Argentina vía
 * Telnyx, para clínicas que prefieren que nosotros les demos la línea en vez
 * de traer la suya propia (que sigue siendo la opción por defecto — ver
 * campos manuales de Phone Number ID/Access Token en la pestaña WhatsApp).
 */
export async function searchTelnyxNumbersAction(search?: string): Promise<TelnyxAvailableNumber[]> {
  const { session } = await requireAuthForApi()
  if (!session || session.role !== "super_admin") return []
  return await searchArgentinaNumbers(search)
}

/**
 * Compra un número puntual y lo guarda en la config del cliente. Sólo deja
 * el número comprado (telnyxPhoneNumber) — el Phone Number ID/Access Token
 * de WhatsApp siguen siendo un paso manual aparte (ver nota en lib/telnyx.ts).
 */
export async function buyTelnyxNumberAction(
  configId: string,
  phoneNumber: string,
): Promise<{ success: boolean; error?: string; config?: WhatsAppConfig }> {
  // Gasta dinero real (alta de un número en Telnyx) — sólo super_admin.
  const { session } = await requireAuthForApi()
  if (!session || session.role !== "super_admin") {
    return { success: false, error: "No autorizado." }
  }

  const result = await buyPhoneNumber(phoneNumber)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  const config = await updateConfig(configId, {
    lineSource: "telnyx",
    telnyxPhoneNumber: result.phoneNumber,
    telnyxOrderId: result.orderId,
    telnyxOrderStatus: result.status,
  })

  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/config/${configId}`)

  if (!config) {
    // La compra en Telnyx sí se concretó (ya se está pagando) aunque falle el
    // guardado en nuestra base — devolvemos el número igual para que quede
    // documentado y se pueda cargar a mano si hace falta.
    return {
      success: true,
      error: "El número se compró pero no se pudo guardar en la configuración. Guardalo a mano.",
    }
  }

  return { success: true, config }
}
