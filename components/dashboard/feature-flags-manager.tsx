"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

// Todas las claves de FeatureFlags (lib/conversation-state/types.ts), agrupadas para
// que la pantalla sea legible en vez de una lista plana de ~29 switches. Si se agrega
// un flag nuevo al tipo y no se lista acá, igual aparece en el grupo "Otros" (fallback
// más abajo), no se pierde.
const FLAG_GROUPS: Array<{ title: string; description: string; keys: string[] }> = [
  {
    title: "Router de intención (AI Dispatcher)",
    description: "Controlan si el asistente de IA decide la intención antes que la cascada de reglas.",
    keys: ["intentRouterFull", "intentRouterClinicaOffer", "aiDispatcher"],
  },
  {
    title: "Flujo determinístico (Sprints 1–18)",
    description: "Interceptores de reglas/regex para confirmación, cancelación, reserva, despedidas, etc.",
    keys: [
      "directConfirmation",
      "directCancellation",
      "directTurnSelection",
      "directDNIExtraction",
      "antiRepetitionFarewell",
      "directReagendamiento",
      "directPacienteNuevo",
      "directPacienteExistente",
      "directBookingFlow",
      "directSelectionExtraction",
      "directPatientDetection",
      "directExistingPatientFlow",
      "pendingFlowContextualNLU",
      "directFarewellDetection",
      "directWrongNumberDetection",
      "directConfirmCancelDetection",
      "reciprocalFarewellSilence",
      "directInformationalQuery",
      "postActionContextHandler",
      "nluFallbackRouter",
      "flowInterruptionHandler",
    ],
  },
  {
    title: "Otros",
    description: "Historial, respuestas humanizadas y atención humana.",
    keys: ["entityExtraction", "conversationHistory", "humanizedResponses", "humanSupport", "humanSupportOfferToPatient"],
  },
]

// Etiquetas legibles en español. Si un flag no está acá, se muestra el nombre técnico tal cual.
const FLAG_LABELS: Record<string, string> = {
  intentRouterFull: "Master flag: router de intención decide TODO el flujo de turnos",
  intentRouterClinicaOffer: "Router de intención — oferta post-template de clínica",
  aiDispatcher: "AI Dispatcher (Sprint 60) — clasificador GPT-4o-mini",
  directConfirmation: "Confirmación directa por texto libre",
  directCancellation: "Cancelación directa (incl. flujos pendientes: turno, doble confirmación)",
  directTurnSelection: "Selección de turno por número",
  directDNIExtraction: "Extracción de DNI",
  antiRepetitionFarewell: "Anti-repetición de despedidas",
  directReagendamiento: "Reagendamiento directo",
  directPacienteNuevo: "Flujo paciente nuevo",
  directPacienteExistente: "Flujo paciente existente",
  directBookingFlow: "Flujo de reserva unificado (obra social/sede/profesional/turno)",
  directSelectionExtraction: "Extractor de selecciones inteligente (fuzzy matching)",
  directPatientDetection: "Detección inicial de paciente (saludo + menú)",
  directExistingPatientFlow: "Flujo completo de reserva para paciente existente",
  pendingFlowContextualNLU: "NLU contextual dentro de flujos pendientes",
  directFarewellDetection: "Detección de despedida pre-flujo",
  directWrongNumberDetection: "Detección de número equivocado",
  directConfirmCancelDetection: "Confirmación/cancelación directa (ventana 24h de template)",
  reciprocalFarewellSilence: "Silencio ante despedida recíproca (\"igualmente\")",
  directInformationalQuery: "Consultas informativas directas (dirección, hora, etc.)",
  postActionContextHandler: "Contexto post-acción (explicaciones tras cancelar/confirmar)",
  nluFallbackRouter: "NLU Fallback Router (Sprint 18)",
  flowInterruptionHandler: "Interceptor de consultas intercaladas en flujos activos",
  entityExtraction: "Extracción de entidades / slot filling",
  conversationHistory: "Historial conversacional en Redis",
  humanizedResponses: "Respuestas humanizadas por IA",
  humanSupport: "Atención humana habilitada",
  humanSupportOfferToPatient: "Ofrecer atención humana al paciente",
}

