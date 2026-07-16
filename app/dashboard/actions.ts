"use server"

import { revalidatePath } from "next/cache"
import {
  createWhatsAppConfig as createConfig,
  updateWhatsAppConfig as updateConfig,
  deleteWhatsAppConfig as deleteConfig,
} from "@/lib/db"
import type { WhatsAppConfig } from "@/lib/types"
import { createTurnstileWidget, updateTurnstileWidgetDomains } from "@/lib/cloudflare-turnstile"

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
