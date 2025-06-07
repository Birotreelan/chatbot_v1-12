"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function WhatsAppConfigForm({ config, isNew = false }) {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    id: config?.id || "",
    displayName: config?.displayName || "",
    phoneNumberId: config?.phoneNumberId || "",
    wabaId: config?.wabaId || "",
    assistantId: config?.assistantId || process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
    active: config?.active !== undefined ? config.active : true,
    verifyToken: config?.verifyToken || "",
    accessToken: config?.accessToken || "",
    webhookUrl: config?.webhookUrl || "",
    cliente_id: config?.cliente_id || "",
    proxy: config?.proxy || "",
    // Configuraciones del widget
    widgetEnabled: config?.widgetEnabled !== undefined ? config.widgetEnabled : true,
    widgetTitle: config?.widgetTitle || "",
    widgetPrimaryColor: config?.widgetPrimaryColor || "#0ea5e9",
    widgetSecondaryColor: config?.widgetSecondaryColor || "#f0f9ff",
    widgetPosition: config?.widgetPosition || "bottom-right",
    widgetWelcomeMessage: config?.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
  })

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === "checkbox" ? checked : value,
    })
  }

  const handleSwitchChange = (name, checked) => {
    setFormData({
      ...formData,
      [name]: checked,
    })
  }

  const handleRadioChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const endpoint = isNew ? "/api/dashboard/configs" : `/api/dashboard/configs/update`

      const response = await fetch(endpoint, {
        method: isNew ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(error || "Error al guardar la configuración")
      }

      toast({
        title: "Configuración guardada",
        description: "La configuración se ha guardado correctamente.",
      })

      if (isNew) {
        const data = await response.json()
        router.push(`/dashboard/config/${data.id}`)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error("Error:", error)
      toast({
        title: "Error",
        description: error.message || "Error al guardar la configuración",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="widget">Widget Web</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="displayName">Nombre</Label>
              <Input
                id="displayName"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assistantId">ID del Asistente</Label>
              <Input
                id="assistantId"
                name="assistantId"
                value={formData.assistantId}
                onChange={handleChange}
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => handleSwitchChange("active", checked)}
              />
              <Label htmlFor="active">Activo</Label>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="phoneNumberId">ID del Número de Teléfono</Label>
              <Input
                id="phoneNumberId"
                name="phoneNumberId"
                value={formData.phoneNumberId}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="wabaId">ID de WhatsApp Business Account (opcional)</Label>
              <Input id="wabaId" name="wabaId" value={formData.wabaId} onChange={handleChange} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="verifyToken">Token de Verificación</Label>
              <Input
                id="verifyToken"
                name="verifyToken"
                value={formData.verifyToken}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="accessToken">Token de Acceso</Label>
              <Input
                id="accessToken"
                name="accessToken"
                value={formData.accessToken}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="webhookUrl">URL del Webhook (opcional)</Label>
              <Input id="webhookUrl" name="webhookUrl" value={formData.webhookUrl} onChange={handleChange} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="api" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cliente_id">ID de Cliente</Label>
              <Input id="cliente_id" name="cliente_id" value={formData.cliente_id} onChange={handleChange} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proxy">URL del Proxy</Label>
              <Input id="proxy" name="proxy" value={formData.proxy} onChange={handleChange} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="widget" className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="widgetEnabled"
                checked={formData.widgetEnabled}
                onCheckedChange={(checked) => handleSwitchChange("widgetEnabled", checked)}
              />
              <Label htmlFor="widgetEnabled">Habilitar Widget Web</Label>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="widgetTitle">Título del Widget</Label>
              <Input
                id="widgetTitle"
                name="widgetTitle"
                value={formData.widgetTitle}
                onChange={handleChange}
                placeholder="Asistente Virtual"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="widgetPrimaryColor">Color Primario</Label>
              <div className="flex gap-2">
                <Input
                  id="widgetPrimaryColor"
                  name="widgetPrimaryColor"
                  type="color"
                  value={formData.widgetPrimaryColor}
                  onChange={handleChange}
                  className="w-12 h-10 p-1"
                />
                <Input
                  type="text"
                  value={formData.widgetPrimaryColor}
                  onChange={(e) =>
                    handleChange({
                      target: { name: "widgetPrimaryColor", value: e.target.value, type: "text" },
                    })
                  }
                  className="flex-1"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="widgetSecondaryColor">Color Secundario</Label>
              <div className="flex gap-2">
                <Input
                  id="widgetSecondaryColor"
                  name="widgetSecondaryColor"
                  type="color"
                  value={formData.widgetSecondaryColor}
                  onChange={handleChange}
                  className="w-12 h-10 p-1"
                />
                <Input
                  type="text"
                  value={formData.widgetSecondaryColor}
                  onChange={(e) =>
                    handleChange({
                      target: { name: "widgetSecondaryColor", value: e.target.value, type: "text" },
                    })
                  }
                  className="flex-1"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Posición del Widget</Label>
              <RadioGroup
                value={formData.widgetPosition}
                onValueChange={(value) => handleRadioChange("widgetPosition", value)}
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

            <div className="grid gap-2">
              <Label htmlFor="widgetWelcomeMessage">Mensaje de Bienvenida</Label>
              <Input
                id="widgetWelcomeMessage"
                name="widgetWelcomeMessage"
                value={formData.widgetWelcomeMessage}
                onChange={handleChange}
                placeholder="¡Hola! ¿En qué puedo ayudarte hoy?"
              />
            </div>

            {!isNew && config?.id && (
              <div className="mt-4 p-4 bg-gray-50 rounded-md border">
                <h3 className="font-medium mb-2">Enlaces del Widget</h3>
                <div className="space-y-2">
                  <div>
                    <Label className="text-sm">URL para embeber:</Label>
                    <code className="block p-2 bg-gray-100 rounded text-sm mt-1 overflow-x-auto">
                      {`${window.location.origin}/widget/${config.id}`}
                    </code>
                  </div>
                  <div>
                    <Label className="text-sm">Página de demostración:</Label>
                    <code className="block p-2 bg-gray-100 rounded text-sm mt-1 overflow-x-auto">
                      {`${window.location.origin}/chat/${config.id}`}
                    </code>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Guardar"}
        </Button>
      </div>
    </form>
  )
}
