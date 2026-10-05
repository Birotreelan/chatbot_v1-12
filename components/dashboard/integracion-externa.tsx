"use client"

/**
 * Tablero de integración: qué nos manda el sistema de la clínica (5/10/2026).
 *
 * Contesta una sola pregunta y conviene que siga siendo una sola: ¿el sistema
 * externo está mandando todo lo que el bot necesita, y bien?
 *
 * Los cinco estados y por qué son cinco y no dos —ver `estado.ts`—: "llega" y
 * "falta" dejan afuera el caso que más tiempo hace perder, que es el que llega
 * incompleto y falla tres pasos más adelante.
 */

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  Check,
  ZapOff,
  CheckCircle2,
  Clock,
  Copy,
  HelpCircle,
  Loader2,
  MinusCircle,
  Pencil,
  RefreshCw,
  XCircle,
} from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Fila {
  plantilla?: string
  tipoMensaje?: string
  critico?: boolean
  nombre: string
  descripcion: string
  requeridos: string[]
  clave: string
  estado: "ok" | "incompleto" | "se_corto" | "sin_novedades" | "nunca" | "no_aplica"
  cadencia: { habitualMs: number | null; silencioMs: number | null; seCorto: boolean }
  plantillaPropia?: string
  completos: number
  incompletos: number
  ultimo?: string
  diasSinRecibir?: number
  incidentes: Incidente[]
}

interface Incidente {
  cuando: string
  faltantes: string[]
  plantilla?: string
  tipoMensaje?: string
  telefono?: string
  payload?: string
  desconocido?: boolean
}

interface Inesperado {
  tipo: string
  incompletos: number
  ultimoIncompleto?: string
  incidentes: Incidente[]
}

const PRESENTACION = {
  ok: { Icono: CheckCircle2, color: "text-green-600", etiqueta: "Llega bien" },
  incompleto: { Icono: AlertTriangle, color: "text-amber-600", etiqueta: "Llega incompleto" },
  se_corto: { Icono: ZapOff, color: "text-red-600", etiqueta: "Dejó de llegar" },
  sin_novedades: { Icono: Clock, color: "text-amber-600", etiqueta: "Sin novedades" },
  nunca: { Icono: XCircle, color: "text-red-600", etiqueta: "Nunca llegó" },
  no_aplica: { Icono: MinusCircle, color: "text-muted-foreground", etiqueta: "No aplica" },
} as const

function cuando(iso?: string): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-AR")
}

/**
 * Los mismos textos que `lib/integracion-externa/cadencia.ts`, escritos acá
 * porque este archivo es de cliente. Son cuatro líneas; importar el módulo
 * entero para esto arrastraría sus dependencias al bundle del navegador.
 */
function describirIntervalo(ms: number | null): string {
  if (ms === null) return "con regularidad"
  const minutos = Math.round(ms / 60000)
  if (minutos < 1) return "cada menos de un minuto"
  if (minutos < 60) return `cada ~${minutos} ${minutos === 1 ? "minuto" : "minutos"}`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `cada ~${horas} ${horas === 1 ? "hora" : "horas"}`
  const dias = Math.round(horas / 24)
  return `cada ~${dias} ${dias === 1 ? "día" : "días"}`
}

function describirSilencio(ms: number | null): string {
  if (ms === null) return "hace rato"
  const minutos = Math.round(ms / 60000)
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`
  const dias = Math.round(horas / 24)
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`
}


/**
 * El detalle de los casos que vinieron mal, y el reporte para mandar.
 *
 * La versión anterior mostraba sólo los campos faltantes de la ÚLTIMA vez y
 * nada más. Alcanzaba para saber que algo fallaba y no para reclamarlo: del
 * otro lado, "les está llegando algo incompleto" no se puede accionar.
 *
 * Lo que sí se puede accionar es una fecha, un teléfono, el nombre exacto de la
 * plantilla y el JSON que mandaron. Por eso el botón de copiar: el reporte sale
 * armado y se pega en un mail sin tener que transcribir nada —y transcribir a
 * mano es donde se cuelan los errores que hacen que el reclamo rebote—.
 */

