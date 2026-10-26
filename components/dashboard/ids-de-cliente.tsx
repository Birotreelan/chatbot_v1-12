"use client"

/**
 * "IDs de cliente": encontrar y arreglar los clientes partidos en dos ids
 * (26/10/2026).
 *
 * ── El problema que resuelve ───────────────────────────────────────────────
 *
 * El `cliente_id` lo pone el sistema de la clínica y a veces cambia. Cuando
 * cambia, todo lo que quedó guardado bajo el id viejo deja de existir para
 * nosotros: la facturación le cobra cero y las estadísticas devuelven vacío.
 *
 * El síntoma aparece semanas después, mirando un total, y para entonces nadie
 * se acuerda de cuál era el id viejo. Ya pasó dos veces en octubre, y la
 * segunda la encontramos de casualidad revisando una tabla de facturación
 * donde dos clínicas aparecían en US$ 0.
 *
 * ── Por qué una pantalla y no un script ────────────────────────────────────
 *
 * Porque el script existía y no se usó: pedía ir a buscar el session id a la
 * consola del navegador y abrir una terminal. Lo que se hace una vez por mes y
 * cuesta tres pasos, no se hace.
 *
 * ── Qué decide la máquina y qué decide una persona ─────────────────────────
 *
 * La máquina encuentra los ids sueltos: eso es comparar dos listas y no se
 * equivoca. Pero decir "este id huérfano es esta clínica" es una conclusión
 * que puede estar mal, y fusionar dos clínicas distintas arruina las
 * estadísticas de las dos. Por eso el destino lo elige una persona mirando los
 * números, y antes de escribir se muestra el ensayo.
 */

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react"

interface IdHuerfano {
  id: string
  claves: number
  confirmados: number
  cancelados: number
  recordatorios: number
  ultimaActividad: string
  tieneFacturacion: boolean
}

interface ClienteVigente {
  clienteId: string
  nombre: string
  activo: boolean
}

interface Ensayo {
  clavesEncontradas: number
  conflictos: number
  errores: number
  yaEjecutada?: string
  claves: { origen: string; accion: string; detalle?: string }[]
}

const numero = new Intl.NumberFormat("es-AR")

function cuando(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
}

