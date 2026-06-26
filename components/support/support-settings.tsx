"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "./session-provider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Users, Bot, AlertCircle } from "lucide-react"

interface ConfigSettings {
  configId: string
  configName: string
  humanSupport: boolean
  humanSupportOfferToPatient: boolean
}

export function SupportSettings() {
  const [settings, setSettings] = useState<ConfigSettings[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null) // "configId:flag"
  const [error, setError] = useState<string | null>(null)
  const { getAuthHeaders, sessionId } = useSession()

  const load = useCallback(async () => {
    try {
      let url = "/api/support/settings"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, { credentials: "include", headers: { ...getAuthHeaders() } })
      const data = await res.json()
      if (data.success) setSettings(data.settings || [])
      else setError(data.error || "Error al cargar")
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, sessionId])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(configId: string, flag: "humanSupport" | "humanSupportOfferToPatient", value: boolean) {
    const key = `${configId}:${flag}`
    setSaving(key)
    try {
      let url = "/api/support/settings"
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ configId, flag, value }),
      })
      const data = await res.json()
      if (data.success) {
        setSettings((prev) =>
          prev.map((s) =>
            s.configId === configId
              ? { ...s, humanSupport: data.humanSupport, humanSupportOfferToPatient: data.humanSupportOfferToPatient }
              : s
          )
        )
      } else {
        alert(data.error || "No se pudo guardar")
      }
    } catch {
      alert("Error al guardar")
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Cargando configuración...</p>
  }

  if (error) {
    return (
      <div className="flex items-center gap-1.5 text-destructive text-xs py-4">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{error}</span>
      </div>
    )
  }

  if (!settings.length) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No hay configuraciones disponibles.</p>
  }

  return (
    <div className="space-y-5">
      {settings.map((s) => (
        <div key={s.configId} className="space-y-3">
          {settings.length > 1 && (
            <p className="text-xs font-semibold text-foreground">{s.configName}</p>
          )}

          {/* Soporte Humano */}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Label className="text-sm font-medium cursor-pointer">Soporte Humano</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Los agentes pueden intervenir y chatear directamente con el paciente.
              </p>
            </div>
            <Switch
              checked={s.humanSupport}
              disabled={saving === `${s.configId}:humanSupport`}
              onCheckedChange={(v) => toggle(s.configId, "humanSupport", v)}
            />
          </div>

          {/* Ofrecer al Paciente */}
          <div
            className={`flex items-center justify-between gap-4 rounded-lg border p-3 transition-opacity ${
              !s.humanSupport ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Label className="text-sm font-medium cursor-pointer">Ofrecer al Paciente</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Cuando el asistente no puede responder, le ofrece al paciente hablar con una persona.
              </p>
            </div>
            <Switch
              checked={s.humanSupportOfferToPatient}
              disabled={!s.humanSupport || saving === `${s.configId}:humanSupportOfferToPatient`}
              onCheckedChange={(v) => toggle(s.configId, "humanSupportOfferToPatient", v)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
