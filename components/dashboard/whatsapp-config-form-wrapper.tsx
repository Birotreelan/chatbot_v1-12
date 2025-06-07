"use client"

import { WhatsAppConfigForm } from "./whatsapp-config-form"
import type { WhatsAppConfig } from "@/lib/types"

interface WhatsAppConfigFormWrapperProps {
  config?: WhatsAppConfig
  isNew?: boolean
}

export function WhatsAppConfigFormWrapper({ config, isNew = false }: WhatsAppConfigFormWrapperProps) {
  return <WhatsAppConfigForm config={config} isNew={isNew} />
}
