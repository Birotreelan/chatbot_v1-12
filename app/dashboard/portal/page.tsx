"use client"

/**
 * Generador de enlaces del portal (23/9/2026).
 *
 * Sirve para probar el portal entero sin depender de WhatsApp: se elige el
 * cliente, se dice qué se quiere hacer, y sale un enlace para abrir. El modo de
 * prueba viene activado por defecto — es la opción que no puede romper nada.
 */

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { WhatsAppConfig } from "@/lib/types"

interface Respuesta {
  ok?: boolean
  url?: string
  demo?: boolean
  error?: string
  aviso?: string
  diagnostico?: string[]
  vence?: string
}

export default function PortalPage() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [configId, setConfigId] = useState("")
  const [intencion, setIntencion] = useState<"reagendar" | "nuevo_turno">("reagendar")
  // Arranca apagado desde el 23/9/2026: el entorno es de prueba de punta a
  // punta —sistema y WhatsApp— así que simular la reserva esconde justamente
  // lo que hay que ver. El interruptor sigue estando para cuando esto apunte a
  // la agenda de una clínica con pacientes de verdad.
  const [demo, setDemo] = useState(false)
  const [dni, setDni] = useState("")
  const [telefono, setTelefono] = useState("")
  const [generando, setGenerando] = useState(false)
  const [resultado, setResultado] = useState<Respuesta | null>(null)

  useEffect(() => {
    fetch("/api/dashboard/configs")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const lista = Array.isArray(d) ? d : []
        setConfigs(lista)
        if (lista[0]?.id) setConfigId(lista[0].id)
      })
      .catch(() => setConfigs([]))
  }, [])

  async function generar() {
    setGenerando(true)
    setResultado(null)
    try {
      const r = await fetch("/api/dashboard/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId, intencion, demo, dni, telefono }),
      })
      setResultado(await r.json())
    } catch (e: any) {
      setResultado({ error: e?.message || "No se pudo generar el enlace" })
    } finally {
      setGenerando(false)
    }
  }

  const configElegida = configs.find((c) => c.id === configId)

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Portal de turnos</h1>
        <p className="mt-2 text-muted-foreground">
          Generá un enlace del portal para probarlo, sin necesidad de que WhatsApp mande nada.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo enlace</CardTitle>
          <CardDescription>
            El enlace dura 30 minutos y se puede usar una sola vez, igual que el que recibe un
            paciente.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="config">Cliente</Label>
            <select
              id="config"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
            >
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.alias || c.displayName || c.whatsappNumber || c.id}
                </option>
              ))}
            </select>
            {configElegida && configElegida.clientePortalWeb !== true && (
              <p className="text-xs text-amber-600">
                Este cliente no tiene activado &quot;Cliente Portal Web&quot;. El enlace igual
                funciona para probar, pero el bot no se lo va a mandar solo a nadie.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>¿Qué va a hacer el paciente?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={intencion === "reagendar" ? "default" : "outline"}
                onClick={() => setIntencion("reagendar")}
              >
                Reprogramar un turno
              </Button>
              <Button
                type="button"
                variant={intencion === "nuevo_turno" ? "default" : "outline"}
                onClick={() => setIntencion("nuevo_turno")}
              >
                Pedir un turno nuevo
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dni">DNI del paciente (opcional)</Label>
              <Input
                id="dni"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="30123456"
              />
              <p className="text-xs text-muted-foreground">
                Con DNI se traen la agenda y los turnos reales de ese paciente. Sin DNI se usa uno
                inventado y sólo se puede revisar la interfaz.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono (opcional)</Label>
              <Input
                id="telefono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="5493511234567"
              />
              <p className="text-xs text-muted-foreground">
                Sólo queda registrado en el enlace. No se le manda nada.
              </p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-4">
            <div>
              <Label htmlFor="demo" className="text-base">
                Modo de prueba
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {demo
                  ? "Se recorren todas las pantallas y se muestra la confirmación, pero no se reserva ni se cancela nada."
                  : "⚠️ El enlace va a reservar y cancelar turnos de verdad en la agenda de este cliente."}
              </p>
            </div>
            <Switch id="demo" checked={demo} onCheckedChange={setDemo} />
          </div>

          <Button onClick={generar} disabled={!configId || generando}>
            {generando ? "Generando..." : "Generar enlace"}
          </Button>

          {resultado && (
            <div className="space-y-3 rounded-md border p-4">
              {resultado.error ? (
                <p className="text-sm text-destructive">{resultado.error}</p>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium">
                      Enlace {resultado.demo ? "de prueba" : "REAL"}
                    </p>
                    <a
                      href={resultado.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-primary underline"
                    >
                      {resultado.url}
                    </a>
                  </div>

                  {resultado.vence && (
                    <p className="text-xs text-muted-foreground">
                      Vence: {new Date(resultado.vence).toLocaleString("es-AR")}
                    </p>
                  )}

                  {resultado.aviso && <p className="text-xs text-amber-600">{resultado.aviso}</p>}

                  {resultado.diagnostico && resultado.diagnostico.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {resultado.diagnostico.map((linea, i) => (
                        <li key={i}>{linea}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