interface FlagsApiResponse {
  flags: Record<string, boolean>
  hasExplicitData: boolean
  codeOverriddenKeys: string[]
  availableKeys: string[]
  error?: string
}

export function FeatureFlagsManager() {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [codeOverriddenKeys, setCodeOverriddenKeys] = useState<string[]>([])
  const [hasExplicitData, setHasExplicitData] = useState(false)
  const [availableKeys, setAvailableKeys] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    loadFlags()
  }, [])

  async function loadFlags() {
    try {
      setIsLoading(true)
      const res = await fetch("/api/dashboard/feature-flags")
      const data: FlagsApiResponse = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al cargar flags")
      setFlags(data.flags)
      setCodeOverriddenKeys(data.codeOverriddenKeys)
      setHasExplicitData(data.hasExplicitData)
      setAvailableKeys(data.availableKeys)
    } catch (error) {
      console.error("Error cargando feature flags:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los feature flags",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function toggleFlag(key: string, value: boolean) {
    const previous = flags
    // Optimista: reflejar el cambio de inmediato, revertir si falla el guardado.
    const nextFlags = { ...flags, [key]: value }
    setFlags(nextFlags)
    setSavingKey(key)
    try {
      const res = await fetch("/api/dashboard/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags: nextFlags }),
      })
      const data: FlagsApiResponse = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al guardar")
      setFlags(data.flags)
      setCodeOverriddenKeys(data.codeOverriddenKeys)
      setHasExplicitData(data.hasExplicitData)
      toast({
        title: value ? "Flag activado" : "Flag desactivado",
        description: FLAG_LABELS[key] || key,
      })
    } catch (error) {
      console.error("Error guardando flag:", error)
      setFlags(previous)
      toast({
        title: "Error",
        description: "No se pudo guardar el cambio. Se revirtió.",
        variant: "destructive",
      })
    } finally {
      setSavingKey(null)
    }
  }

  async function handleReset() {
    if (!confirm("Esto borra TODOS los valores guardados en Redis y vuelve a depender de GLOBAL_CODE_FEATURE_FLAG_OVERRIDES (código). ¿Continuar?")) {
      return
    }
    try {
      setIsResetting(true)
      const res = await fetch("/api/dashboard/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      })
      const data: FlagsApiResponse = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al resetear")
      setFlags(data.flags)
      setCodeOverriddenKeys(data.codeOverriddenKeys)
      setHasExplicitData(data.hasExplicitData)
      toast({ title: "Restablecido", description: "Los flags globales vuelven a depender del código." })
    } catch (error) {
      console.error("Error reseteando flags:", error)
      toast({ title: "Error", description: "No se pudo resetear", variant: "destructive" })
    } finally {
      setIsResetting(false)
    }
  }

  if (isLoading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  const groupedKeys = new Set(FLAG_GROUPS.flatMap((g) => g.keys))
  const ungroupedKeys = availableKeys.filter((k) => !groupedKeys.has(k))
  const groups = ungroupedKeys.length > 0
    ? [...FLAG_GROUPS, { title: "Otros (sin agrupar)", description: "", keys: ungroupedKeys }]
    : FLAG_GROUPS

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Badge variant={hasExplicitData ? "default" : "secondary"}>
          {hasExplicitData
            ? "Redis es la fuente de verdad para estos flags"
            : "Todavía sin cambios guardados — rigen los overrides de código"}
        </Badge>
        <Button variant="outline" onClick={handleReset} disabled={isResetting}>
          Restablecer a valores por código
        </Button>
      </div>

      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            {group.description && <CardDescription>{group.description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {group.keys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{FLAG_LABELS[key] || key}</span>
                    {codeOverriddenKeys.includes(key) && (
                      <Badge variant="secondary" className="text-xs">
                        Código
                      </Badge>
                    )}
                  </div>
                  <code className="text-xs text-muted-foreground">{key}</code>
                </div>
                <Switch
                  checked={flags[key] === true}
                  disabled={savingKey === key}
                  onCheckedChange={(checked) => toggleFlag(key, checked)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
