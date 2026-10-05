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
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Fila {
  clave: string
  plantilla?: string
  tipoMensaje?: string
  critico?: boolean
  nombre: string
  descripcion: string
  requeridos: string[]
  estado: "ok" | "incompleto" | "sin_novedades" | "nunca" | "no_aplica"
  completos: number
  incompletos: number
  ultimo?: string
  diasSinRecibir?: number
  faltantes?: string[]
  muestra?: string
}

interface Inesperado {
  tipo: string
  incompletos: number
  ultimoIncompleto?: string
  muestra?: string
}

const PRESENTACION = {
  ok: { Icono: CheckCircle2, color: "text-green-600", etiqueta: "Llega bien" },
  incompleto: { Icono: AlertTriangle, color: "text-amber-600", etiqueta: "Llega incompleto" },
  sin_novedades: { Icono: Clock, color: "text-amber-600", etiqueta: "Sin novedades" },
  nunca: { Icono: XCircle, color: "text-red-600", etiqueta: "Nunca llegó" },
  no_aplica: { Icono: MinusCircle, color: "text-muted-foreground", etiqueta: "No aplica" },
} as const

function cuando(iso?: string): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-AR")
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

                    {fila.estado === "sin_novedades" && (
                      <p className="text-amber-700">
                        Hace {fila.diasSinRecibir} días que no llega. Si es un tipo de poco
                        movimiento puede ser normal; si es el recordatorio, no.
                      </p>
                    )}

                    {fila.estado === "incompleto" && fila.faltantes && fila.faltantes.length > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                        <p className="font-medium text-amber-800">
                          La última vez llegó sin: {fila.faltantes.join(", ")}
                        </p>
                        {fila.muestra && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              Ver el payload recibido
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                              {fila.muestra}
                            </pre>
                          </details>
                        )}
                      </div>
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
                    {i.muestra && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          Ver el payload recibido
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                          {i.muestra}
                        </pre>
                      </details>
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
