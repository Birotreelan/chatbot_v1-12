"use client"

import { useEffect, useState } from "react"
import { FlowsSetup } from "@/components/dashboard/flows-setup"
import type { WhatsAppConfig } from "@/lib/types"

export default function FlowsPage() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    fetch("/api/dashboard/configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setConfigs(Array.isArray(d) ? d : []))
      .catch(() => setConfigs([]))
      .finally(() => setCargando(false))
  }, [])

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">WhatsApp Flows</h1>
        <p className="mt-2 text-muted-foreground">
          Crear y publicar el Flow de reagendamiento y el template de recordatorio con botones, sin
          pasar por Meta for Developers.
        </p>
      </div>

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando configuraciones...</p>
      ) : configs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay configuraciones de WhatsApp cargadas.</p>
      ) : (
        <FlowsSetup configs={configs} />
      )}
    </div>
  )
}
