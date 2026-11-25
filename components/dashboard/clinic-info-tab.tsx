"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { Plus, Trash2, Info, Globe, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import type { ClinicInfo, ClinicInfoImportJob } from "@/lib/types"

interface ClinicInfoTabProps {
  clienteId?: string
}

interface SedeRow {
  nombre: string
  direccion: string
  horario: string
  comoLlegar: string
}

interface ProfesionalRow {
  nombre: string
  especialidad: string
}

/**
 * ── Las filas de los cuatro bloques nuevos (25/11/2026) ───────────────────
 *
 * Los campos salen de 37 preguntas reales en 709 conversaciones de cuatro
 * clínicas. El texto de ayuda de cada uno, abajo en el formulario, cita la
 * pregunta textual del paciente: a la clínica no se le pide "complete el campo
 * copago", se le muestra que alguien preguntó "¿con IOMA hay copago?" y no
 * supimos contestar.
 */
interface CoberturaRow {
  nombre: string
  planes: string
  planesNoAceptados: string
  requiereOrden: boolean
  copago: string
  comoAutorizar: string
}

interface EstudioRow {
  nombre: string
  requiereOrden: boolean
  dilata: boolean
  duracion: string
  preparacion: string
  sinConsultaPrevia: boolean
  arancelParticular: string
}

interface FormState {
  telefonoContacto: string
  emailContacto: string
  horarioAtencion: string
  sedes: SedeRow[]
  especialidades: string // lista separada por comas en la UI
  profesionales: ProfesionalRow[]
  equipamiento: string // lista separada por comas
  obrasSociales: string // lista separada por comas
  instruccionesPreConsulta: string
  cuidadosPostOperatorios: string
  informacionAdicional: string

  // Guardia
  guardiaDisponible: boolean
  guardiaHorarios: string
  guardiaPorOrdenDeLlegada: boolean
  guardiaSede: string
  guardiaQueSeAtiende: string
  guardiaQueNoSeAtiende: string

  // Coberturas, con plan y copago
  coberturas: CoberturaRow[]

  // Órdenes y autorizaciones
  ordenesHacenFalta: boolean
  ordenesComoObtenerla: string
  ordenesANombreDe: string
  ordenesCodigos: string
  ordenesSiNoLaTrae: string

  // Aranceles
  arancelConsulta: string
  arancelMediosDePago: string
  arancelFinanciacion: string
  arancelFacturacion: string
  arancelVigencia: string

  // Estudios
  estudios: EstudioRow[]
}

const EMPTY_FORM: FormState = {
  telefonoContacto: "",
  emailContacto: "",
  horarioAtencion: "",
  sedes: [],
  especialidades: "",
  profesionales: [],
  equipamiento: "",
  obrasSociales: "",
  instruccionesPreConsulta: "",
  cuidadosPostOperatorios: "",
  informacionAdicional: "",

  guardiaDisponible: false,
  guardiaHorarios: "",
  guardiaPorOrdenDeLlegada: false,
  guardiaSede: "",
  guardiaQueSeAtiende: "",
  guardiaQueNoSeAtiende: "",

  coberturas: [],

  ordenesHacenFalta: false,
  ordenesComoObtenerla: "",
  ordenesANombreDe: "",
  ordenesCodigos: "",
  ordenesSiNoLaTrae: "",

  arancelConsulta: "",
  arancelMediosDePago: "",
  arancelFinanciacion: "",
  arancelFacturacion: "",
  arancelVigencia: "",

  estudios: [],
}

