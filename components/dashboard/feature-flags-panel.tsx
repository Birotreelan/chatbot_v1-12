"use client"

import { useState, useEffect, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

// ----------------------------------------------------------------
// Descripción legible de cada flag
// ----------------------------------------------------------------
const FLAG_META: Record<
  string,
  { label: string; description: string; risk: "bajo" | "medio" | "alto"; sprint: string }
> = {
  directConfirmation: {
    label: "Confirmación directa",
    description: "Responde al botón Confirmar sin pasar por OpenAI.",
    risk: "bajo",
    sprint: "Sprint 2",
  },
  directCancellation: {
    label: "Cancelación directa",
    description: "Maneja el flujo de cancelación y doble confirmación sin OpenAI.",
    risk: "bajo",
    sprint: "Sprint 2",
  },
  antiRepetitionFarewell: {
    label: "Despedidas anti-repetición",
    description: "Detecta despedidas y responde sin OpenAI. Evita loops de cierre.",
    risk: "bajo",
    sprint: "Sprint 3",
  },
  directTurnSelection: {
    label: "Selección de turno por número",
    description: 'Resuelve "1", "2", "3" cuando hay turnos listados, sin OpenAI.',
    risk: "medio",
    sprint: "Sprint 4",
  },
  directDNIExtraction: {
    label: "Extracción de DNI",
    description: "Valida y extrae DNI directamente. Hasta 3 intentos antes de OpenAI.",
    risk: "medio",
    sprint: "Sprint 5",
  },
  directBookingFlow: {
    label: "Flujo de reserva (selecciones numéricas)",
    description: "Resuelve selecciones numéricas de obra social, sede, profesional y turno.",
    risk: "alto",
    sprint: "Sprint 6",
  },
  directSelectionExtraction: {
    label: "Selection Extractor Multi-Capa",
    description: "Detecta selecciones con 8 capas: números, letras, ordinales, posicionales, texto, fuzzy matching.",
    risk: "medio",
    sprint: "Sprint 7",
  },
  directReagendamiento: {
    label: "Flujo de reagendamiento",
    description: "Maneja el flujo completo de reagendamiento sin OpenAI.",
    risk: "alto",
    sprint: "Sprint 8",
  },
  directPacienteNuevo: {
    label: "Flujo paciente nuevo",
    description: "Guía el registro de un paciente nuevo paso a paso sin OpenAI.",
    risk: "alto",
    sprint: "Sprint 9",
  },
  directPacienteExistente: {
    label: "Flujo paciente existente",
    description: "Guía la búsqueda de turno para paciente existente sin OpenAI.",
    risk: "alto",
    sprint: "Sprint 9",
  },
}

const RISK_BADGE: Record<"bajo" | "medio" | "alto", string> = {
  bajo: "bg-green-100 text-green-800",
  medio: "bg-yellow-100 text-yellow-800",
  alto: "bg-red-100 text-red-800",
}

type FlagKey = keyof typeof FLAG_META
type Flags = Record<FlagKey, boolean>

const FLAG_ORDER: FlagKey[] = [
  "directConfirmation",
  "directCancellation",
  "antiRepetitionFarewell",
  "directTurnSelection",
  "directDNIExtraction",
  "directBookingFlow",
  "directSelectionExtraction",
  "directReagendamiento",
  "directPacienteNuevo",
  "directPacienteExistente",
]

export function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<Flags | null>(null)
  const [savedFlags, setSavedFlags] = useState<Flags | null>(null)
  const [isPending, startTransition] = useTransition()
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Cargar flags actuales
  useEffect(() => {
    fetch("/api/dashboard/feature-flags")
      .then((r) => r.json())
      .then((data) => {
        console.log("[v0] useEffect GET flags:", JSON.stringify(data.flags))
        setFlags(data.flags)
        setSavedFlags(data.flags)
      })
      .catch(() => setStatusMsg({ type: "error", text: "No se pudieron cargar los flags." }))
  }, [])

  const isDirty =
    flags && savedFlags && JSON.stringify(flags) !== JSON.stringify(savedFlags)

  function toggleFlag(key: FlagKey) {
    if (!flags) return
    setFlags({ ...flags, [key]: !flags[key] })
    setStatusMsg(null)
  }

  function handleSave() {
    if (!flags) return
    startTransition(async () => {
      try {
        console.log("[v0] handleSave - flags que se envían:", JSON.stringify(flags))
        const res = await fetch("/api/dashboard/feature-flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flags }),
        })
        const data = await res.json()
        console.log("[v0] handleSave - respuesta POST:", JSON.stringify(data))
        if (!res.ok) throw new Error(data.error)

        // Re-fetch desde Redis para confirmar el estado real guardado
        const verify = await fetch("/api/dashboard/feature-flags")
        const verifyData = await verify.json()
        console.log("[v0] handleSave - re-fetch GET confirma:", JSON.stringify(verifyData.flags))
        const confirmedFlags = verifyData.flags ?? data.flags

        setSavedFlags(confirmedFlags)
        setFlags(confirmedFlags)
        setStatusMsg({ type: "success", text: "Flags guardados correctamente." })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido"
        setStatusMsg({ type: "error", text: `Error al guardar: ${msg}` })
      }
    })
  }

  function handleReset() {
    if (!confirm("¿Resetear TODOS los flags globales a OFF? Esto afecta a todos los clientes.")) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/feature-flags", { method: "DELETE" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setSavedFlags(data.flags)
        setFlags(data.flags)
        setStatusMsg({ type: "success", text: "Todos los flags reseteados a OFF." })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido"
        setStatusMsg({ type: "error", text: `Error al resetear: ${msg}` })
      }
    })
  }

  if (!flags) {
    return (
      <div className="p-6 border rounded-lg">
        <p className="text-muted-foreground text-sm">Cargando configuración...</p>
      </div>
    )
  }

  const activeCount = Object.values(flags).filter(Boolean).length

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-muted/40">
        <div>
          <p className="text-sm text-muted-foreground">
            {activeCount} de {FLAG_ORDER.length} flags activos &mdash; aplican globalmente a todos los clientes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={isPending}
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
          >
            Resetear todo a OFF
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending || !isDirty}>
            {isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div
          className={`px-6 py-2 text-sm ${
            statusMsg.type === "success"
              ? "bg-green-50 text-green-800 border-b border-green-200"
              : "bg-red-50 text-red-800 border-b border-red-200"
          }`}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Unsaved changes warning */}
      {isDirty && (
        <div className="px-6 py-2 text-sm bg-yellow-50 text-yellow-800 border-b border-yellow-200">
          Hay cambios sin guardar. Presiona &quot;Guardar cambios&quot; para aplicarlos.
        </div>
      )}

      {/* Flag list */}
      <div className="divide-y">
        {FLAG_ORDER.map((key) => {
          const meta = FLAG_META[key]
          const isActive = flags[key]
          return (
            <div
              key={key}
              className={`flex items-center justify-between px-6 py-4 transition-colors ${
                isActive ? "bg-background" : "bg-muted/20"
              }`}
            >
              <div className="flex-1 min-w-0 pr-8">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-sm">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{meta.sprint}</span>
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${RISK_BADGE[meta.risk]}`}
                  >
                    Riesgo {meta.risk}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge
                  className={
                    isActive
                      ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-100"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted"
                  }
                  variant="outline"
                >
                  {isActive ? "Activo" : "Inactivo"}
                </Badge>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => toggleFlag(key)}
                  disabled={isPending}
                  aria-label={`${isActive ? "Desactivar" : "Activar"} ${meta.label}`}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer nota */}
      <Separator />
      <div className="px-6 py-3 bg-muted/20">
        <p className="text-xs text-muted-foreground">
          Los cambios aplican a todos los clientes que no tengan flags individuales configurados.
          El rollback es inmediato: desactivar un flag restaura el comportamiento anterior sin deploy.
        </p>
      </div>
    </div>
  )
}
