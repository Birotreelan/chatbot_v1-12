"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { Copy, Eye, ExternalLink } from "lucide-react"
import type { WhatsAppConfig } from "@/lib/types"

interface WhatsAppConfigFormProps {
  config?: WhatsAppConfig
  isNew?: boolean
}

export function WhatsAppConfigForm({ config, isNew = false }: WhatsAppConfigFormProps) {
  const [mounted, setMounted] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")
  const [formData, setFormData] = useState({
    displayName: config?.displayName || "",
    phoneNumberId: config?.phoneNumberId || "",
    wabaId: config?.wabaId || "",
    whatsappAssistantId: config?.whatsappAssistantId || "",
    widgetAssistantId: config?.widgetAssistantId || "",
    accessToken: config?.accessToken || "",
    verifyToken: config?.verifyToken || "",
    active: config?.active !== undefined ? config.active : true,
    cliente_id: config?.cliente_id || "",
    proxy: config?.proxy || "",
    // Configuraciones del widget
    widgetEnabled: config?.widgetEnabled !== undefined ? config.widgetEnabled : true,
    widgetTitle: config?.widgetTitle || "Asistente Virtual",
    widgetPrimaryColor: config?.widgetPrimaryColor || "#0ea5e9",
    widgetSecondaryColor: config?.widgetSecondaryColor || "#f0f9ff",
    widgetPosition: config?.widgetPosition || "bottom-right",
    widgetWelcomeMessage: config?.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: config?.widgetPlaceholder || "Escribe tu mensaje...",
    widgetButtonText: config?.widgetButtonText || "Enviar",
    widgetHeaderText: config?.widgetHeaderText || "Chat en vivo",
    widgetSubtitle: config?.widgetSubtitle || "Estamos aquí para ayudarte",
    widgetBrandingEnabled: config?.widgetBrandingEnabled !== undefined ? config.widgetBrandingEnabled : true,
    widgetBrandingText: config?.widgetBrandingText || "Powered by AI Assistant",
    widgetMaxHeight: config?.widgetMaxHeight || 600,
    widgetMaxWidth: config?.widgetMaxWidth || 400,
    widgetBorderRadius: config?.widgetBorderRadius || 12,
    widgetShadow: config?.widgetShadow !== undefined ? config.widgetShadow : true,
    widgetAnimation: config?.widgetAnimation !== undefined ? config.widgetAnimation : true,
    widgetSoundEnabled: config?.widgetSoundEnabled !== undefined ? config.widgetSoundEnabled : true,
    widgetTheme: config?.widgetTheme || "light",
    // Nuevos campos para el botón flotante
    widgetFloatingButtonText: config?.widgetFloatingButtonText || "Obtené tu turno con nuestro asistente virtual",
    widgetShowFloatingText: config?.widgetShowFloatingText !== undefined ? config.widgetShowFloatingText : true,
  })
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin)
    }

    // Debug logging
    console.log("[FORM] Component mounted with props:", { isNew, configId: config?.id })
    console.log("[FORM] Current URL:", typeof window !== "undefined" ? window.location.pathname : "SSR")
  }, [isNew, config?.id])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    const checked = (e.target as HTMLInputElement).checked
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : type === "number" ? Number(value) : value,
    }))
  }

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      [name]: checked,
    }))
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      console.log(`[FORM] === INICIO DEL SUBMIT ===`)
      console.log(`[FORM] isNew: ${isNew}`)
      console.log(`[FORM] config?.id: ${config?.id}`)
      console.log(`[FORM] URL actual: ${typeof window !== "undefined" ? window.location.pathname : "SSR"}`)
      console.log(`[FORM] Datos del formulario:`, formData)

      let response: Response
      let requestUrl: string
      let requestMethod: string

      if (isNew) {
        // Para crear una nueva configuración
        requestUrl = "/api/dashboard/configs"
        requestMethod = "POST"

        console.log(`[FORM] === CREANDO NUEVA CONFIGURACIÓN ===`)
        console.log(`[FORM] URL: ${requestUrl}`)
        console.log(`[FORM] Método: ${requestMethod}`)

        response = await fetch(requestUrl, {
          method: requestMethod,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        })
      } else {
        // Para actualizar una configuración existente
        requestUrl = `/api/dashboard/configs/${config?.id}`
        requestMethod = "PUT"

        console.log(`[FORM] === ACTUALIZANDO CONFIGURACIÓN EXISTENTE ===`)
        console.log(`[FORM] URL: ${requestUrl}`)
        console.log(`[FORM] Método: ${requestMethod}`)

        response = await fetch(requestUrl, {
          method: requestMethod,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        })

        // Si falla con 405, intentar con la ruta alternativa
        if (response.status === 405) {
          console.log(`[FORM] Ruta dinámica falló, intentando ruta alternativa`)
          requestUrl = "/api/dashboard/configs/update"
          requestMethod = "POST"

          response = await fetch(requestUrl, {
            method: requestMethod,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: config?.id, ...formData }),
          })
        }
      }

      console.log(`[FORM] Respuesta del servidor:`, {
        status: response.status,
        statusText: response.statusText,
        url: requestUrl,
        method: requestMethod,
      })

      if (!response.ok) {
        let errorDetails = "Error desconocido"
        try {
          const errorData = await response.json()
          errorDetails = errorData.details || errorData.error || errorDetails
          console.error(`[FORM] Error del servidor:`, errorData)
        } catch (parseError) {
          console.error(`[FORM] Error al parsear respuesta de error:`, parseError)
          errorDetails = `Error ${response.status}: ${response.statusText}`
        }
        throw new Error(errorDetails)
      }

      const result = await response.json()
      console.log(`[FORM] Configuración ${isNew ? "creada" : "actualizada"} exitosamente:`, result)

      toast({
        title: isNew ? "Configuración creada" : "Configuración actualizada",
        description: `La configuración se ha ${isNew ? "creado" : "actualizado"} correctamente.`,
      })

      if (isNew && result.id && mounted) {
        // Redirigir a la página de edición
        console.log(`[FORM] Redirigiendo a /dashboard/config/${result.id}`)
        window.location.href = `/dashboard/config/${result.id}`
      }
    } catch (error) {
      console.error(`[FORM] Error al ${isNew ? "crear" : "actualizar"} configuración:`, error)

      const errorMessage = error instanceof Error ? error.message : "Error desconocido"

      toast({
        title: `Error al ${isNew ? "crear" : "actualizar"}`,
        description: `No se pudo ${isNew ? "crear" : "actualizar"} la configuración: ${errorMessage}`,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    if (!mounted || typeof window === "undefined") return

    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: "Copiado",
        description: "El texto se ha copiado al portapapeles.",
      })
    } catch (err) {
      console.error("Error al copiar:", err)
      toast({
        title: "Error",
        description: "No se pudo copiar el texto.",
        variant: "destructive",
      })
    }
  }

  const openInNewTab = (url: string) => {
    if (!mounted || typeof window === "undefined") return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const getWidgetUrl = () => {
    if (!config?.id || !baseUrl) return ""
    return `${baseUrl}/widget/${config.id}`
  }

  const getChatUrl = () => {
    if (!config?.id || !baseUrl) return ""
    return `${baseUrl}/chat/${config.id}`
  }

  const getEmbedCode = () => {
    if (!config?.id || !baseUrl) return ""
    return `<iframe src="${getWidgetUrl()}" width="400" height="600" frameborder="0" style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></iframe>`
  }

  const getJavaScriptCode = () => {
    if (!config?.id || !config?.cliente_id || !baseUrl) return "// Se requiere cliente_id para generar el código"

    return `<script src="${baseUrl}/widget-loader.js" data-client-id="${config.cliente_id}"></script>`
  }

  // Mostrar loading hasta que el componente esté montado
  if (!mounted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cargando configuración...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isNew ? "Nueva Configuración" : "Editar Configuración"}
          <span className="text-sm text-gray-500 ml-2">
            (Debug: isNew={String(isNew)}, configId={config?.id || "undefined"})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              <TabsTrigger value="widget">Widget</TabsTrigger>
              <TabsTrigger value="integration">Integración</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Nombre de la configuración</Label>
                  <Input
                    id="displayName"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleChange}
                    placeholder="Mi WhatsApp Bot"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsappAssistantId">Assistant ID para WhatsApp</Label>
                  <Input
                    id="whatsappAssistantId"
                    name="whatsappAssistantId"
                    value={formData.whatsappAssistantId}
                    onChange={handleChange}
                    placeholder="asst_... (para WhatsApp)"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetAssistantId">Assistant ID para Widget</Label>
                  <Input
                    id="widgetAssistantId"
                    name="widgetAssistantId"
                    value={formData.widgetAssistantId}
                    onChange={handleChange}
                    placeholder="asst_... (para Widget Web)"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cliente_id">Cliente ID</Label>
                  <Input
                    id="cliente_id"
                    name="cliente_id"
                    value={formData.cliente_id}
                    onChange={handleChange}
                    placeholder="ID del cliente para la API"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proxy">URL del Proxy</Label>
                  <Input
                    id="proxy"
                    name="proxy"
                    value={formData.proxy}
                    onChange={handleChange}
                    placeholder="https://proxy.ejemplo.com"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="active"
                    name="active"
                    checked={formData.active}
                    onCheckedChange={(checked) => handleSwitchChange("active", checked)}
                  />
                  <Label htmlFor="active">Configuración activa</Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="whatsapp" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID</Label>
                  <Input
                    id="phoneNumberId"
                    name="phoneNumberId"
                    value={formData.phoneNumberId}
                    onChange={handleChange}
                    placeholder="123456789012345"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wabaId">WABA ID</Label>
                  <Input
                    id="wabaId"
                    name="wabaId"
                    value={formData.wabaId}
                    onChange={handleChange}
                    placeholder="123456789012345"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="accessToken">Access Token</Label>
                  <Input
                    id="accessToken"
                    name="accessToken"
                    type="password"
                    value={formData.accessToken}
                    onChange={handleChange}
                    placeholder="EAAxxxxx..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="verifyToken">Verify Token</Label>
                  <Input
                    id="verifyToken"
                    name="verifyToken"
                    value={formData.verifyToken}
                    onChange={handleChange}
                    placeholder="mi_token_secreto"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="widget" className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch
                  id="widgetEnabled"
                  checked={formData.widgetEnabled}
                  onCheckedChange={(checked) => handleSwitchChange("widgetEnabled", checked)}
                />
                <Label htmlFor="widgetEnabled">Habilitar Widget Web</Label>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetTitle">Título del Widget</Label>
                  <Input
                    id="widgetTitle"
                    name="widgetTitle"
                    value={formData.widgetTitle}
                    onChange={handleChange}
                    placeholder="Asistente Virtual"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetHeaderText">Texto del Header</Label>
                  <Input
                    id="widgetHeaderText"
                    name="widgetHeaderText"
                    value={formData.widgetHeaderText}
                    onChange={handleChange}
                    placeholder="Chat en vivo"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetSubtitle">Subtítulo</Label>
                  <Input
                    id="widgetSubtitle"
                    name="widgetSubtitle"
                    value={formData.widgetSubtitle}
                    onChange={handleChange}
                    placeholder="Estamos aquí para ayudarte"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetButtonText">Texto del Botón</Label>
                  <Input
                    id="widgetButtonText"
                    name="widgetButtonText"
                    value={formData.widgetButtonText}
                    onChange={handleChange}
                    placeholder="Enviar"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetPlaceholder">Placeholder del Input</Label>
                  <Input
                    id="widgetPlaceholder"
                    name="widgetPlaceholder"
                    value={formData.widgetPlaceholder}
                    onChange={handleChange}
                    placeholder="Escribe tu mensaje..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetTheme">Tema</Label>
                  <Select
                    value={formData.widgetTheme}
                    onValueChange={(value) => handleSelectChange("widgetTheme", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Claro</SelectItem>
                      <SelectItem value="dark">Oscuro</SelectItem>
                      <SelectItem value="auto">Automático</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="widgetWelcomeMessage">Mensaje de Bienvenida</Label>
                <Textarea
                  id="widgetWelcomeMessage"
                  name="widgetWelcomeMessage"
                  value={formData.widgetWelcomeMessage}
                  onChange={handleChange}
                  placeholder="¡Hola! ¿En qué puedo ayudarte hoy?"
                  rows={3}
                />
              </div>

              <Separator />

              {/* Sección del Botón Flotante */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium">Configuración del Botón Flotante</h4>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetShowFloatingText"
                    checked={formData.widgetShowFloatingText}
                    onCheckedChange={(checked) => handleSwitchChange("widgetShowFloatingText", checked)}
                  />
                  <Label htmlFor="widgetShowFloatingText">Mostrar texto junto al botón flotante</Label>
                </div>

                {formData.widgetShowFloatingText && (
                  <div className="space-y-2">
                    <Label htmlFor="widgetFloatingButtonText">Texto del Botón Flotante</Label>
                    <Input
                      id="widgetFloatingButtonText"
                      name="widgetFloatingButtonText"
                      value={formData.widgetFloatingButtonText}
                      onChange={handleChange}
                      placeholder="Obtené tu turno con nuestro asistente virtual"
                    />
                    <p className="text-sm text-gray-500">
                      Este texto aparecerá junto al botón flotante para invitar a los usuarios a interactuar
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetPrimaryColor">Color Primario</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={formData.widgetPrimaryColor}
                      onChange={(e) =>
                        handleChange({
                          target: { name: "widgetPrimaryColor", value: e.target.value, type: "text" },
                        } as any)
                      }
                      className="w-12 h-10 p-1"
                    />
                    <Input
                      type="text"
                      value={formData.widgetPrimaryColor}
                      onChange={(e) =>
                        handleChange({
                          target: { name: "widgetPrimaryColor", value: e.target.value, type: "text" },
                        } as any)
                      }
                      className="flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetSecondaryColor">Color Secundario</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={formData.widgetSecondaryColor}
                      onChange={(e) =>
                        handleChange({
                          target: { name: "widgetSecondaryColor", value: e.target.value, type: "text" },
                        } as any)
                      }
                      className="w-12 h-10 p-1"
                    />
                    <Input
                      type="text"
                      value={formData.widgetSecondaryColor}
                      onChange={(e) =>
                        handleChange({
                          target: { name: "widgetSecondaryColor", value: e.target.value, type: "text" },
                        } as any)
                      }
                      className="flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Posición del Widget</Label>
                  <RadioGroup
                    value={formData.widgetPosition}
                    onValueChange={(value) => handleSelectChange("widgetPosition", value)}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="bottom-right" id="bottom-right" />
                      <Label htmlFor="bottom-right">Inferior Derecha</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="bottom-left" id="bottom-left" />
                      <Label htmlFor="bottom-left">Inferior Izquierda</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetMaxWidth">Ancho Máximo (px)</Label>
                  <Input
                    id="widgetMaxWidth"
                    name="widgetMaxWidth"
                    type="number"
                    value={formData.widgetMaxWidth}
                    onChange={handleChange}
                    min="300"
                    max="800"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetMaxHeight">Alto Máximo (px)</Label>
                  <Input
                    id="widgetMaxHeight"
                    name="widgetMaxHeight"
                    type="number"
                    value={formData.widgetMaxHeight}
                    onChange={handleChange}
                    min="400"
                    max="800"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetBorderRadius">Radio del Borde (px)</Label>
                  <Input
                    id="widgetBorderRadius"
                    name="widgetBorderRadius"
                    type="number"
                    value={formData.widgetBorderRadius}
                    onChange={handleChange}
                    min="0"
                    max="50"
                  />
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetShadow"
                    checked={formData.widgetShadow}
                    onCheckedChange={(checked) => handleSwitchChange("widgetShadow", checked)}
                  />
                  <Label htmlFor="widgetShadow">Mostrar Sombra</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetAnimation"
                    checked={formData.widgetAnimation}
                    onCheckedChange={(checked) => handleSwitchChange("widgetAnimation", checked)}
                  />
                  <Label htmlFor="widgetAnimation">Habilitar Animaciones</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetSoundEnabled"
                    checked={formData.widgetSoundEnabled}
                    onCheckedChange={(checked) => handleSwitchChange("widgetSoundEnabled", checked)}
                  />
                  <Label htmlFor="widgetSoundEnabled">Sonidos de Notificación</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetBrandingEnabled"
                    checked={formData.widgetBrandingEnabled}
                    onCheckedChange={(checked) => handleSwitchChange("widgetBrandingEnabled", checked)}
                  />
                  <Label htmlFor="widgetBrandingEnabled">Mostrar Branding</Label>
                </div>
              </div>

              {formData.widgetBrandingEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="widgetBrandingText">Texto del Branding</Label>
                  <Input
                    id="widgetBrandingText"
                    name="widgetBrandingText"
                    value={formData.widgetBrandingText}
                    onChange={handleChange}
                    placeholder="Powered by AI Assistant"
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="integration" className="space-y-6">
              {!isNew && config?.id && baseUrl && (
                <>
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">URLs del Widget</h3>

                    <div className="space-y-3">
                      <div>
                        <Label className="text-sm font-medium">URL del Widget</Label>
                        <div className="flex gap-2 mt-1">
                          <Input value={getWidgetUrl()} readOnly className="flex-1" />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(getWidgetUrl())}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openInNewTab(getWidgetUrl())}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Página de Demostración</Label>
                        <div className="flex gap-2 mt-1">
                          <Input value={getChatUrl()} readOnly className="flex-1" />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(getChatUrl())}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => openInNewTab(getChatUrl())}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Código de Integración</h3>

                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Código HTML (iframe)</Label>
                        <div className="mt-2">
                          <Textarea value={getEmbedCode()} readOnly rows={3} className="font-mono text-sm" />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => copyToClipboard(getEmbedCode())}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar Código HTML
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Código JavaScript</Label>
                        <div className="mt-2">
                          <Textarea value={getJavaScriptCode()} readOnly rows={8} className="font-mono text-sm" />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2"
                            onClick={() => copyToClipboard(getJavaScriptCode())}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar Código JavaScript
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h4 className="font-medium text-blue-900 mb-2">Instrucciones de Integración</h4>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Para integrar como iframe: Copia y pega el código HTML en tu sitio web</li>
                      <li>
                        • Para integrar como widget flotante: Copia y pega el código JavaScript antes del cierre del tag
                        &lt;/body&gt;
                      </li>
                      <li>• El widget se posicionará automáticamente según la configuración seleccionada</li>
                      <li>• Puedes personalizar todos los aspectos visuales desde la pestaña "Widget"</li>
                      <li>• El texto del botón flotante aparecerá automáticamente si está habilitado</li>
                    </ul>
                  </div>
                </>
              )}

              {(isNew || !config?.id || !baseUrl) && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-gray-600">
                    {isNew
                      ? "Los códigos de integración estarán disponibles después de guardar la configuración."
                      : "Cargando códigos de integración..."}
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading} className="min-w-[120px]">
              {isLoading ? "Guardando..." : isNew ? "Crear Configuración" : "Actualizar Configuración"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