function infoToForm(info: ClinicInfo | null): FormState {
  if (!info) return EMPTY_FORM
  return {
    telefonoContacto: info.telefonoContacto || "",
    emailContacto: info.emailContacto || "",
    horarioAtencion: info.horarioAtencion || "",
    sedes: (info.sedes || []).map((s) => ({
      nombre: s.nombre || "",
      direccion: s.direccion || "",
      horario: s.horario || "",
      comoLlegar: s.comoLlegar || "",
    })),
    especialidades: (info.especialidades || []).join(", "),
    profesionales: (info.profesionales || []).map((p) => ({ nombre: p.nombre || "", especialidad: p.especialidad || "" })),
    equipamiento: (info.equipamiento || []).join(", "),
    obrasSociales: (info.obrasSociales || []).join(", "),
    instruccionesPreConsulta: info.instruccionesPreConsulta || "",
    cuidadosPostOperatorios: info.cuidadosPostOperatorios || "",
    informacionAdicional: info.informacionAdicional || "",

    guardiaDisponible: info.guardia?.disponible === true,
    guardiaHorarios: info.guardia?.horarios || "",
    guardiaPorOrdenDeLlegada: info.guardia?.porOrdenDeLlegada === true,
    guardiaSede: info.guardia?.sede || "",
    guardiaQueSeAtiende: info.guardia?.queSeAtiende || "",
    guardiaQueNoSeAtiende: info.guardia?.queNoSeAtiende || "",

    coberturas: (info.coberturas || []).map((c) => ({
      nombre: c.nombre || "",
      planes: (c.planes || []).join(", "),
      planesNoAceptados: (c.planesNoAceptados || []).join(", "),
      requiereOrden: c.requiereOrden === true,
      copago: c.copago || "",
      comoAutorizar: c.comoAutorizar || "",
    })),

    ordenesHacenFalta: info.ordenesYAutorizaciones?.hacenFalta === true,
    ordenesComoObtenerla: info.ordenesYAutorizaciones?.comoObtenerla || "",
    ordenesANombreDe: info.ordenesYAutorizaciones?.aNombreDe || "",
    ordenesCodigos: info.ordenesYAutorizaciones?.codigos || "",
    ordenesSiNoLaTrae: info.ordenesYAutorizaciones?.siNoLaTrae || "",

    arancelConsulta: info.aranceles?.consultaParticular || "",
    arancelMediosDePago: (info.aranceles?.mediosDePago || []).join(", "),
    arancelFinanciacion: info.aranceles?.financiacion || "",
    arancelFacturacion: info.aranceles?.facturacion || "",
    arancelVigencia: info.aranceles?.vigenciaDeclarada || "",

    estudios: (info.estudios || []).map((e) => ({
      nombre: e.nombre || "",
      requiereOrden: e.requiereOrden === true,
      dilata: e.dilata === true,
      duracion: e.duracion || "",
      preparacion: e.preparacion || "",
      sinConsultaPrevia: e.sinConsultaPrevia === true,
      arancelParticular: e.arancelParticular || "",
    })),
  }
}

