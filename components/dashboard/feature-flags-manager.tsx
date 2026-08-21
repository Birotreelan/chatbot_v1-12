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

interface ClientOverride {
  configId: string
  displayName: string
  rawFlags: Record<string, boolean>
  keyCount: number
}

// Flags que un cliente puede llegar a controlar legítimamente desde su propio
// panel (ej. Atención Treelan Iris → app/api/support/settings/route.ts). Todo
// lo demás que aparezca guardado para un cliente es, casi siempre, resto de un
// snapshot viejo "congelado" (ver nota en setClientFeatureFlags).
const CLIENT_CONTROLLED_KEYS = ["humanSupport", "humanSupportOfferToPatient"]

/**
 * Overrides por cliente (21/8/2026, caso Instituto Privado de Ojos Dres.
 * Filomena): permite ver qué clientes tienen flags propios guardados en Redis
 * y "recortarlos" a solo los que el cliente controla activamente, para que
 * dejen de estar excluidos de las mejoras activadas por código para el resto.
 */
function ClientOverridesSection() {
  const [clients, setClients] = useState<ClientOverride[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      setIsLoading(true)
      const res = await fetch("/api/dashboard/feature-flags/clients")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al cargar")
      setClients(data.clients)
    } catch (error) {
      console.error("Error cargando overrides por cliente:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los overrides por cliente",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function pruneToHumanSupport(configId: string) {
    if (
      !confirm(
        "Esto recorta el override de este cliente a solo los flags de Atención Humana. El resto vuelve a heredar los flags globales/código. ¿Continuar?"
      )
    ) {
      return
    }
    try {
      setBusyId(configId)
      const res = await fetch("/api/dashboard/feature-flags/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, action: "prune", keysToKeep: CLIENT_CONTROLLED_KEYS }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al recortar")
      toast({ title: "Limpiado", description: "Ahora hereda los flags globales/código salvo Atención Humana." })
      await load()
    } catch (error) {
      console.error("Error recortando flags de cliente:", error)
      toast({ title: "Error", description: "No se pudo limpiar", variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  async function resetClient(configId: string) {
    if (!confirm("Esto borra TODO el override propio de este cliente (incluida Atención Humana si está guardada acá). ¿Continuar?")) {
      return
    }
    try {
      setBusyId(configId)
      const res = await fetch("/api/dashboard/feature-flags/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, action: "reset" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al resetear")
      toast({ title: "Reseteado", description: "Vuelve a heredar los flags globales/código." })
      await load()
    } catch (error) {
      console.error("Error reseteando flags de cliente:", error)
      toast({ title: "Error", description: "No se pudo resetear", variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return <div className="text-center py-8">Cargando overrides por cliente...</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overrides por cliente</CardTitle>
        <CardDescription>
          Clientes con flags propios guardados en Redis (ej. al activar "Atención Humana" desde su panel). Si un
          cliente tiene varias claves de más acá, es probablemente un snapshot viejo que lo dejó afuera de mejoras
          activadas por código para el resto de los clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {clients.length === 0 && (
          <p className="text-sm text-muted-foreground">Ningún cliente tiene overrides propios guardados.</p>
        )}
        {clients.map((c) => (
          <div key={c.configId} className="p-3 border rounded-lg space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium text-sm">{c.displayName}</div>
                <code className="text-xs text-muted-foreground">{c.configId}</code>
              </div>
              <Badge variant={c.keyCount > CLIENT_CONTROLLED_KEYS.length ? "destructive" : "secondary"}>
                {c.keyCount} {c.keyCount === 1 ? "flag guardado" : "flags guardados"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(c.rawFlags).map(([k, v]) => (
                <Badge key={k} variant="outline" className="text-xs font-normal">
                  {k}: {v ? "ON" : "OFF"}
                </Badge>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={busyId === c.configId} onClick={() => pruneToHumanSupport(c.configId)}>
                Limpiar (dejar solo Atención Humana)
              </Button>
              <Button size="sm" variant="ghost" disabled={busyId === c.configId} onClick={() => resetClient(c.configId)}>
                Resetear todo
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
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

      <ClientOverridesSection />
    </div>
  )
}
