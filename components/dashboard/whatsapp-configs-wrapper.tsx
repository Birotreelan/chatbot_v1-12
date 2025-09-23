"use client"

import { useEffect, useState } from "react"
import { WhatsAppConfigList } from "./whatsapp-config-list"
import { EmptyState } from "./empty-state"
import type { WhatsAppConfig } from "@/lib/types"

export default function WhatsAppConfigsWrapper() {
  const [configs, setConfigs] = useState<WhatsAppConfig[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchConfigs = async () => {
      try {
        const response = await fetch("/api/dashboard/configs")
        if (response.ok) {
          const data = await response.json()
          setConfigs(data)
        }
      } catch (error) {
        console.error("Error al cargar configuraciones:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchConfigs()
  }, [])

  if (loading) {
    return <div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>
  }

  if (!configs) {
    return (
      <div className="p-4 border rounded-md my-4 text-center">
        No se pudieron cargar las configuraciones. Por favor, intenta de nuevo más tarde.
      </div>
    )
  }

  if (configs.length === 0) {
    return <EmptyState />
  }

  return <WhatsAppConfigList configs={configs} />
}