/**
 * Los nombres de plantilla que usa ESTE cliente.
 *
 * La mayoría usa los del catálogo, pero no todos. El síntoma de una clínica con
 * nombres propios es inconfundible y desconcertante: todo en "nunca llegó" y
 * todo lo real amontonado en "tipos que no reconocemos". Por eso el editor vive
 * acá arriba, junto al tablero que lo delata, y no escondido en la
 * configuración general.
 *
 * Vacío = se usa el del catálogo. No se guarda una excepción que diga lo mismo
 * que el código: sería un dato más que mantener sincronizado.
 */
function NombresDePlantilla({
  clienteId,
  filas,
  alGuardar,
}: {
  clienteId: string
  filas: Fila[]
  alGuardar: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  // Sólo las filas que se identifican por plantilla: `turno_reagendado` llega
  // como texto con su `tipo_mensaje` y no tiene nombre que personalizar.
  const conPlantilla = filas.filter((f) => f.plantilla)

  function abrir() {
    const inicial: Record<string, string> = {}
    for (const f of conPlantilla) inicial[f.clave] = f.plantillaPropia || ""
    setValores(inicial)
    setAbierto(true)
  }

  async function guardar() {
    setGuardando(true)
    try {
      await fetch("/api/dashboard/integracion-externa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, nombresDePlantilla: valores }),
      })
      setAbierto(false)
      alGuardar()
    } finally {
      setGuardando(false)
    }
  }

  if (!abierto) {
    const propios = conPlantilla.filter((f) => f.plantillaPropia).length
    return (
      <Button variant="outline" size="sm" onClick={abrir}>
        <Pencil className="mr-2 h-4 w-4" />
        Nombres de plantilla
        {propios > 0 && <Badge className="ml-2">{propios}</Badge>}
      </Button>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nombres de plantilla de este cliente</CardTitle>
        <CardDescription>
          Dejá el campo vacío para usar el nombre general. Cargá uno sólo si esta clínica llama
          distinto a esa plantilla en Meta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {conPlantilla.map((f) => (
          <label key={f.clave} className="block">
            <span className="text-sm font-medium">{f.nombre}</span>
            <input
              value={valores[f.clave] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [f.clave]: e.target.value }))}
              placeholder={f.plantillaPropia ? f.plantilla : `${f.plantilla} (el general)`}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ))}

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Guardar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          El cambio aplica a lo que llegue de ahora en adelante. Lo ya registrado con el nombre
          anterior sigue donde está; si querés empezar limpio, usá &quot;Reiniciar medición&quot;.
        </p>
      </CardContent>
    </Card>
  )
}

