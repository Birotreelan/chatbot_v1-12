"use client"

/**
 * La página "Integración externa": selector de cliente y su tablero.
 *
 * El selector es el mismo patrón de pestañas de Estadísticas, a propósito: es
 * la misma pregunta —"¿de qué clínica estamos hablando?"— y dos navegaciones
 * distintas para lo mismo obligan a aprender dos cosas.
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { IntegracionExterna } from "./integracion-externa"

interface ClienteDisponible {
  clienteId: string
  displayName: string
}

export function VistaDeIntegracion() {
  const [clientes, setClientes] = useState<ClienteDisponible[]>([])
  const [elegido, setElegido] = useState<string>("")
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    fetch("/api/dashboard/configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((configs: any[]) => {
        const lista = (configs || [])
          .filter((c) => c?.cliente_id)
          .map((c) => ({ clienteId: c.cliente_id as string, displayName: c.displayName as string }))
          // Un mismo cliente_id puede tener más de una configuración; el
          // tablero mide por cliente_id, así que mostrarlo dos veces sería
          // mostrar el mismo tablero dos veces.
          .filter((c, i, todos) => todos.findIndex((o) => o.clienteId === c.clienteId) === i)

        setClientes(lista)
        if (lista.length > 0) setElegido(lista[0].clienteId)
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [])

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Integración externa</h1>
        <p className="text-sm text-muted-foreground">
          Qué nos manda el sistema de cada clínica, qué llega incompleto y qué no llega nunca.
        </p>
      </div>

      {clientes.length === 0 ? (
        <Alert>
          <AlertDescription>
            No hay configuraciones con <code>cliente_id</code> cargado. El tablero mide por{" "}
            <code>Cliente_Id</code>, que es el campo con el que el sistema externo nos identifica.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Tabs value={elegido} onValueChange={setElegido}>
            <TabsList className="w-full justify-start overflow-x-auto">
              {clientes.map((c) => (
                <TabsTrigger key={c.clienteId} value={c.clienteId} className="flex-shrink-0">
                  {c.displayName}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <IntegracionExterna clienteId={elegido} />
        </>
      )}
    </div>
  )
}
