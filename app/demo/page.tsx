"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { WhatsAppCtaPreview } from "@/components/dashboard/whatsapp-cta-preview"

interface ClinicOption {
  cliente_id: string
  displayName: string
  widgetEnabled: boolean
  active: boolean
  whatsappNumber?: string
}

interface WidgetPublicConfig {
  id?: string
  displayName?: string
  widgetEnabled?: boolean
  widgetTitle?: string
  widgetSubtitle?: string
  widgetWelcomeMessage?: string
  widgetPlaceholder?: string
  widgetFloatingButtonText?: string
  widgetPrimaryColor?: string
  widgetSecondaryColor?: string
  error?: string
}

const WIDGET_SCRIPT_ID = "demo-widget-loader-script"
const WHATSAPP_WIDGET_SCRIPT_ID = "demo-whatsapp-widget-loader-script"
const FORM_WIDGET_SCRIPT_ID = "demo-form-widget-loader-script"

function removeFloatingWidget() {
  document.getElementById("chat-widget-button")?.remove()
  document.getElementById("chat-widget-container")?.remove()
  document.getElementById(WIDGET_SCRIPT_ID)?.remove()
}

function removeFloatingWhatsAppWidget() {
  document.getElementById("iris-whatsapp-widget-button")?.remove()
  document.getElementById("iris-whatsapp-widget-styles")?.remove()
  document.getElementById(WHATSAPP_WIDGET_SCRIPT_ID)?.remove()
}

function removeFloatingFormWidget() {
  document.getElementById("iris-form-widget-button")?.remove()
  document.getElementById("iris-form-widget-container")?.remove()
  document.getElementById("iris-form-widget-styles")?.remove()
  document.getElementById(FORM_WIDGET_SCRIPT_ID)?.remove()
}

