"use client"

/**
 * Alta de Flows y templates sin salir del dashboard (21/9/2026).
 *
 * Los pasos están separados y en orden, cada uno con su botón, en vez de un
 * "configurar todo" que hace cinco llamadas. Dos motivos:
 *
 *  - Publicar un Flow no se deshace: se deprecia. Un botón que encadena crear y
 *    publicar convierte un clic curioso en algo permanente.
 *  - Estamos usando esto para averiguar cosas que la documentación de Meta no
 *    dice. Si los pasos se encadenan, el primero que falla se come la respuesta
 *    de los demás — que es justamente lo que vinimos a leer.
 *
 * Por eso también se muestra el JSON crudo de Meta y no un resumen.
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { WhatsAppConfig } from "@/lib/types"

interface Props {
  configs: WhatsAppConfig[]
}

interface Resultado {
  accion: string
  cuando: string
  respuesta: any
}

const PASOS = [
  { accion: "listar_flows", titulo: "1. Ver los Flows del WABA", ayuda: "Para no crear uno repetido." },
  { accion: "crear_flow", titulo: "2. Crear el Flow", ayuda: "Queda vacío y en borrador. Guarda el id en la configuración." },
  { accion: "subir_json", titulo: "3. Subir las pantallas", ayuda: "Acá se ven los errores de validación del Flow JSON." },
  { accion: "publicar_flow", titulo: "4. Publicar el Flow", ayuda: "No se puede deshacer: un Flow publicado se deprecia, no se despublica." },
  { accion: "estado_flow", titulo: "5. Ver el estado", ayuda: "DRAFT o PUBLISHED, y los errores si quedaron." },
  { accion: "crear_template", titulo: "6. Crear el template", ayuda: "La respuesta dice en qué categoría lo clasificó Meta." },
  { accion: "estado_template", titulo: "7. Ver el template", ayuda: "En qué estado de aprobación quedó." },
] as const

export function FlowsSetup({ configs }: Props) {
  const [configId, setConfigId] = useState<string>(configs[0]?.id || "")
  const [nombreFlow, setNombreFlow] = useState("reagendar_turno")
  const [nombreTemplate, setNombreTemplate] = useState("confirmacion_1_turno_flows")
  const [cuerpo, setCuerpo] = useState("")
  const [cargando, setCargando] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const config = configs.find((c) => c.id === configId)

  async function ejecutar(accion: string) {
    if (!configId) return
    if (accion === "publicar_flow") {
      const seguro = window.confirm(
        "Publicar el Flow no se puede deshacer: después sólo se puede deprecar. ¿Seguir?",
      )
      if (!seguro) return
    }

    setCargando(accion)
    setResultado(null)
    try {
      const r = await fetch("/api/dashboard/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configId,
          accion,
          nombre: accion === "crear_flow" ? nombreFlow : accion.includes("template") ? nombreTemplate : undefined,
          ...(accion === "crear_template" && cuerpo.trim() ? { cuerpo: cuerpo.trim() } : {}),
        }),
      })
      setResultado({ accion, cuando: new Date().toLocaleTimeString("es-AR"), respuesta: await r.json() })
    } catch (e: any) {
      setResultado({ accion, cuando: new Date().toLocaleTimeString("es-AR"), respuesta: { error: String(e) } })
    } finally {
      setCargando(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
          <CardDescription>
            El Flow y el template se crean en el WABA de este cliente. Si varios clientes comparten
            WABA, alcanza con hacerlo una vez.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={configId}
            onChange={(e) => setConfigId(e.target.value)}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} {c.alias ? `(${c.alias})` : ""}
              </option>
            ))}
          </select>

          {config && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">WABA {config.wabaId || "sin cargar"}</Badge>
              <Badge variant={config.clienteFlows ? "default" : "secondary"}>
                {config.clienteFlows ? "Cliente Flows activo" : "Cliente Flows apagado"}
              </Badge>
              {config.flowIdReagendar && <Badge variant="outline">flow_id {config.flowIdReagendar}</Badge>}
              {config.templateRecordatorioFlows && (
                <Badge variant="outline">template {config.templateRecordatorioFlows}</Badge>
              )}
            </div>
          )}

          {config && !config.wabaId && (
            <p className="text-sm text-red-500">
              Esta configuración no tiene WABA ID cargado. Sin eso no se puede crear nada.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nombres</CardTitle>
          <CardDescription>
            El cuerpo del template es opcional: si lo dejás vacío se usa el texto vigente del
            recordatorio con la frase de opciones actualizada. Tiene que conservar los cinco
            parámetros <code>{"{{1}}"}</code> a <code>{"{{5}}"}</code> en el mismo orden.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nombreFlow">Nombre del Flow</Label>
            <Input id="nombreFlow" value={nombreFlow} onChange={(e) => setNombreFlow(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nombreTemplate">Nombre del template</Label>
            <Input
              id="nombreTemplate"
              value={nombreTemplate}
              onChange={(e) => setNombreTemplate(e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="cuerpo">Cuerpo del template (opcional)</Label>
            <Textarea
              id="cuerpo"
              rows={4}
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              placeholder="Dejar vacío para usar el texto por defecto"
              className="font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pasos</CardTitle>
          <CardDescription>En orden. Cada uno muestra la respuesta cruda de Meta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {PASOS.map((paso, i) => (
            <div key={paso.accion}>
              {i > 0 && <Separator className="my-2" />}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{paso.titulo}</p>
                  <p className="text-xs text-muted-foreground">{paso.ayuda}</p>
                </div>
                <Button
                  size="sm"
                  variant={paso.accion === "publicar_flow" ? "destructive" : "outline"}
                  disabled={!configId || !config?.wabaId || cargando !== null}
                  onClick={() => ejecutar(paso.accion)}
                >
                  {cargando === paso.accion ? "..." : "Ejecutar"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {resultado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Respuesta de <code>{resultado.accion}</code>
            </CardTitle>
            <CardDescription>{resultado.cuando}</CardDescription>
          </CardHeader>
          <CardContent>
            {resultado.respuesta?.categoriaAsignada && (
              <p className="mb-3 text-sm">
                Categoría asignada por Meta:{" "}
                <Badge variant={resultado.respuesta.categoriaAsignada === "UTILITY" ? "default" : "destructive"}>
                  {resultado.respuesta.categoriaAsignada}
                </Badge>
              </p>
            )}
            {resultado.respuesta?.valido === false && (
              <p className="mb-3 text-sm text-red-500">
                El JSON se subió pero tiene errores de validación. Mirá <code>validation_errors</code>.
              </p>
            )}
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(resultado.respuesta, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
