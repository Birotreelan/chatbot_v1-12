"use client"

/**
 * Etiquetar conversaciones, para poder medir si el motor mejora (25/11/2026).
 *
 * ── Por qué una pantalla y no un archivo ──────────────────────────────────
 *
 * Lo primero que se me ocurrió fue exportar un JSON y etiquetarlo en una
 * planilla. Dos problemas: hay que leer la conversación completa para decidir
 * —en una celda no se lee— y el resultado vuelve como un archivo que alguien
 * tiene que importar sin equivocarse. Con cien conversaciones, la fricción de
 * la herramienta decide si el trabajo se termina o se abandona a las veinte.
 *
 * Acá la conversación se lee como en el monitor y se etiqueta con dos clics. El
 * guardado es inmediato y por conversación: se puede dejar a medias y seguir
 * mañana, que es como realmente va a pasar.
 *
 * ── Lo que esta pantalla NO hace ──────────────────────────────────────────
 *
 * No propone la etiqueta. La tentación de que un modelo preetiquete y la
 * persona confirme es fuerte, y es justamente lo que arruinaría el
 * instrumento: el corpus existe para juzgar al motor, y si lo etiqueta un
 * modelo estaríamos midiendo si el motor coincide con otro modelo. Que sea
 * lento es parte de para qué sirve.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface MensajeExportado {
  rol: "user" | "assistant" | "system"
  texto: string
  timestamp: string
  tipo?: string
}

interface ConversacionExportada {
  id: string
  clinica: string
  configId: string
  cantidadMensajes: number
  mensajes: MensajeExportado[]
}

interface Etiqueta {
  id: string
  configId: string
  clinica?: string
  queQueria: string
  resultado: string
  nota?: string
  mensajesDelBot?: number
  etiquetadoPor: string
  etiquetadoEn: string
}

interface Resumen {
  etiquetadas: number
  bien: number
  tasaDeExito: number | null
  porResultado: Record<string, number>
  porIntencion: Record<string, number>
  mensajesPorConversacionBien: number | null
}

/** Las etiquetas, con el texto que se muestra. El valor viaja al servidor. */
const QUE_QUERIA: Array<{ valor: string; texto: string }> = [
  { valor: "turno_nuevo", texto: "Un turno nuevo" },
  { valor: "reagendar", texto: "Cambiar un turno" },
  { valor: "cancelar", texto: "Cancelar" },
  { valor: "confirmar", texto: "Confirmar asistencia" },
  { valor: "consulta_practica", texto: "Una pregunta práctica" },
  { valor: "consulta_clinica", texto: "Algo clínico" },
  { valor: "hablar_con_humano", texto: "Hablar con una persona" },
  { valor: "otra", texto: "Otra cosa" },
  { valor: "no_se_entiende", texto: "No se entiende" },
]

const RESULTADOS: Array<{ valor: string; texto: string; ayuda: string }> = [
  { valor: "resuelto", texto: "Lo consiguió", ayuda: "Se fue con lo que vino a buscar" },
  {
    valor: "resuelto_con_friccion",
    texto: "Lo consiguió, a los tumbos",
    ayuda: "Terminó bien pero le costó más mensajes de los que debería",
  },
  { valor: "no_resuelto", texto: "No lo consiguió", ayuda: "Y el bot podía dárselo" },
  { valor: "derivado_bien", texto: "Derivado, y estaba bien", ayuda: "Ej.: obra social sin turnos online" },
  { valor: "derivado_mal", texto: "Derivado, y estaba mal", ayuda: "Se derivó algo que el bot podía resolver" },
  { valor: "error_tecnico", texto: "Terminó en error", ayuda: "«Hubo un problema», «intentá de nuevo»" },
]

