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
import { construirFlowJson } from "@/lib/flows/flow-reagendar"
import { previsualizarFlow, type PantallaVisible } from "@/lib/flows/previsualizacion"

interface Props {
  configs: WhatsAppConfig[]
}

/**
 * Dibuja el Flow como lo va a ver el paciente, a partir del mismo Flow JSON que
 * se sube a Meta. No es una maqueta hecha a mano: si el JSON cambia, esto
 * cambia — que es la única forma de que previsualizar sirva para algo.
 */
function Previsualizacion({ pantalla }: { pantalla: PantallaVisible }) {
  return (
    <div className="w-full max-w-[280px] overflow-hidden rounded-xl border bg-background">
      <div className="border-b bg-muted/50 px-3 py-2">
        <p className="text-xs font-medium">{pantalla.titulo}</p>
      </div>
      <div className="space-y-3 p-3">
        {pantalla.componentes.map((c, i) => {
          if (c.tipo === "parrafo") return <p key={i} className="text-xs leading-relaxed">{c.texto}</p>
          if (c.tipo === "subtitulo") return <p key={i} className="text-xs font-medium">{c.texto}</p>
          if (c.tipo === "opciones") {
            return (
              <div key={i} className="space-y-1.5">
                {c.etiqueta && <p className="text-[10px] uppercase text-muted-foreground">{c.etiqueta}</p>}
                {c.opciones.map((o) => (
                  <div key={o.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5">
                    <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full border" />
                    <div className="min-w-0">
                      <p className="text-xs">{o.title}</p>
                      {o.description && <p className="text-[10px] text-muted-foreground">{o.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
          if (c.tipo === "boton") {
            return (
              <div key={i} className="rounded-md bg-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground">
                {c.texto}
              </div>
            )
          }
          return (
            <p key={i} className="rounded border border-dashed px-2 py-1 text-[10px] text-muted-foreground">
              Componente no previsualizable: {c.texto}
            </p>
          )
        })}
      </div>
    </div>
  )
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
  { accion: "ver_json", titulo: "5b. Ver qué pantallas tiene", ayuda: "Si dice WELCOME_SCREEN, el Flow sigue con la plantilla por defecto de Meta." },
  { accion: "crear_template", titulo: "6. Crear el template", ayuda: "La respuesta dice en qué categoría lo clasificó Meta." },
  { accion: "estado_template", titulo: "7. Ver el template", ayuda: "En qué estado de aprobación quedó." },
] as const

export function FlowsSetup({ configs }: Props) {
  const [configId, setConfigId] = useState<string>(configs[0]?.id || "")
  const [nombreFlow, setNombreFlow] = useState("reagendar_turno")
  const [nombreTemplate, setNombreTemplate] = useState("confirmacion_1_turno_flows")
  const [cuerpo, setCuerpo] = useState("")
  const [flowIdManual, setFlowIdManual] = useState("")
  const [telefonoPrueba, setTelefonoPrueba] = useState("")
  const [cargando, setCargando] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const config = configs.find((c) => c.id === configId)
  const pantallas = previsualizarFlow(construirFlowJson())

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
          // Si está cargado a mano, manda al Flow que digas y no al guardado en
          // la configuración. Es lo que permite desempatar cuando hay más de uno.
          ...(flowIdManual.trim() ? { flowId: flowIdManual.trim() } : {}),
          ...(accion === "crear_template" && cuerpo.trim() ? { cuerpo: cuerpo.trim() } : {}),
          ...(accion === "enviar_prueba" ? { telefono: telefonoPrueba } : {}),
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
            <Label htmlFor="flowIdManual">Flow ID (opcional)</Label>
            <Input
              id="flowIdManual"
              value={flowIdManual}
              onChange={(e) => setFlowIdManual(e.target.value)}
              placeholder={config?.flowIdReagendar || "el guardado en la configuración"}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Si lo completás, todos los pasos apuntan a ESE Flow en vez del guardado. Sirve para
              desempatar cuando hay más de uno en el WABA: corré el paso 1, mirá los ids, y pegá el
              que corresponda.
            </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Así lo ve el paciente</CardTitle>
          <CardDescription>
            Dibujado a partir del mismo Flow JSON que se sube en el paso 3, con los datos de
            ejemplo que el propio Flow declara. Si el JSON cambia, esto cambia. Los horarios reales
            los arma el sistema en el momento de enviarlo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {pantallas.map((p) => (
            <Previsualizacion key={p.id} pantalla={p} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Probarlo en un teléfono</CardTitle>
          <CardDescription>
            Manda el Flow en modo borrador, así se puede ver de verdad antes de publicarlo. Dos
            condiciones: las pantallas tienen que estar subidas (paso 3), y ese número tiene que
            haberle escrito al bot hace menos de 24 horas — si no, WhatsApp no deja mandar mensajes
            que no sean plantillas.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-2">
            <Label htmlFor="telefonoPrueba">Teléfono</Label>
            <Input
              id="telefonoPrueba"
              value={telefonoPrueba}
              onChange={(e) => setTelefonoPrueba(e.target.value)}
              placeholder="5491144175052"
              inputMode="numeric"
            />
          </div>
          <Button
            variant="outline"
            disabled={!configId || !config?.wabaId || telefonoPrueba.replace(/\D/g, "").length < 8 || cargando !== null}
            onClick={() => ejecutar("enviar_prueba")}
          >
            {cargando === "enviar_prueba" ? "Enviando..." : "Enviar prueba"}
          </Button>
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
            {resultado.respuesta?.loQueDiceMeta && (
              <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm">
                <span className="font-medium">Meta dice:</span> {resultado.respuesta.loQueDiceMeta}
              </p>
            )}
            {Array.isArray(resultado.respuesta?.pantallas) && (
              <p className="mb-3 text-sm">
                Pantallas de este Flow:{" "}
                {resultado.respuesta.pantallas.length === 0 ? (
                  <span className="text-muted-foreground">ninguna</span>
                ) : (
                  resultado.respuesta.pantallas.map((p: string) => (
                    <Badge key={p} variant={p === "ELEGIR_TURNO" ? "default" : "destructive"} className="mr-1">
                      {p}
                    </Badge>
                  ))
                )}
              </p>
            )}
            {resultado.respuesta?.flowIdConsultado && (
              <p className="mb-3 text-xs text-muted-foreground">
                Flow consultado: <code>{resultado.respuesta.flowIdConsultado}</code>
              </p>
            )}
            {Array.isArray(resultado.respuesta?.pistas) && (
              <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
                {resultado.respuesta.pistas.map((p: string, i: number) => (
                  <li key={i}>— {p}</li>
                ))}
              </ul>
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
