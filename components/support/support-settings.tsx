"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "./session-provider"
import { ScheduleConfigurator } from "@/components/dashboard/schedule-configurator"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Users, Bot, AlertCircle, Clock, Check } from "lucide-react"
import type { DaySchedule } from "@/lib/types"

interface ConfigSettings {
  configId: string
  configName: string
  timezone: string
  humanSupport: boolean
  humanSupportOfferToPatient: boolean
  humanSupportSchedule: DaySchedule[]
}

export function SupportSettings() {
  const [settings, setSettings] = useState<ConfigSettings[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFlag, setSavingFlag] = useState<string | null>(null)
  const [savingSchedule, setSavingSchedule] = useState<string | null>(null)
  const [savedSchedule, setSavedSchedule] = useState<string | null>(null)
  const [localSchedules, setLocalSchedules] = useState<Record<string, DaySchedule[]>>({})
  const [error, setError] = useState<string | null>(null)
  const { getAuthHeaders, sessionId } = useSession()

  const buildUrl = useCallback(
    (path: string) => {
      let url = path
      if (sessionId) url += `?_sid=${encodeURIComponent(sessionId)}`
      return url
    },
    [sessionId]
  )

  const load = useCallback(async () => {
    try {
      const res = await fetch(buildUrl("/api/support/settings"), {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      })
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings || [])
        // Init local schedule state
        const initial: Record<string, DaySchedule[]> = {}
        for (const s of data.settings || []) {
          initial[s.configId] = s.humanSupportSchedule || []
        }
        setLocalSchedules(initial)
      } else {
        setError(data.error || "Error al cargar")
      }
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }, [buildUrl, getAuthHeaders])

  useEffect(() => {
    load()
  }, [load])

  async function toggleFlag(
    configId: string,
    flag: "humanSupport" | "humanSupportOfferToPatient",
    value: boolean
  ) {
    const key = `${configId}:${flag}`
    setSavingFlag(key)
    try {
      const res = await fetch(buildUrl("/api/support/settings"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ configId, action: "flag", flag, value }),
      })
      const data = await res.json()
      if (data.success) {
        setSettings((prev) =>
          prev.map((s) =>
            s.configId === configId
              ? {
                  ...s,
                  humanSupport: data.humanSupport,
                  humanSupportOfferToPatient: data.humanSupportOfferToPatient,
                }
              : s
          )
        )
      } else {
        alert(data.error || "No se pudo guardar")
      }
    } catch {
      alert("Error al guardar")
    } finally {
      setSavingFlag(null)
    }
  }

  async function saveSchedule(configId: string) {
    setSavingSchedule(configId)
    try {
      const res = await fetch(buildUrl("/api/support/settings"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          configId,
          action: "schedule",
          schedule: localSchedules[configId] || [],
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSavedSchedule(configId)
        setTimeout(() => setSavedSchedule(null), 2000)
      } else {
        alert(data.error || "No se pudo guardar el horario")
      }
    } catch {
      alert("Error al guardar el horario")
    } finally {
      setSavingSchedule(null)
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
    <div className="space-y-6">
      {settings.map((s) => (
        <div key={s.configId} className="space-y-4">
          {settings.length > 1 && (
            <p className="text-xs font-semibold text-foreground">{s.configName}</p>
          )}

          {/* ── Soporte Humano toggle ─────────────────────────────────── */}
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
              disabled={savingFlag === `${s.configId}:humanSupport`}
              onCheckedChange={(v) => toggleFlag(s.configId, "humanSupport", v)}
            />
          </div>

          {/* ── Ofrecer al Paciente toggle ────────────────────────────── */}
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
              disabled={!s.humanSupport || savingFlag === `${s.configId}:humanSupportOfferToPatient`}
              onCheckedChange={(v) => toggleFlag(s.configId, "humanSupportOfferToPatient", v)}
            />
          </div>

          <Separator />

          {/* ── Horario de Atención ───────────────────────────────────── */}
          <div
            className={`space-y-3 transition-opacity ${!s.humanSupport ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-medium">Horario de Atención Humana</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Fuera de este horario el paciente igualmente puede ser derivado, pero se le indicará
              que recibirá respuesta dentro del horario configurado. Si no configurás ningún día,
              se considera disponible siempre.
            </p>

            <ScheduleConfigurator
              schedule={localSchedules[s.configId] || []}
              onChange={(schedule) =>
                setLocalSchedules((prev) => ({ ...prev, [s.configId]: schedule }))
              }
            />

            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8 px-4 text-xs gap-1.5"
                disabled={savingSchedule === s.configId}
                onClick={() => saveSchedule(s.configId)}
              >
                {savedSchedule === s.configId ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Guardado
                  </>
                ) : savingSchedule === s.configId ? (
                  "Guardando..."
                ) : (
                  "Guardar horario"
                )}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