export function IdsDeCliente() {
  const [cargando, setCargando] = useState(true)
  const [huerfanos, setHuerfanos] = useState<IdHuerfano[]>([])
  const [clientes, setClientes] = useState<ClienteVigente[]>([])
  /** Para cada id huérfano, a qué cliente se lo quiere mandar. */
  const [destinos, setDestinos] = useState<Record<string, string>>({})
  const [ensayos, setEnsayos] = useState<Record<string, Ensayo>>({})
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const { toast } = useToast()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch("/api/dashboard/migrar-cliente", { credentials: "include" })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "No se pudo consultar")
      setHuerfanos(d.huerfanos || [])
      setClientes(d.clientes || [])
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo consultar",
        variant: "destructive",
      })
    } finally {
      setCargando(false)
    }
  }, [toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function migrar(viejo: string, ejecutar: boolean) {
    const nuevo = destinos[viejo]
    if (!nuevo) return

    setTrabajando(viejo)
    try {
      const r = await fetch("/api/dashboard/migrar-cliente", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viejo, nuevo, ...(ejecutar ? { ensayo: false } : {}) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "No se pudo migrar")

      if (!ejecutar) {
        setEnsayos((prev) => ({ ...prev, [viejo]: d }))
        return
      }

      if (d.frenada) {
        toast({
          title: "Ya se había ejecutado",
          description: `Esta migración corrió el ${cuando(d.yaEjecutada)}. Repetirla duplicaría los contadores.`,
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Migración ejecutada",
        description: `${d.clavesEncontradas} claves movidas al id nuevo. Lo viejo no se borró.`,
      })
      setEnsayos((prev) => {
        const copia = { ...prev }
        delete copia[viejo]
        return copia
      })
      await cargar()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo migrar",
        variant: "destructive",
      })
    } finally {
      setTrabajando(null)
    }
  }

  if (cargando) {
    return <p className="text-sm text-muted-foreground">Buscando ids sueltos…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {huerfanos.length === 0
            ? "No hay ids sueltos: todo lo guardado pertenece a un cliente vigente."
            : `${huerfanos.length} ${huerfanos.length === 1 ? "id tiene" : "ids tienen"} datos y ningún cliente los reclama.`}
        </p>
        <Button variant="outline" size="sm" onClick={cargar} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {huerfanos.map((h) => {
        const ensayo = ensayos[h.id]
        const destino = destinos[h.id] || ""
        const ocupado = trabajando === h.id
        const elegido = clientes.find((c) => c.clienteId === destino)

        return (
          <Card key={h.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-mono break-all">{h.id}</CardTitle>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground pt-1">
                <span>{numero.format(h.confirmados)} confirmados</span>
                <span>{numero.format(h.cancelados)} cancelados</span>
                <span>{numero.format(h.recordatorios)} recordatorios</span>
                <span>{h.claves} claves</span>
                <span>última actividad: {cuando(h.ultimaActividad)}</span>
                {h.tieneFacturacion && (
                  <span className="text-amber-700 font-medium">tiene precio o alias cargados</span>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                {/* Un `select` del navegador y no un combo propio: son 25
                    clientes y lo importante es poder buscar escribiendo, que
                    el nativo ya hace. */}
                <select
                  className="h-9 min-w-[18rem] rounded-md border border-input bg-background px-3 text-sm"
                  value={destino}
                  onChange={(e) => {
                    const valor = e.target.value
                    setDestinos((prev) => ({ ...prev, [h.id]: valor }))
                    // El ensayo era de otro destino: deja de valer.
                    setEnsayos((prev) => {
                      const copia = { ...prev }
                      delete copia[h.id]
                      return copia
                    })
                  }}
                >
                  <option value="">¿A qué cliente pertenece?</option>
                  {clientes.map((c) => (
                    <option key={c.clienteId} value={c.clienteId}>
                      {c.nombre}
                      {c.activo ? "" : " (inactivo)"}
                    </option>
                  ))}
                </select>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!destino || ocupado}
                  onClick={() => migrar(h.id, false)}
                >
                  {ocupado && !ensayo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ver qué movería"}
                </Button>

                {/* Migrar sólo aparece DESPUÉS del ensayo. No es una molestia:
                    es la única oportunidad de ver los conflictos mientras
                    todavía se pueden evitar. */}
                {ensayo && (
                  <Button size="sm" disabled={ocupado} onClick={() => migrar(h.id, true)}>
                    {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Migrar a ${elegido?.nombre || "…"}`}
                  </Button>
                )}
              </div>

              {ensayo && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <span>
                      <strong>{ensayo.clavesEncontradas}</strong> claves se moverían
                    </span>
                    <span>
                      <strong>{ensayo.conflictos}</strong> conflictos
                    </span>
                    {ensayo.errores > 0 && (
                      <span className="text-destructive">
                        <strong>{ensayo.errores}</strong> errores
                      </span>
                    )}
                  </div>

                  {ensayo.yaEjecutada && (
                    <p className="flex items-start gap-1.5 text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Esta migración ya corrió el {cuando(ensayo.yaEjecutada)}. Repetirla duplicaría los
                      contadores, así que no se va a ejecutar.
                    </p>
                  )}

                  {ensayo.conflictos > 0 && (
                    <div>
                      <p className="text-muted-foreground mb-1">
                        El cliente destino ya tiene un valor propio en estas claves. No se pisan — si querés
                        el valor viejo, hay que cargarlo a mano:
                      </p>
                      <ul className="font-mono space-y-0.5">
                        {ensayo.claves
                          .filter((c) => c.accion === "conflicto")
                          .map((c) => (
                            <li key={c.origen} className="break-all">
                              {c.origen}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-muted-foreground">
                    Los contadores se suman a los que el id nuevo ya tenga. El id viejo no se borra.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
