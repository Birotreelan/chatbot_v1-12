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
          </div>
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