function draftToForm(draft: Partial<ClinicInfo>): FormState {
  return infoToForm(draft as ClinicInfo)
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

function formToUpdates(form: FormState): Partial<ClinicInfo> {
  return {
    telefonoContacto: form.telefonoContacto.trim() || undefined,
    emailContacto: form.emailContacto.trim() || undefined,
    horarioAtencion: form.horarioAtencion.trim() || undefined,
    sedes: form.sedes.filter((s) => s.nombre || s.direccion || s.horario || s.comoLlegar),
    especialidades: splitList(form.especialidades),
    profesionales: form.profesionales.filter((p) => p.nombre.trim()),
    equipamiento: splitList(form.equipamiento),
    obrasSociales: splitList(form.obrasSociales),
    instruccionesPreConsulta: form.instruccionesPreConsulta.trim() || undefined,
    cuidadosPostOperatorios: form.cuidadosPostOperatorios.trim() || undefined,
    informacionAdicional: form.informacionAdicional.trim() || undefined,

    /**
     * Los bloques vacíos van como `undefined` y no como un objeto con todo en
     * blanco: `formatClinicInfoForLLM` pregunta por el bloque para decidir si
     * lo escribe, y un objeto vacío le haría imprimir un título sin nada
     * debajo. El modelo lee eso como "la clínica tiene guardia pero no sé
     * nada", que es peor que no saber que existe.
     */
    guardia:
      form.guardiaDisponible ||
      form.guardiaHorarios.trim() ||
      form.guardiaQueSeAtiende.trim() ||
      form.guardiaQueNoSeAtiende.trim() ||
      form.guardiaSede.trim()
        ? {
            disponible: form.guardiaDisponible,
            horarios: form.guardiaHorarios.trim() || undefined,
            porOrdenDeLlegada: form.guardiaPorOrdenDeLlegada,
            sede: form.guardiaSede.trim() || undefined,
            queSeAtiende: form.guardiaQueSeAtiende.trim() || undefined,
            queNoSeAtiende: form.guardiaQueNoSeAtiende.trim() || undefined,
          }
        : undefined,

    coberturas: form.coberturas
      .filter((c) => c.nombre.trim())
      .map((c) => ({
        nombre: c.nombre.trim(),
        planes: splitList(c.planes),
        planesNoAceptados: splitList(c.planesNoAceptados),
        requiereOrden: c.requiereOrden,
        copago: c.copago.trim() || undefined,
        comoAutorizar: c.comoAutorizar.trim() || undefined,
      })),

    ordenesYAutorizaciones:
      form.ordenesHacenFalta ||
      form.ordenesComoObtenerla.trim() ||
      form.ordenesANombreDe.trim() ||
      form.ordenesCodigos.trim() ||
      form.ordenesSiNoLaTrae.trim()
        ? {
            hacenFalta: form.ordenesHacenFalta,
            comoObtenerla: form.ordenesComoObtenerla.trim() || undefined,
            aNombreDe: form.ordenesANombreDe.trim() || undefined,
            codigos: form.ordenesCodigos.trim() || undefined,
            siNoLaTrae: form.ordenesSiNoLaTrae.trim() || undefined,
          }
        : undefined,

    aranceles:
      form.arancelConsulta.trim() ||
      form.arancelMediosDePago.trim() ||
      form.arancelFinanciacion.trim() ||
      form.arancelFacturacion.trim() ||
      form.arancelVigencia.trim()
        ? {
            consultaParticular: form.arancelConsulta.trim() || undefined,
            mediosDePago: splitList(form.arancelMediosDePago),
            financiacion: form.arancelFinanciacion.trim() || undefined,
            facturacion: form.arancelFacturacion.trim() || undefined,
            vigenciaDeclarada: form.arancelVigencia.trim() || undefined,
          }
        : undefined,

    estudios: form.estudios
      .filter((e) => e.nombre.trim())
      .map((e) => ({
        nombre: e.nombre.trim(),
        requiereOrden: e.requiereOrden,
        dilata: e.dilata,
        duracion: e.duracion.trim() || undefined,
        preparacion: e.preparacion.trim() || undefined,
        sinConsultaPrevia: e.sinConsultaPrevia,
        arancelParticular: e.arancelParticular.trim() || undefined,
      })),
  }
}

const POLL_INTERVAL_MS = 2000

export function ClinicInfoTab({ clienteId }: ClinicInfoTabProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [savedMeta, setSavedMeta] = useState<{ sourceUrl?: string; updatedAt?: string; updatedBy?: string } | null>(
    null,
  )

  const [importUrl, setImportUrl] = useState("")
  const [importJob, setImportJob] = useState<ClinicInfoImportJob | null>(null)
  const [importing, setImporting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cargar lo guardado al entrar / cambiar de cliente.
  useEffect(() => {
    if (!clienteId) return
    setLoading(true)
    fetch(`/api/dashboard/clinic-info/${encodeURIComponent(clienteId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setForm(infoToForm(data.info))
          setSavedMeta(data.info ? { sourceUrl: data.info.sourceUrl, updatedAt: data.info.updatedAt, updatedBy: data.info.updatedBy } : null)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clienteId])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const applyJobResult = useCallback(
    (job: ClinicInfoImportJob) => {
      setImportJob(job)
      if (job.status === "done" && job.draft) {
        setForm(draftToForm(job.draft))
        toast({ title: "Importación completa", description: "Revisá los datos encontrados y guardá cuando estés conforme." })
        stopPolling()
        setImporting(false)
      } else if (job.status === "error") {
        toast({ title: "No se pudo importar", description: job.error || "Error desconocido", variant: "destructive" })
        stopPolling()
        setImporting(false)
      }
    },
    [stopPolling, toast],
  )

  const startImport = async () => {
    if (!clienteId || !importUrl.trim()) return
    setImporting(true)
    setImportJob(null)
    try {
      const res = await fetch("/api/dashboard/clinic-info/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, url: importUrl.trim() }),
      })
      const data = await res.json()
      if (!data.success || !data.job) {
        toast({ title: "Error", description: "No se pudo iniciar la importación.", variant: "destructive" })
        setImporting(false)
        return
      }

      applyJobResultOrPoll(data.job)
    } catch (error) {
      toast({ title: "Error", description: "No se pudo iniciar la importación.", variant: "destructive" })
      setImporting(false)
    }
  }

  const applyJobResultOrPoll = (job: ClinicInfoImportJob) => {
    setImportJob(job)
    if (job.status === "done" || job.status === "error") {
      applyJobResult(job)
      return
    }

    // Sigue en curso (QStash lo está procesando en background) → polling.
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/dashboard/clinic-info/import/${job.id}`)
        const data = await res.json()
        if (data.success && data.job) {
          applyJobResult(data.job)
        }
      } catch (error) {
        console.error("[CLINIC-INFO-TAB] Error consultando job:", error)
      }
    }, POLL_INTERVAL_MS)
  }

  const handleSave = async () => {
    if (!clienteId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/dashboard/clinic-info/${encodeURIComponent(clienteId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToUpdates(form)),
      })
      const data = await res.json()
      if (data.success) {
        setSavedMeta({ sourceUrl: data.info?.sourceUrl, updatedAt: data.info?.updatedAt, updatedBy: data.info?.updatedBy })
        toast({ title: "Guardado", description: "La información de la clínica quedó actualizada." })
      } else {
        toast({ title: "Error", description: "No se pudo guardar.", variant: "destructive" })
      }
    } catch (error) {
      toast({ title: "Error", description: "No se pudo guardar.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const addSede = () => setForm((prev) => ({ ...prev, sedes: [...prev.sedes, { nombre: "", direccion: "", horario: "", comoLlegar: "" }] }))
  const removeSede = (index: number) => setForm((prev) => ({ ...prev, sedes: prev.sedes.filter((_, i) => i !== index) }))
  const updateSede = (index: number, field: keyof SedeRow, value: string) =>
    setForm((prev) => ({ ...prev, sedes: prev.sedes.map((s, i) => (i === index ? { ...s, [field]: value } : s)) }))

  const addProfesional = () => setForm((prev) => ({ ...prev, profesionales: [...prev.profesionales, { nombre: "", especialidad: "" }] }))
  const removeProfesional = (index: number) => setForm((prev) => ({ ...prev, profesionales: prev.profesionales.filter((_, i) => i !== index) }))
  const updateProfesional = (index: number, field: keyof ProfesionalRow, value: string) =>
    setForm((prev) => ({ ...prev, profesionales: prev.profesionales.map((p, i) => (i === index ? { ...p, [field]: value } : p)) }))

  if (!clienteId) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Guardá esta configuración primero (con su cliente ID) para poder cargar la información institucional.
        </AlertDescription>
      </Alert>
    )
  }

  const jobInProgress = importJob && (importJob.status === "pending" || importJob.status === "scraping" || importJob.status === "extracting")
  const jobStatusLabel: Record<string, string> = {
    pending: "En cola...",
    scraping: "Leyendo el sitio web...",
    extracting: "Estructurando la información con IA...",
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Importar desde el sitio web
          </CardTitle>
          <CardDescription>
            Pegá la URL institucional de la clínica. El sistema va a leer el contenido y usar IA para estructurarlo en
            los campos de abajo — vas a poder revisar y editar todo antes de guardar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://www.clinica-ejemplo.com.ar"
              disabled={importing}
            />
            <Button type="button" onClick={startImport} disabled={importing || !importUrl.trim()}>
              {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Importar
            </Button>
          </div>

          {jobInProgress && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {jobStatusLabel[importJob!.status] || "Procesando..."}
            </p>
          )}
          {importJob?.status === "done" && (
            <p className="text-sm text-green-600 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Importado — revisá los campos de abajo antes de guardar.
            </p>
          )}
          {importJob?.status === "error" && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {importJob.error}
            </p>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              La importación es un punto de partida, no un reemplazo de la revisión: nada se guarda como definitivo
              hasta que confirmes con "Guardar cambios" más abajo. Si el sitio no tiene toda la info o no se puede
              leer, completá el resto a mano.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Institucional</CardTitle>
          <CardDescription>Datos de contacto y horario general de atención (no el de disponibilidad de turnos).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="h-20 bg-muted rounded animate-pulse" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Teléfono de contacto</Label>
                  <Input
                    value={form.telefonoContacto}
                    onChange={(e) => setForm((p) => ({ ...p, telefonoContacto: e.target.value }))}
                    placeholder="Ej: 11 4444-5555"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email de contacto</Label>
                  <Input
                    value={form.emailContacto}
                    onChange={(e) => setForm((p) => ({ ...p, emailContacto: e.target.value }))}
                    placeholder="contacto@clinica.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Horario de atención general</Label>
                <Input
                  value={form.horarioAtencion}
                  onChange={(e) => setForm((p) => ({ ...p, horarioAtencion: e.target.value }))}
                  placeholder="Ej: Lunes a viernes de 8 a 20hs"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Sedes</CardTitle>
              <CardDescription>Dirección, cómo llegar y horario por sede.</CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addSede}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar sede
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.sedes.length === 0 && <p className="text-sm text-muted-foreground">Sin sedes cargadas.</p>}
          {form.sedes.map((sede, index) => (
            <Card key={index} className="relative">
              <CardContent className="pt-6 grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => removeSede(index)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                <div className="space-y-1">
                  <Label>Nombre</Label>
                  <Input value={sede.nombre} onChange={(e) => updateSede(index, "nombre", e.target.value)} placeholder="Ej: Sede Centro" />
                </div>
                <div className="space-y-1">
                  <Label>Dirección</Label>
                  <Input value={sede.direccion} onChange={(e) => updateSede(index, "direccion", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Horario</Label>
                  <Input value={sede.horario} onChange={(e) => updateSede(index, "horario", e.target.value)} placeholder="Ej: 8 a 20hs" />
                </div>
                <div className="space-y-1">
                  <Label>Cómo llegar</Label>
                  <Input
                    value={sede.comoLlegar}
                    onChange={(e) => updateSede(index, "comoLlegar", e.target.value)}
                    placeholder="Transporte, estacionamiento, referencias"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Especialidades y equipamiento</CardTitle>
          <CardDescription>Separá cada ítem con una coma.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Especialidades</Label>
            <Input
              value={form.especialidades}
              onChange={(e) => setForm((p) => ({ ...p, especialidades: e.target.value }))}
              placeholder="Catarata, glaucoma, retina, córnea, cirugía refractiva"
            />
          </div>
          <div className="space-y-2">
            <Label>Equipamiento</Label>
            <Input
              value={form.equipamiento}
              onChange={(e) => setForm((p) => ({ ...p, equipamiento: e.target.value }))}
              placeholder="OCT, campo visual computarizado, topógrafo corneal"
            />
          </div>
          <div className="space-y-2">
            <Label>Obras sociales / prepagas aceptadas</Label>
            <Input
              value={form.obrasSociales}
              onChange={(e) => setForm((p) => ({ ...p, obrasSociales: e.target.value }))}
              placeholder="OSDE, Swiss Medical, PAMI"
            />
            <p className="text-xs text-muted-foreground">
              La lista simple. Para los planes y el copago —que es lo que los pacientes preguntan de
              verdad— usá el bloque <strong>Coberturas</strong> más abajo.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ══ Guardia ══════════════════════════════════════════════════════════
          "¿Para asistir a la guardia es por orden de llegada?" apareció dos
          veces textual en las conversaciones, y "¿atienden hoy por urgencias?"
          una más. La pregunta no es si existe: es cómo se accede. */}
      <Card>
        <CardHeader>
          <CardTitle>Guardia y urgencias</CardTitle>
          <CardDescription>
            Los pacientes preguntan «¿para asistir a la guardia es por orden de llegada?» y «¿atienden
            hoy por urgencias?». Hoy eso se deriva al teléfono.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 rounded-md bg-muted/30 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.guardiaDisponible}
              onChange={(e) => setForm((p) => ({ ...p, guardiaDisponible: e.target.checked }))}
            />
            <span className="text-sm">
              <strong>La clínica tiene guardia oftalmológica</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Dejalo sin marcar si no tiene: decirlo también es información, y le ahorra el viaje a
                quien iba a venir.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-md bg-muted/30 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.guardiaPorOrdenDeLlegada}
              onChange={(e) => setForm((p) => ({ ...p, guardiaPorOrdenDeLlegada: e.target.checked }))}
            />
            <span className="text-sm">
              <strong>Se atiende por orden de llegada, sin turno</strong>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Horarios de la guardia</Label>
              <Input
                value={form.guardiaHorarios}
                onChange={(e) => setForm((p) => ({ ...p, guardiaHorarios: e.target.value }))}
                placeholder="Todos los días de 8 a 20 h"
              />
            </div>
            <div className="space-y-2">
              <Label>En qué sede funciona</Label>
              <Input
                value={form.guardiaSede}
                onChange={(e) => setForm((p) => ({ ...p, guardiaSede: e.target.value }))}
                placeholder="Sólo en la sede Central"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Qué se atiende por guardia</Label>
            <Textarea
              value={form.guardiaQueSeAtiende}
              onChange={(e) => setForm((p) => ({ ...p, guardiaQueSeAtiende: e.target.value }))}
              placeholder="Ojo rojo, traumatismos, cuerpo extraño, pérdida brusca de visión"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label>Qué NO se atiende por guardia</Label>
            <Textarea
              value={form.guardiaQueNoSeAtiende}
              onChange={(e) => setForm((p) => ({ ...p, guardiaQueNoSeAtiende: e.target.value }))}
              placeholder="Controles de rutina, renovación de anteojos, estudios programados"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Esto es lo que evita el viaje al vacío: el paciente que viene por un control y se vuelve.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ══ Coberturas ═══════════════════════════════════════════════════════
          Nadie preguntó "¿atienden OSDE?". Preguntaron "¿atienden medife
          bronce?", "¿el plan 0,25 de OSDE?" y "¿con IOMA hay copago?". */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Coberturas, con plan y copago</CardTitle>
              <CardDescription>
                En 709 conversaciones nadie preguntó «¿atienden OSDE?». Preguntaron «¿atienden con
                medife bronce?», «¿trabajan con el plan 0,25 de OSDE?» y «¿con IOMA hay copago?».
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  coberturas: [
                    ...p.coberturas,
                    { nombre: "", planes: "", planesNoAceptados: "", requiereOrden: false, copago: "", comoAutorizar: "" },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Agregar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.coberturas.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin coberturas cargadas.</p>
          )}
          {form.coberturas.map((c, index) => (
            <Card key={index} className="relative">
              <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Obra social o prepaga</Label>
                  <Input
                    value={c.nombre}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], nombre: e.target.value }
                        return { ...p, coberturas }
                      })
                    }
                    placeholder="OSDE"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Copago</Label>
                  <Input
                    value={c.copago}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], copago: e.target.value }
                        return { ...p, coberturas }
                      })
                    }
                    placeholder="Sin copago / $3.500 por consulta"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Planes que se atienden</Label>
                  <Input
                    value={c.planes}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], planes: e.target.value }
                        return { ...p, coberturas }
                      })
                    }
                    placeholder="210, 310, 410"
                  />
                  <p className="text-xs text-muted-foreground">Vacío = todos los planes.</p>
                </div>
                <div className="space-y-2">
                  <Label>Planes que NO se atienden</Label>
                  <Input
                    value={c.planesNoAceptados}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], planesNoAceptados: e.target.value }
                        return { ...p, coberturas }
                      })
                    }
                    placeholder="0,25"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Cómo se saca la autorización de esta obra social</Label>
                  <Input
                    value={c.comoAutorizar}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], comoAutorizar: e.target.value }
                        return { ...p, coberturas }
                      })
                    }
                    placeholder="Por la web de IOMA o en la delegación de tu zona"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={c.requiereOrden}
                    onChange={(e) =>
                      setForm((p) => {
                        const coberturas = [...p.coberturas]
                        coberturas[index] = { ...coberturas[index], requiereOrden: e.target.checked }
                        return { ...p, coberturas }
                      })
                    }
                  />
                  Hay que traer orden o autorización
                </label>
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((p) => ({ ...p, coberturas: p.coberturas.filter((_, i) => i !== index) }))}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Quitar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      {/* ══ Órdenes ══════════════════════════════════════════════════════════
          El tema más preguntado de todos: 6 de 37, por encima de cualquier
          tema clínico. Tres pacientes mandaron capturas del sitio de su obra
          social preguntando qué poner en "seleccione sede". */}
      <Card>
        <CardHeader>
          <CardTitle>Órdenes y autorizaciones</CardTitle>
          <CardDescription>
            El tema más preguntado de todos, por encima de lo clínico: «¿cómo saco la orden? ¿A nombre
            de quién?», «¿el fondo de ojos entra en esta orden?». Tres pacientes mandaron capturas de
            pantalla del sitio de su obra social preguntándonos qué poner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 rounded-md bg-muted/30 p-3 text-sm">
            <input
              type="checkbox"
              checked={form.ordenesHacenFalta}
              onChange={(e) => setForm((p) => ({ ...p, ordenesHacenFalta: e.target.checked }))}
            />
            <strong>En general hace falta orden o autorización</strong>
          </label>
          <div className="space-y-2">
            <Label>Cómo se obtiene</Label>
            <Textarea
              value={form.ordenesComoObtenerla}
              onChange={(e) => setForm((p) => ({ ...p, ordenesComoObtenerla: e.target.value }))}
              placeholder="Por la web de tu obra social, con tu número de afiliado, o en la delegación más cercana"
              rows={2}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>A nombre de quién</Label>
              <Input
                value={form.ordenesANombreDe}
                onChange={(e) => setForm((p) => ({ ...p, ordenesANombreDe: e.target.value }))}
                placeholder="A nombre del paciente, no del acompañante"
              />
            </div>
            <div className="space-y-2">
              <Label>Si llega sin la orden</Label>
              <Input
                value={form.ordenesSiNoLaTrae}
                onChange={(e) => setForm((p) => ({ ...p, ordenesSiNoLaTrae: e.target.value }))}
                placeholder="Se atiende igual y se puede traer después"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Códigos de prestación</Label>
            <Textarea
              value={form.ordenesCodigos}
              onChange={(e) => setForm((p) => ({ ...p, ordenesCodigos: e.target.value }))}
              placeholder="Consulta 42.01 · Fondo de ojos 49.01 · Campo visual 49.05 · OCT 49.12"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Es lo que la obra social les pide cargar y nadie les explica.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ══ Aranceles ════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle>Aranceles y medios de pago</CardTitle>
          <CardDescription>
            «¿Cuánto es el arancel?», «¿cuánto sale hacerse el fondo de ojos?», «¿tiene costo la
            consulta?». El precio de cada estudio va en el bloque de abajo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Consulta particular</Label>
              <Input
                value={form.arancelConsulta}
                onChange={(e) => setForm((p) => ({ ...p, arancelConsulta: e.target.value }))}
                placeholder="$25.000"
              />
            </div>
            <div className="space-y-2">
              <Label>Hasta cuándo valen estos precios</Label>
              <Input
                value={form.arancelVigencia}
                onChange={(e) => setForm((p) => ({ ...p, arancelVigencia: e.target.value }))}
                placeholder="Noviembre 2026"
              />
              {/* Un precio sin fecha envejece sin que nadie se entere, y el bot
                  lo sigue diciendo con la misma seguridad. */}
              <p className="text-xs text-muted-foreground">
                Para que un precio viejo se note. El bot lo dice con la misma seguridad hasta que
                alguien lo cambie.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Medios de pago</Label>
            <Input
              value={form.arancelMediosDePago}
              onChange={(e) => setForm((p) => ({ ...p, arancelMediosDePago: e.target.value }))}
              placeholder="Efectivo, débito, crédito, transferencia, Mercado Pago"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Financiación</Label>
              <Input
                value={form.arancelFinanciacion}
                onChange={(e) => setForm((p) => ({ ...p, arancelFinanciacion: e.target.value }))}
                placeholder="3 cuotas sin interés con Visa"
              />
            </div>
            <div className="space-y-2">
              <Label>Facturación</Label>
              <Input
                value={form.arancelFacturacion}
                onChange={(e) => setForm((p) => ({ ...p, arancelFacturacion: e.target.value }))}
                placeholder="Se emite al momento, pedila en recepción"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══ Estudios ═════════════════════════════════════════════════════════
          "Es campo visual, ¿por qué me van a dilatar?" — la preparación es por
          estudio, no general. Y si dilata, no puede manejar al volver. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Estudios</CardTitle>
              <CardDescription>
                «Es campo visual, ¿por qué me van a dilatar?». La preparación es por estudio, no
                general. Y si se dilata, el paciente no puede manejar al volver: hoy se entera cuando
                ya está acá.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setForm((p) => ({
                  ...p,
                  estudios: [
                    ...p.estudios,
                    {
                      nombre: "",
                      requiereOrden: false,
                      dilata: false,
                      duracion: "",
                      preparacion: "",
                      sinConsultaPrevia: false,
                      arancelParticular: "",
                    },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Agregar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.estudios.length === 0 && <p className="text-sm text-muted-foreground">Sin estudios cargados.</p>}
          {form.estudios.map((es, index) => {
            const actualizar = (campo: keyof EstudioRow, valor: string | boolean) =>
              setForm((p) => {
                const estudios = [...p.estudios]
                estudios[index] = { ...estudios[index], [campo]: valor } as EstudioRow
                return { ...p, estudios }
              })
            return (
              <Card key={index}>
                <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Estudio</Label>
                    <Input
                      value={es.nombre}
                      onChange={(e) => actualizar("nombre", e.target.value)}
                      placeholder="Fondo de ojos"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cuánto dura</Label>
                    <Input
                      value={es.duracion}
                      onChange={(e) => actualizar("duracion", e.target.value)}
                      placeholder="40 minutos"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Preparación</Label>
                    <Input
                      value={es.preparacion}
                      onChange={(e) => actualizar("preparacion", e.target.value)}
                      placeholder="Venir con alguien que pueda manejar"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Arancel particular</Label>
                    <Input
                      value={es.arancelParticular}
                      onChange={(e) => actualizar("arancelParticular", e.target.value)}
                      placeholder="$18.000"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={es.requiereOrden} onChange={(e) => actualizar("requiereOrden", e.target.checked)} />
                    Requiere orden
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={es.dilata} onChange={(e) => actualizar("dilata", e.target.checked)} />
                    Dilata la pupila
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={es.sinConsultaPrevia}
                      onChange={(e) => actualizar("sinConsultaPrevia", e.target.checked)}
                    />
                    Se puede hacer sin consulta previa con el profesional
                  </label>
                  <div className="sm:col-span-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm((p) => ({ ...p, estudios: p.estudios.filter((_, i) => i !== index) }))}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Quitar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Profesionales</CardTitle>
              <CardDescription>Nombre y especialidad de cada profesional.</CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addProfesional}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar profesional
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.profesionales.length === 0 && <p className="text-sm text-muted-foreground">Sin profesionales cargados.</p>}
          {form.profesionales.map((prof, index) => (
            <div key={index} className="flex gap-2 items-start">
              <Input
                value={prof.nombre}
                onChange={(e) => updateProfesional(index, "nombre", e.target.value)}
                placeholder="Nombre y apellido"
              />
              <Input
                value={prof.especialidad}
                onChange={(e) => updateProfesional(index, "especialidad", e.target.value)}
                placeholder="Especialidad"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeProfesional(index)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instrucciones frecuentes</CardTitle>
          <CardDescription>Lo que la IA puede repetirle al paciente sin necesidad de derivar a un humano.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Instrucciones previas a la consulta</Label>
            <Textarea
              value={form.instruccionesPreConsulta}
              onChange={(e) => setForm((p) => ({ ...p, instruccionesPreConsulta: e.target.value }))}
              placeholder="Ej: traer DNI, carnet de obra social y estudios previos. Si te van a dilatar la pupila, vení acompañado."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Cuidados post-operatorios generales</Label>
            <Textarea
              value={form.cuidadosPostOperatorios}
              onChange={(e) => setForm((p) => ({ ...p, cuidadosPostOperatorios: e.target.value }))}
              placeholder="Resumen general — siempre aclarando que se debe seguir la indicación puntual del médico."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Información adicional</Label>
            <Textarea
              value={form.informacionAdicional}
              onChange={(e) => setForm((p) => ({ ...p, informacionAdicional: e.target.value }))}
              placeholder="Cualquier otro dato institucional que no encaje arriba."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {savedMeta?.updatedAt && (
            <span>
              Última actualización: {new Date(savedMeta.updatedAt).toLocaleString("es-AR")}
              {savedMeta.updatedBy === "import" ? " (desde importación, sin revisar)" : ""}
              {savedMeta.sourceUrl ? ` — fuente: ${savedMeta.sourceUrl}` : ""}
            </span>
          )}
        </div>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Guardar cambios
        </Button>
      </div>
    </div>
  )
}

export default ClinicInfoTab