export default function EvaluacionPage() {
  const [conversaciones, setConversaciones] = useState<ConversacionExportada[]>([])
  const [etiquetas, setEtiquetas] = useState<Record<string, Etiqueta>>({})
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [indice, setIndice] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Lo que se está eligiendo para la conversación actual.
  const [queQueria, setQueQueria] = useState<string>("")
  const [resultado, setResultado] = useState<string>("")
  const [nota, setNota] = useState<string>("")

  /** Sólo las que faltan, para no esconder el trabajo pendiente detrás de las hechas. */
  const [soloPendientes, setSoloPendientes] = useState(true)

  const refClave = (c: ConversacionExportada) => `${c.configId}:${c.id}`

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [expo, etiq] = await Promise.all([
        /**
         * 150 conversaciones, las más largas de todas las clínicas.
         *
         * `minMensajes=3` descarta las de un solo intercambio: no hay nada que
         * juzgar en "hola" / "hola, ¿en qué te ayudo?". Y el tope del total
         * existe porque cada conversación viaja con sus mensajes completos: sin
         * él, veinte clínicas × 120 son varios megabytes que alguien espera
         * mirando una pantalla en blanco. Son 50% más que las 100 que el plan
         * pide etiquetar, para que haya de dónde descartar.
         */
        fetch("/api/admin/export-conversations?limit=60&minMensajes=3&totalMax=150", {
          credentials: "include",
        }),
        fetch("/api/evaluacion/etiquetas", { credentials: "include" }),
      ])
      if (!expo.ok) throw new Error(`El export respondió ${expo.status}`)
      if (!etiq.ok) throw new Error(`Las etiquetas respondieron ${etiq.status}`)

      const datosExpo = await expo.json()
      const datosEtiq = await etiq.json()

      setConversaciones(Array.isArray(datosExpo.conversaciones) ? datosExpo.conversaciones : [])
      const porClave: Record<string, Etiqueta> = {}
      for (const e of (datosEtiq.etiquetas || []) as Etiqueta[]) porClave[`${e.configId}:${e.id}`] = e
      setEtiquetas(porClave)
      setResumen(datosEtiq.resumen || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar")
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const visibles = useMemo(() => {
    if (!soloPendientes) return conversaciones
    return conversaciones.filter((c) => !etiquetas[refClave(c)])
  }, [conversaciones, etiquetas, soloPendientes])

  const actual = visibles[indice]

  // Al cambiar de conversación, el formulario arranca con lo ya etiquetado (si
  // se está revisando) o limpio.
  useEffect(() => {
    if (!actual) return
    const ya = etiquetas[refClave(actual)]
    setQueQueria(ya?.queQueria || "")
    setResultado(ya?.resultado || "")
    setNota(ya?.nota || "")
  }, [actual?.id, actual?.configId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    if (!actual || !queQueria || !resultado) return
    setGuardando(true)
    try {
      const mensajesDelBot = actual.mensajes.filter((m) => m.rol === "assistant").length
      const r = await fetch("/api/evaluacion/etiquetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: actual.id,
          configId: actual.configId,
          clinica: actual.clinica,
          queQueria,
          resultado,
          nota: nota.trim() || undefined,
          mensajesDelBot,
        }),
      })
      const datos = await r.json()
      if (!r.ok || !datos.ok) throw new Error(datos.error || "No se pudo guardar")

      setEtiquetas((previas) => ({ ...previas, [refClave(actual)]: datos.etiqueta }))

      // Con el filtro de pendientes, la actual desaparece de la lista y el
      // índice ya apunta a la siguiente. Sin filtro hay que avanzar a mano.
      if (!soloPendientes) setIndice((i) => Math.min(i + 1, visibles.length - 1))

      // El resumen se vuelve a pedir: es el número que da sentido al trabajo y
      // verlo moverse después de cada etiqueta es la mitad del incentivo.
      const resumenNuevo = await fetch("/api/evaluacion/etiquetas", { credentials: "include" })
      if (resumenNuevo.ok) setResumen((await resumenNuevo.json()).resumen || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar")
    } finally {
      setGuardando(false)
    }
  }

  const total = conversaciones.length
  const hechas = Object.keys(etiquetas).length

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Etiquetar conversaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Leé la conversación y decí qué quería el paciente y si lo consiguió. Es el banco de pruebas
          con el que después se compara el motor nuevo: las mismas conversaciones, antes y después.
        </p>
      </div>

      {resumen && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lo etiquetado hasta ahora</CardTitle>
            <CardDescription>
              {hechas} de {total} conversaciones cargadas
              {resumen.mensajesPorConversacionBien !== null && (
                <> · {resumen.mensajesPorConversacionBien} mensajes del bot por conversación que salió bien</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-muted px-3 py-1.5">
                Salieron bien: <strong>{resumen.bien}</strong>
                {resumen.tasaDeExito !== null && <> ({Math.round(resumen.tasaDeExito * 100)}%)</>}
              </span>
              {RESULTADOS.map((r) => (
                <span key={r.valor} className="rounded-lg bg-muted px-3 py-1.5">
                  {r.texto}: <strong>{resumen.porResultado?.[r.valor] || 0}</strong>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setSoloPendientes((v) => !v)}>
          {soloPendientes ? "Ver todas" : "Ver sólo las que faltan"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIndice((i) => Math.max(0, i - 1))}
          disabled={indice === 0}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIndice((i) => Math.min(i + 1, visibles.length - 1))}
          disabled={indice >= visibles.length - 1}
        >
          Siguiente
        </Button>
        <span className="text-sm text-muted-foreground">
          {visibles.length === 0 ? "—" : `${indice + 1} de ${visibles.length}`}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {cargando && <p className="text-sm text-muted-foreground">Cargando conversaciones…</p>}

      {!cargando && visibles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? "No hay conversaciones para etiquetar."
            : "No queda ninguna pendiente. Tocá «Ver todas» para revisar las hechas."}
        </p>
      )}

      {actual && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* ── La conversación ───────────────────────────────────────────── */}
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{actual.clinica}</CardTitle>
              <CardDescription>
                {actual.cantidadMensajes} mensajes · {actual.mensajes.filter((m) => m.rol === "assistant").length} del
                bot · {actual.id}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Scroll propio: una conversación de 40 mensajes dejaría los
                  botones de etiquetar fuera de la pantalla, y hay que poder
                  volver a leer el principio sin perderlos de vista. */}
              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {actual.mensajes.map((m, i) => (
                  <div
                    key={i}
                    className={
                      m.rol === "user"
                        ? "ml-0 mr-8 rounded-xl bg-muted px-3 py-2 text-sm"
                        : "ml-8 mr-0 rounded-xl border bg-card px-3 py-2 text-sm"
                    }
                  >
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {m.rol === "user" ? "Paciente" : m.rol === "assistant" ? "Iris" : "Sistema"}
                      {m.timestamp ? ` · ${new Date(m.timestamp).toLocaleString("es-AR")}` : ""}
                    </div>
                    <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Las dos preguntas ─────────────────────────────────────────── */}
          <Card className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Etiquetar</CardTitle>
              {etiquetas[refClave(actual)] && (
                <CardDescription>
                  Ya etiquetada por {etiquetas[refClave(actual)].etiquetadoPor}. Guardar la vuelve a escribir.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="mb-2 block text-sm">¿Qué quería?</Label>
                <div className="flex flex-wrap gap-2">
                  {QUE_QUERIA.map((o) => (
                    <button
                      key={o.valor}
                      type="button"
                      onClick={() => setQueQueria(o.valor)}
                      className={`min-h-[40px] rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        queQueria === o.valor ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
                      }`}
                    >
                      {o.texto}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block text-sm">¿Lo consiguió?</Label>
                <div className="space-y-2">
                  {RESULTADOS.map((o) => (
                    <button
                      key={o.valor}
                      type="button"
                      onClick={() => setResultado(o.valor)}
                      className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        resultado === o.valor ? "border-primary bg-primary/10" : "hover:bg-accent"
                      }`}
                    >
                      <span className="font-medium">{o.texto}</span>
                      <span className="mt-0.5 block text-[13px] text-muted-foreground">{o.ayuda}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="nota" className="mb-2 block text-sm">
                  Nota (opcional)
                </Label>
                {/* Lo más valioso del etiquetado no es la categoría sino esto:
                    "le pidió cuatro veces la sede que ya había dicho". Es lo
                    que después se convierte en un arreglo concreto. */}
                <Textarea
                  id="nota"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Qué fue lo que falló, con palabras tuyas"
                  rows={3}
                />
              </div>

              <Button
                onClick={guardar}
                disabled={!queQueria || !resultado || guardando}
                className="w-full"
              >
                {guardando ? "Guardando…" : "Guardar y seguir"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
