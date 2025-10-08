"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { WhatsAppConfigForm } from "./whatsapp-config-form"
import type { WhatsAppConfig } from "@/lib/types"
import { createWhatsAppConfig, updateWhatsAppConfig } from "@/app/dashboard/actions"

interface WhatsAppConfigFormWrapperProps {
  config?: WhatsAppConfig
  isNew?: boolean
}

export function WhatsAppConfigFormWrapper({ config, isNew = false }: WhatsAppConfigFormWrapperProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSave = async (data: Partial<WhatsAppConfig>) => {
    setIsLoading(true)
    try {
      if (isNew) {
        await createWhatsAppConfig(data)
      } else if (config?.id) {
        await updateWhatsAppConfig(config.id, data)
      }
      router.push("/dashboard")
      router.refresh()
    } catch (error) {
      console.error("Error saving config:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    router.push("/dashboard")
  }

  return (
    <WhatsAppConfigForm
      config={config}
      isNew={isNew}
      onSave={handleSave}
      onCancel={handleCancel}
      isLoading={isLoading}
    />
  )
}
