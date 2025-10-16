"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface WhatsAppConfigFormProps {
  config?: WhatsAppConfig
  onSave: (config: Partial<WhatsAppConfig>) => Promise<void>
  onCancel: () => void
  isLoading?: boolean
}

export function WhatsAppConfigForm({ config, onSave, onCancel, isLoading }: WhatsAppConfigFormProps) {
  const { toast } = useToast()
  const [formData, setFormData] = useState<Partial<WhatsAppConfig>>({
    displayName: "",
    phoneNumberId: "",
    wabaId: "",
    whatsappAssistantId: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
    widgetAssistantId: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
    active: true,
    verifyToken: "",
    accessToken: "",
    webhookUrl: "",
    cliente_id: "",
    proxy: "",
    escalationPhoneNumber: "",
    // Widget settings
    widgetEnabled: true,
    widgetTitle: "Asistente Virtual",
    widgetPrimaryColor: "#0ea5e9",
    widgetSecondaryColor: "#f0f9ff",
    widgetPosition: "bottom-right",
    widgetWelcomeMessage: "¡Hola! ¿En qué puedo ayudarte hoy?",
    widgetPlaceholder: "Escribe tu mensaje...",
    widgetButtonText: "Enviar",
    widgetHeaderText: "Chat de Soporte",
    widgetSubtitle: "Estamos aquí para ayudarte",
    widgetBrandingEnabled: true,
    widgetBrandingText: "Powered by AI",
    widgetMaxHeight: 600,
    widgetMaxWidth: 400,
    widgetBorderRadius: 12,
    widgetShadow: true,
    widgetAnimation: true,
    widgetSoundEnabled: true,
    widgetTheme: "light",
    widgetFloatingButtonText: "Obtené tu turno con nuestro asistente virtual",
    widgetShowFloatingText: true,
    ...config,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (config) {
      setFormData((prev) => ({
        ...prev,
        ...config,
      }))
    }
  }, [config])

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.displayName?.trim()) {
      newErrors.displayName = "El nombre es requerido"
    }

    if (!formData.phoneNumberId?.trim()) {
      newErrors.phoneNumberId = "El Phone Number ID es requerido"
    }

    if (!formData.whatsappAssistantId?.trim()) {
      newErrors.whatsappAssistantId = "El Assistant ID de WhatsApp es requerido"
    }

    if (!formData.widgetAssistantId?.trim()) {
      newErrors.widgetAssistantId = "El Assistant ID del Widget es requerido"
    }

    if (!formData.cliente_id?.trim()) {
      newErrors.cliente_id = "El Cliente ID es requerido"
    }

    if (!formData.escalationPhoneNumber?.trim()) {
      newErrors.escalationPhoneNumber = "El Número de Derivación es requerido"
    }

    // Validar colores hex
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    if (formData.widgetPrimaryColor && !hexColorRegex.test(formData.widgetPrimaryColor)) {
      newErrors.widgetPrimaryColor = "Debe ser un color hexadecimal válido (ej: #0ea5e9)"
    }

    if (formData.widgetSecondaryColor && !hexColorRegex.test(formData.widgetSecondaryColor)) {
      newErrors.widgetSecondaryColor = "Debe ser un color hexadecimal válido (ej: #f0f9ff)"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      toast({
        title: "Error de validación",
        description: "Por favor, corrige los errores en el formulario.",
        variant: "destructive",
      })
      return
    }

    try {
      await onSave(formData)
      toast({
        title: "Configuración guardada",
        description: "La configuración se ha guardado exitosamente.",
      })
    } catch (error) {
      console.error("Error saving config:", error)
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración.",
        variant: "destructive",
      })
    }
  }

  const updateFormData = (field: keyof WhatsAppConfig, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Limpiar error del campo si existe
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="widget">Widget</TabsTrigger>
          <TabsTrigger value="advanced">Avanzado</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuración General</CardTitle>
              <CardDescription>Configuración básica de la instancia de WhatsApp</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="displayName">Nombre de la Configuración *</Label>
                  <Input
                    id="displayName"
                    value={formData.displayName || ""}
                    onChange={(e) => updateFormData("displayName", e.target.value)}
                    placeholder="Ej: WhatsApp Clínica Central"
                    className={errors.displayName ? "border-red-500" : ""}
                  />
                  {errors.displayName && <p className="text-sm text-red-500">{errors.displayName}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cliente_id">Cliente ID *</Label>
                  <Input
                    id="cliente_id"
                    value={formData.cliente_id || ""}
                    onChange={(e) => updateFormData("cliente_id", e.target.value)}
                    placeholder="a9454478-89c1-11e3-a751-081012379997"
                    className={errors.cliente_id ? "border-red-500" : ""}
                  />
                  {errors.cliente_id && <p className="text-sm text-red-500">{errors.cliente_id}</p>}
                  <p className="text-sm text-muted-foreground">
                    ID único del cliente para identificar la configuración
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalationPhoneNumber">Número de Derivación</Label>
                <Input
                  id="escalationPhoneNumber"
                  value={formData.escalationPhoneNumber || ""}
                  onChange={(e) => updateFormData("escalationPhoneNumber", e.target.value)}
                  placeholder="+54 9 11 1234-5678"
                />
                <p className="text-sm text-muted-foreground">
                  Número de teléfono para derivar cuando el chatbot no pueda responder
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="active"
                  checked={formData.active || false}
                  onCheckedChange={(checked) => updateFormData("active", checked)}
                />
                <Label htmlFor="active">Configuración activa</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuración de WhatsApp</CardTitle>
              <CardDescription>Configuración específica para la integración con WhatsApp Business API</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
                  <Input
                    id="phoneNumberId"
                    value={formData.phoneNumberId || ""}
                    onChange={(e) => updateFormData("phoneNumberId", e.target.value)}
                    placeholder="123456789012345"
                    className={errors.phoneNumberId ? "border-red-500" : ""}
                  />
                  {errors.phoneNumberId && <p className="text-sm text-red-500">{errors.phoneNumberId}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wabaId">WABA ID</Label>
                  <Input
                    id="wabaId"
                    value={formData.wabaId || ""}
                    onChange={(e) => updateFormData("wabaId", e.target.value)}
                    placeholder="123456789012345"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsappAssistantId">Assistant ID para WhatsApp *</Label>
                <Input
                  id="whatsappAssistantId"
                  value={formData.whatsappAssistantId || ""}
                  onChange={(e) => updateFormData("whatsappAssistantId", e.target.value)}
                  placeholder="asst_..."
                  className={errors.whatsappAssistantId ? "border-red-500" : ""}
                />
                {errors.whatsappAssistantId && <p className="text-sm text-red-500">{errors.whatsappAssistantId}</p>}
                <p className="text-sm text-muted-foreground">ID del asistente de OpenAI que se usará para WhatsApp</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accessToken">Access Token</Label>
                <Input
                  id="accessToken"
                  type="password"
                  value={formData.accessToken || ""}
                  onChange={(e) => updateFormData("accessToken", e.target.value)}
                  placeholder="Token de acceso de WhatsApp"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="verifyToken">Verify Token</Label>
                <Input
                  id="verifyToken"
                  value={formData.verifyToken || ""}
                  onChange={(e) => updateFormData("verifyToken", e.target.value)}
                  placeholder="Token de verificación del webhook"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  value={formData.webhookUrl || ""}
                  onChange={(e) => updateFormData("webhookUrl", e.target.value)}
                  placeholder="https://tu-dominio.com/api/webhook"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="widget" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuración del Widget</CardTitle>
              <CardDescription>Personaliza la apariencia y comportamiento del widget de chat</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="widgetEnabled"
                  checked={formData.widgetEnabled || false}
                  onCheckedChange={(checked) => updateFormData("widgetEnabled", checked)}
                />
                <Label htmlFor="widgetEnabled">Widget habilitado</Label>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="widgetAssistantId">Assistant ID para Widget *</Label>
                <Input
                  id="widgetAssistantId"
                  value={formData.widgetAssistantId || ""}
                  onChange={(e) => updateFormData("widgetAssistantId", e.target.value)}
                  placeholder="asst_..."
                  className={errors.widgetAssistantId ? "border-red-500" : ""}
                />
                {errors.widgetAssistantId && <p className="text-sm text-red-500">{errors.widgetAssistantId}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetTitle">Título del Widget</Label>
                  <Input
                    id="widgetTitle"
                    value={formData.widgetTitle || ""}
                    onChange={(e) => updateFormData("widgetTitle", e.target.value)}
                    placeholder="Asistente Virtual"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetHeaderText">Texto del Header</Label>
                  <Input
                    id="widgetHeaderText"
                    value={formData.widgetHeaderText || ""}
                    onChange={(e) => updateFormData("widgetHeaderText", e.target.value)}
                    placeholder="Chat de Soporte"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="widgetSubtitle">Subtítulo</Label>
                <Input
                  id="widgetSubtitle"
                  value={formData.widgetSubtitle || ""}
                  onChange={(e) => updateFormData("widgetSubtitle", e.target.value)}
                  placeholder="Estamos aquí para ayudarte"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="widgetWelcomeMessage">Mensaje de Bienvenida</Label>
                <Textarea
                  id="widgetWelcomeMessage"
                  value={formData.widgetWelcomeMessage || ""}
                  onChange={(e) => updateFormData("widgetWelcomeMessage", e.target.value)}
                  placeholder="¡Hola! ¿En qué puedo ayudarte hoy?"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetPlaceholder">Placeholder del Input</Label>
                  <Input
                    id="widgetPlaceholder"
                    value={formData.widgetPlaceholder || ""}
                    onChange={(e) => updateFormData("widgetPlaceholder", e.target.value)}
                    placeholder="Escribe tu mensaje..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetButtonText">Texto del Botón</Label>
                  <Input
                    id="widgetButtonText"
                    value={formData.widgetButtonText || ""}
                    onChange={(e) => updateFormData("widgetButtonText", e.target.value)}
                    placeholder="Enviar"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="widgetFloatingButtonText">Texto del Botón Flotante</Label>
                <Textarea
                  id="widgetFloatingButtonText"
                  value={formData.widgetFloatingButtonText || ""}
                  onChange={(e) => updateFormData("widgetFloatingButtonText", e.target.value)}
                  placeholder="Obtené tu turno con nuestro asistente virtual"
                  rows={2}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="widgetShowFloatingText"
                  checked={formData.widgetShowFloatingText || false}
                  onCheckedChange={(checked) => updateFormData("widgetShowFloatingText", checked)}
                />
                <Label htmlFor="widgetShowFloatingText">Mostrar texto en botón flotante</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Apariencia del Widget</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetPrimaryColor">Color Primario</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="widgetPrimaryColor"
                      value={formData.widgetPrimaryColor || ""}
                      onChange={(e) => updateFormData("widgetPrimaryColor", e.target.value)}
                      placeholder="#0ea5e9"
                      className={errors.widgetPrimaryColor ? "border-red-500" : ""}
                    />
                    <input
                      type="color"
                      value={formData.widgetPrimaryColor || "#0ea5e9"}
                      onChange={(e) => updateFormData("widgetPrimaryColor", e.target.value)}
                      className="w-12 h-10 border rounded"
                    />
                  </div>
                  {errors.widgetPrimaryColor && <p className="text-sm text-red-500">{errors.widgetPrimaryColor}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetSecondaryColor">Color Secundario</Label>
                  <div className="flex space-x-2">
                    <Input
                      id="widgetSecondaryColor"
                      value={formData.widgetSecondaryColor || ""}
                      onChange={(e) => updateFormData("widgetSecondaryColor", e.target.value)}
                      placeholder="#f0f9ff"
                      className={errors.widgetSecondaryColor ? "border-red-500" : ""}
                    />
                    <input
                      type="color"
                      value={formData.widgetSecondaryColor || "#f0f9ff"}
                      onChange={(e) => updateFormData("widgetSecondaryColor", e.target.value)}
                      className="w-12 h-10 border rounded"
                    />
                  </div>
                  {errors.widgetSecondaryColor && <p className="text-sm text-red-500">{errors.widgetSecondaryColor}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetPosition">Posición</Label>
                  <Select
                    value={formData.widgetPosition || "bottom-right"}
                    onValueChange={(value) => updateFormData("widgetPosition", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bottom-right">Abajo Derecha</SelectItem>
                      <SelectItem value="bottom-left">Abajo Izquierda</SelectItem>
                      <SelectItem value="top-right">Arriba Derecha</SelectItem>
                      <SelectItem value="top-left">Arriba Izquierda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetTheme">Tema</Label>
                  <Select
                    value={formData.widgetTheme || "light"}
                    onValueChange={(value) => updateFormData("widgetTheme", value)}
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

                <div className="space-y-2">
                  <Label htmlFor="widgetBorderRadius">Border Radius</Label>
                  <Input
                    id="widgetBorderRadius"
                    type="number"
                    value={formData.widgetBorderRadius || 12}
                    onChange={(e) => updateFormData("widgetBorderRadius", Number.parseInt(e.target.value))}
                    min="0"
                    max="50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="widgetMaxWidth">Ancho Máximo (px)</Label>
                  <Input
                    id="widgetMaxWidth"
                    type="number"
                    value={formData.widgetMaxWidth || 400}
                    onChange={(e) => updateFormData("widgetMaxWidth", Number.parseInt(e.target.value))}
                    min="300"
                    max="800"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="widgetMaxHeight">Alto Máximo (px)</Label>
                  <Input
                    id="widgetMaxHeight"
                    type="number"
                    value={formData.widgetMaxHeight || 600}
                    onChange={(e) => updateFormData("widgetMaxHeight", Number.parseInt(e.target.value))}
                    min="400"
                    max="800"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetShadow"
                    checked={formData.widgetShadow || false}
                    onCheckedChange={(checked) => updateFormData("widgetShadow", checked)}
                  />
                  <Label htmlFor="widgetShadow">Sombra</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetAnimation"
                    checked={formData.widgetAnimation || false}
                    onCheckedChange={(checked) => updateFormData("widgetAnimation", checked)}
                  />
                  <Label htmlFor="widgetAnimation">Animaciones</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="widgetSoundEnabled"
                    checked={formData.widgetSoundEnabled || false}
                    onCheckedChange={(checked) => updateFormData("widgetSoundEnabled", checked)}
                  />
                  <Label htmlFor="widgetSoundEnabled">Sonidos</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="widgetBrandingEnabled"
                  checked={formData.widgetBrandingEnabled || false}
                  onCheckedChange={(checked) => updateFormData("widgetBrandingEnabled", checked)}
                />
                <Label htmlFor="widgetBrandingEnabled">Mostrar branding</Label>
              </div>

              {formData.widgetBrandingEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="widgetBrandingText">Texto del Branding</Label>
                  <Input
                    id="widgetBrandingText"
                    value={formData.widgetBrandingText || ""}
                    onChange={(e) => updateFormData("widgetBrandingText", e.target.value)}
                    placeholder="Powered by AI"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuración Avanzada</CardTitle>
              <CardDescription>Configuraciones técnicas y de desarrollo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="proxy">Proxy URL</Label>
                <Input
                  id="proxy"
                  value={formData.proxy || ""}
                  onChange={(e) => updateFormData("proxy", e.target.value)}
                  placeholder="https://proxy.ejemplo.com"
                />
                <p className="text-sm text-muted-foreground">URL del proxy para las llamadas a la API (opcional)</p>
              </div>

              {config && (
                <Alert>
                  <AlertDescription>
                    <div className="space-y-2">
                      <p>
                        <strong>ID:</strong> <Badge variant="outline">{config.id}</Badge>
                      </p>
                      <p>
                        <strong>Creado:</strong>{" "}
                        {config.createdAt ? new Date(config.createdAt).toLocaleString() : "N/A"}
                      </p>
                      <p>
                        <strong>Actualizado:</strong>{" "}
                        {config.updatedAt ? new Date(config.updatedAt).toLocaleString() : "N/A"}
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Guardar Configuración"}
        </Button>
      </div>
    </form>
  )
}
