"use client"

import { WhatsAppConfigForm } from "./whatsapp-config-form"
import type { WhatsAppConfig } from "@/lib/types"

interface WhatsAppConfigFormWrapperProps {
  config?: WhatsAppConfig
  isNew?: boolean
}

export function WhatsAppConfigFormWrapper({ config, isNew = false }: WhatsAppConfigFormWrapperProps) {
  console.log("[WRAPPER] isNew:", isNew, "config:", config?.id || "undefined")

  return <WhatsAppConfigForm config={config} isNew={isNew} />
}
