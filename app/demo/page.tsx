"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  // configuración pública, y reiniciar los widgets flotantes reales (mismos
  // scripts que se integran en el sitio de la clínica).
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

    return () => {
      cancelled = true
      removeFloatingWidget()
      removeFloatingWhatsAppWidget()
      removeFloatingFormWidget()
    }
  }, [clienteId])

  const selectedClinic = clinics?.find((c) => c.cliente_id === clienteId)

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
          </div>
        </div>
      </main>
    </div>
  )
}