export default function DemoPage() {
  const [clinics, setClinics] = useState<ClinicOption[] | null>(null)
  const [loadingClinics, setLoadingClinics] = useState(true)
  const [clienteId, setClienteId] = useState<string>("")
  const [config, setConfig] = useState<WidgetPublicConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")
  const [previewKey, setPreviewKey] = useState(0)

  // Cargar la lista de clínicas y preseleccionar según la URL (?cliente_id=)
  useEffect(() => {
    setBaseUrl(window.location.origin)

    async function loadClinics() {
      try {
        const res = await fetch("/api/widget/clinics")
        const data: ClinicOption[] = res.ok ? await res.json() : []
        setClinics(data)

        const fromUrl = new URLSearchParams(window.location.search).get("cliente_id")
        if (fromUrl) {
          setClienteId(fromUrl)
        } else if (data.length > 0) {
          setClienteId(data[0].cliente_id)
        } else {
          setClienteId("demo-client")
        }
      } catch (error) {
        console.error("Error al cargar la lista de clínicas:", error)
        setClinics([])
        setClienteId("demo-client")
      } finally {
        setLoadingClinics(false)
      }
    }

    loadClinics()
  }, [])

  // Cada vez que cambia la clínica seleccionada: actualizar la URL, traer su
  // configuración pública, y reiniciar tanto el widget flotante (script real,
  // igual que en el sitio de la clínica) como la vista previa embebida.
  useEffect(() => {
    if (!clienteId) return

    const url = new URL(window.location.href)
    url.searchParams.set("cliente_id", clienteId)
    window.history.replaceState({}, "", url.toString())

    let cancelled = false
    setLoadingConfig(true)
    fetch(`/api/widget?cliente_id=${encodeURIComponent(clienteId)}&_t=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setConfig(data)
      })
      .catch((error) => {
        console.error("Error al cargar la configuración del widget:", error)
        if (!cancelled) setConfig({ error: "No se pudo cargar la configuración" })
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false)
      })

    removeFloatingWidget()
    const script = document.createElement("script")
    script.id = WIDGET_SCRIPT_ID
    script.src = "/widget-loader.js"
    script.async = true
    script.setAttribute("data-client-id", clienteId)
    document.body.appendChild(script)

    removeFloatingWhatsAppWidget()
    const whatsappScript = document.createElement("script")
    whatsappScript.id = WHATSAPP_WIDGET_SCRIPT_ID
    whatsappScript.src = "/whatsapp-widget-loader.js"
    whatsappScript.async = true
    whatsappScript.setAttribute("data-client-id", clienteId)
    document.body.appendChild(whatsappScript)

    // El widget de formulario se ancla al mismo costado que el chat pero 70px
    // más arriba (ver widget-form-loader.js), así que convive apilado encima
    // del botón del chat cerrado en vez de ocultarse. Abrir uno cierra el otro
    // (evento "iris-widget-toggle"), por lo que nunca quedan dos paneles abiertos
    // a la vez.
    removeFloatingFormWidget()
    const formScript = document.createElement("script")
    formScript.id = FORM_WIDGET_SCRIPT_ID
    formScript.src = "/widget-form-loader.js"
    formScript.async = true
    formScript.setAttribute("data-client-id", clienteId)
    document.body.appendChild(formScript)

    setPreviewKey((k) => k + 1)

    return () => {
      cancelled = true
      removeFloatingWidget()
      removeFloatingWhatsAppWidget()
      removeFloatingFormWidget()
    }
  }, [clienteId])

  const reloadPreview = useCallback(() => {
    setPreviewKey((k) => k + 1)
  }, [])

  // La vista previa embebida siempre está visible (no es un widget flotante
  // que se abre/cierra), así que acá no tiene sentido "ocultarla" cuando el
  // visitante toca la X del header — en su lugar, tratamos ese cierre como
  // un reinicio de la conversación (mismo efecto que "Reiniciar chat").
  useEffect(() => {
    function handleWidgetMessage(event: MessageEvent) {
      const data = event.data
      if (data && data.source === "iris-widget" && data.type === "close") {
        setPreviewKey((k) => k + 1)
      }
    }
    window.addEventListener("message", handleWidgetMessage)
    return () => window.removeEventListener("message", handleWidgetMessage)
  }, [])

  const selectedClinic = clinics?.find((c) => c.cliente_id === clienteId)
  const previewUrl = clienteId
    ? `/widget?clienteId=${encodeURIComponent(clienteId)}&embedded=true&_t=${previewKey}`
    : ""
  const formPreviewUrl = clienteId
    ? `/widget-form?clienteId=${encodeURIComponent(clienteId)}&embedded=true&_t=${previewKey}`
    : ""

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Demo Widget</h1>
          <p className="text-gray-600 mt-1">
            Probá el widget de agendamiento de cualquiera de las clínicas configuradas, tal como lo verían sus
            pacientes.
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Elegir clínica</CardTitle>
                <CardDescription>Seleccioná qué clínica querés probar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingClinics ? (
                  <div className="h-10 bg-gray-200 rounded animate-pulse" />
                ) : clinics && clinics.length > 0 ? (
                  <Select value={clienteId} onValueChange={setClienteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccioná una clínica" />
                    </SelectTrigger>
                    <SelectContent>
                      {clinics.map((clinic) => (
                        <SelectItem key={clinic.cliente_id} value={clinic.cliente_id}>
                          {clinic.displayName}
                          {!clinic.widgetEnabled ? " (widget deshabilitado)" : ""}
                          {!clinic.active ? " (inactiva)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-gray-500">
                    No hay clínicas configuradas todavía. Se está usando <code>demo-client</code> como valor de
                    prueba.
                  </p>
                )}

                {selectedClinic && (
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant={selectedClinic.widgetEnabled ? "default" : "secondary"}>
                      {selectedClinic.widgetEnabled ? "Widget habilitado" : "Widget deshabilitado"}
                    </Badge>
                    <Badge variant={selectedClinic.active ? "default" : "secondary"}>
                      {selectedClinic.active ? "Cliente activo" : "Cliente inactivo"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Configuración actual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {loadingConfig ? (
                  <div className="h-20 bg-gray-200 rounded animate-pulse" />
                ) : config?.error ? (
                  <p className="text-orange-600">{config.error}</p>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Cliente ID:</span>
                      <code className="bg-gray-100 px-2 py-1 rounded">{clienteId}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Estado del widget:</span>
                      <span className={config?.widgetEnabled ? "text-green-600 font-medium" : "text-orange-600 font-medium"}>
                        {config?.widgetEnabled ? "Habilitado" : "Deshabilitado"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Título:</span>
                      <span className="font-medium">{config?.widgetTitle || "Chat en vivo"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Color primario:</span>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded border"
                          style={{ backgroundColor: config?.widgetPrimaryColor || "#0ea5e9" }}
                        />
                        <span className="font-mono text-xs">{config?.widgetPrimaryColor || "#0ea5e9"}</span>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integración</CardTitle>
                <CardDescription>
                  Código para embeber este widget en el sitio de la clínica seleccionada.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm whitespace-pre">
                    {`<script\n  src="${baseUrl || "https://tu-dominio.com"}/widget-loader.js"\n  data-client-id="${clienteId}"\n></script>`}
                  </code>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Vista previa en vivo</CardTitle>
                  <CardDescription>Conversación real contra el motor de agendamiento.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={reloadPreview}>
                  Reiniciar chat
                </Button>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden" style={{ height: 520 }}>
                  {clienteId ? (
                    <iframe
                      key={previewKey}
                      src={previewUrl}
                      className="w-full h-full border-0"
                      title="Vista previa del widget"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                      Elegí una clínica para ver el chat
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Además de esta vista embebida, el botón flotante real (mismo script que se integra en el sitio de la
                  clínica) aparece en la esquina inferior derecha de esta página, cerrado — así se prueba también el
                  widget-loader.js tal como lo ve un visitante. El botón del formulario queda apilado justo arriba;
                  abrir uno cierra el otro automáticamente.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>Widget de Formulario</CardTitle>
                  <CardDescription>
                    Mismo motor de agendamiento, pero con inputs, botones y un calendario en vez de chat.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={reloadPreview}>
                  Reiniciar formulario
                </Button>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden" style={{ height: 560 }}>
                  {clienteId ? (
                    <iframe
                      key={`form-${previewKey}`}
                      src={formPreviewUrl}
                      className="w-full h-full border-0"
                      title="Vista previa del widget de formulario"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                      Elegí una clínica para ver el formulario
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  El botón flotante real de este widget aparece apilado justo arriba del botón del chat, en la esquina
                  inferior derecha. Ambos pueden convivir en el mismo sitio: abrir uno cierra el otro automáticamente,
                  así nunca se superponen dos paneles a la vez.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integración Formulario</CardTitle>
                <CardDescription>
                  Código para embeber el widget de formulario en el sitio de la clínica seleccionada.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm whitespace-pre">
                    {`<script\n  src="${baseUrl || "https://tu-dominio.com"}/widget-form-loader.js"\n  data-client-id="${clienteId}"\n></script>`}
                  </code>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Widget de WhatsApp</CardTitle>
                <CardDescription>
                  Botón flotante chico, esquina inferior izquierda — para quien prefiera esa vía en vez del chat
                  embebido.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WhatsAppCtaPreview
                  clinicName={selectedClinic?.displayName || ""}
                  whatsappNumber={selectedClinic?.whatsappNumber}
                />
                <p className="text-xs text-gray-500 mt-4">
                  El botón real (mismo script que se integra en el sitio de la clínica) aparece en la esquina
                  inferior izquierda de esta página.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Integración WhatsApp</CardTitle>
                <CardDescription>
                  Código para embeber el botón de WhatsApp en el sitio de la clínica seleccionada.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                  <code className="text-sm whitespace-pre">
                    {`<script\n  src="${baseUrl || "https://tu-dominio.com"}/whatsapp-widget-loader.js"\n  data-client-id="${clienteId}"\n></script>`}
                  </code>
                </div>
              </CardContent>
            </Card>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-blue-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <div className="ml-3 text-sm text-blue-700">
                  <p className="font-medium text-blue-800 mb-1">Recordatorio</p>
                  <p>
                    Esta página solo cambia a qué clínica apunta el widget de prueba — la conversación agenda turnos
                    reales contra esa clínica. Usá un DNI de prueba, no el de un paciente real.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