function DetalleDeIncidentes({
  titulo,
  nombreDeLaFila,
  requeridos,
  incidentes,
}: {
  titulo: string
  nombreDeLaFila: string
  requeridos: string[]
  incidentes: Incidente[]
}) {
  const [copiado, setCopiado] = useState(false)

  const reporte = [
    `Reporte de integración — ${nombreDeLaFila}`,
    ``,
    requeridos.length ? `Campos que el flujo necesita: ${requeridos.join(", ")}` : ``,
    ``,
    `Casos registrados (${incidentes.length}, del más reciente al más viejo):`,
    ``,
    ...incidentes.map((inc, n) =>
      [
        `── Caso ${n + 1} ──`,
        `Fecha: ${inc.cuando}`,
        inc.telefono ? `Teléfono destino: ${inc.telefono}` : ``,
        inc.plantilla ? `Plantilla: ${inc.plantilla}` : `Plantilla: (no vino nombre de plantilla)`,
        inc.tipoMensaje ? `tipo_mensaje: ${inc.tipoMensaje}` : `tipo_mensaje: (ausente)`,
        inc.desconocido
          ? `Problema: el tipo no está entre los que procesamos.`
          : `Faltaban: ${inc.faltantes.join(", ") || "(sin detalle)"}`,
        ``,
        `Payload recibido:`,
        inc.payload || "(no se guardó)",
        ``,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .filter((l) => l !== undefined)
    .join("\n")

  async function copiar() {
    try {
      await navigator.clipboard.writeText(reporte)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles queda el texto a la vista para copiarlo a
      // mano: no hace falta avisar nada.
    }
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-amber-800">{titulo}</p>
        <Button variant="outline" size="sm" onClick={copiar} className="shrink-0">
          {copiado ? (
            <>
              <Check className="mr-2 h-3.5 w-3.5" /> Copiado
            </>
          ) : (
            <>
              <Copy className="mr-2 h-3.5 w-3.5" /> Copiar reporte
            </>
          )}
        </Button>
      </div>

      <div className="mt-3 space-y-3">
        {incidentes.map((inc, n) => (
          <div key={`${inc.cuando}-${n}`} className="rounded border bg-background p-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{cuando(inc.cuando)}</span>
              {inc.telefono && <span>tel. {inc.telefono}</span>}
              {inc.plantilla && <code>{inc.plantilla}</code>}
              {inc.tipoMensaje && <code>{inc.tipoMensaje}</code>}
            </div>

            <p className="mt-1.5 font-medium">
              {inc.desconocido ? (
                <span className="text-amber-800">
                  El tipo no está entre los que procesamos: el mensaje llegó y no se interpretó.
                </span>
              ) : inc.faltantes.length > 0 ? (
                <>
                  Faltaban:{" "}
                  {inc.faltantes.map((f) => (
                    <code key={f} className="mr-1.5 rounded bg-amber-500/10 px-1 text-amber-900">
                      {f}
                    </code>
                  ))}
                </>
              ) : (
                "Sin detalle de campos faltantes."
              )}
            </p>

            {inc.payload && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Ver el Chatbot_Data recibido
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                  {inc.payload}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function IntegracionExterna({ clienteId }: { clienteId: string }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [inesperados, setInesperados] = useState<Inesperado[]>([])
  const [sinDatos, setSinDatos] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/dashboard/integracion-externa?clienteId=${encodeURIComponent(clienteId)}`)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()
      setFilas(data.filas || [])
      setInesperados(data.inesperados || [])
      setSinDatos(Boolean(data.sinDatos))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar")
    } finally {
      setCargando(false)
    }
  }, [clienteId])

  useEffect(() => {
    if (clienteId) cargar()
  }, [clienteId, cargar])

  async function reiniciarMedicion() {
    if (!confirm("Esto borra lo observado hasta ahora para este cliente. ¿Seguir?")) return
    await fetch(`/api/dashboard/integracion-externa?clienteId=${encodeURIComponent(clienteId)}`, {
      method: "DELETE",
    })
    cargar()
  }

  if (!clienteId) {
    return (
      <Alert>
        <AlertDescription>Elegí un cliente para ver su integración.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Lo que el sistema de la clínica nos mandó hasta ahora. Se registra solo, a medida que llega.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <NombresDePlantilla clienteId={clienteId} filas={filas} alGuardar={cargar} />
          <Button variant="outline" size="sm" onClick={reiniciarMedicion} disabled={cargando}>
            Reiniciar medición
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Distinguir "no llegó NINGUNO" de "falta uno" evita el diagnóstico
          equivocado: lo primero es que la integración no arrancó —o que el
          Cliente_Id no coincide—, no que falte un tipo puntual. */}
      {!cargando && sinDatos && (
        <Alert>
          <AlertDescription>
            Todavía no llegó ningún mensaje de este cliente. Puede ser que la integración no esté
            configurada, que el <code>Cliente_Id</code> que manda el sistema externo no coincida con
            el de acá, o que simplemente no haya habido movimiento desde que empezamos a registrar.
          </AlertDescription>
        </Alert>
      )}

      {cargando ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {filas.map((fila) => {
            const { Icono, color, etiqueta } = PRESENTACION[fila.estado]
            return (
              <Card key={fila.clave}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Icono className={`h-5 w-5 shrink-0 ${color}`} />
                        {fila.nombre}
                        {fila.critico && (
                          <Badge variant="outline" className="border-primary/40 text-primary">
                            Crítico
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">{fila.descripcion}</CardDescription>
                      {/* Los dos nombres con los que llega, porque es con lo
                          que hay que hablar del otro lado: la plantilla es lo
                          que la clínica ve en Meta y el tipo_mensaje es lo que
                          escribe su backend. */}
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {fila.plantilla && <code>plantilla: {fila.plantilla}</code>}
                        {fila.tipoMensaje && <code>tipo_mensaje: {fila.tipoMensaje}</code>}
                      </div>
                    </div>
                    <Badge variant="outline" className={color}>
                      {etiqueta}
                    </Badge>
                  </div>
                </CardHeader>

                {fila.estado !== "no_aplica" && (
                  <CardContent className="space-y-2 pt-0 text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                      <span>Completos: {fila.completos}</span>
                      <span>Incompletos: {fila.incompletos}</span>
                      <span>Último: {cuando(fila.ultimo)}</span>
                    </div>

                    {/* El hallazgo más accionable y el más perecedero: algo
                        que venía andando dejó de andar hace un rato. Se dice
                        contra qué se compara, porque "dejó de llegar" sin la
                        cadencia habitual no deja juzgar si es grave. */}
                    {fila.estado === "se_corto" && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                        <p className="font-medium text-destructive">
                          Venía llegando {describirIntervalo(fila.cadencia.habitualMs)} y{" "}
                          {describirSilencio(fila.cadencia.silencioMs)} que no llega.
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          La cadencia se aprende de las últimas llegadas de esta misma plantilla en
                          este cliente, así que no depende del volumen que tenga.
                        </p>
                      </div>
                    )}

                    {fila.estado === "ok" && fila.cadencia.habitualMs !== null && (
                      <p className="text-xs text-muted-foreground">
                        Llega {describirIntervalo(fila.cadencia.habitualMs)}.
                      </p>
                    )}

                    {fila.estado === "sin_novedades" && (
                      <p className="text-amber-700">
                        Hace {fila.diasSinRecibir} días que no llega. Si es un tipo de poco
                        movimiento puede ser normal; si es el recordatorio, no.
                      </p>
                    )}

                    {fila.incidentes.length > 0 && (
                      <DetalleDeIncidentes
                        titulo={
                          fila.estado === "incompleto"
                            ? "Qué vino mal"
                            : "Casos incompletos anteriores (ya resueltos)"
                        }
                        nombreDeLaFila={fila.nombre}
                        requeridos={fila.requeridos}
                        incidentes={fila.incidentes}
                      />
                    )}

                    {fila.estado === "nunca" && (
                      <p className="text-muted-foreground">
                        Campos que necesita cuando llegue:{" "}
                        <code className="text-xs">{fila.requeridos.join(", ") || "ninguno"}</code>
                      </p>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}

          {/* La otra mitad del problema: si del otro lado escriben
              "turno_resgendado", arriba se ve "nunca llegó" sin ninguna pista
              de por qué. Acá aparece el tipo tal cual vino. */}
          {inesperados.length > 0 && (
            <Card className="border-amber-500/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <HelpCircle className="h-5 w-5 text-amber-600" />
                  Tipos que no reconocemos
                </CardTitle>
                <CardDescription>
                  Llegaron con un <code>tipo_mensaje</code> que no está en el catálogo. Suele ser un
                  error de tipeo del lado de la clínica, y explica que algún tipo de arriba figure
                  como que nunca llegó.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {inesperados.map((i) => (
                  <div key={i.tipo} className="rounded-md border p-3">
                    <code className="font-medium">{i.tipo.replace(/^desconocido:/, "")}</code>
                    <span className="ml-2 text-muted-foreground">
                      {i.incompletos} {i.incompletos === 1 ? "vez" : "veces"} · último{" "}
                      {cuando(i.ultimoIncompleto)}
                    </span>
                    {i.incidentes.length > 0 && (
                      <DetalleDeIncidentes
                        titulo="Qué llegó"
                        nombreDeLaFila={`Tipo no reconocido: ${i.tipo.replace(/^desconocido:/, "")}`}
                        requeridos={[]}
                        incidentes={i.incidentes}
                      />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
