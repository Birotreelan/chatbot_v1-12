"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Plus, Edit, Trash2, Eye, Save, X } from "lucide-react"
import type { ClientPromptConfig } from "@/lib/system-prompts"

interface PromptPreview {
  basePrompt: string
  channelPrompt: string
  clientPrompt: string
  fullPrompt: string
}

export default function PromptsPage() {
  const [configs, setConfigs] = useState<ClientPromptConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editingConfig, setEditingConfig] = useState<ClientPromptConfig | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewChannel, setPreviewChannel] = useState<"whatsapp" | "widget">("whatsapp")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Formulario
  const [formData, setFormData] = useState({
    clienteId: "",
    companyName: "",
    businessType: "",
    customInstructions: "",
    whatsappSpecific: "",
    widgetSpecific: "",
    active: true,
  })

  useEffect(() => {
    loadConfigs()
  }, [])

  const loadConfigs = async () => {
    try {
      const response = await fetch("/api/dashboard/prompts")
      if (response.ok) {
        const data = await response.json()
        setConfigs(data.configs)
      }
    } catch (error) {
      console.error("Error cargando configuraciones:", error)
      showMessage("error", "Error cargando configuraciones")
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const resetForm = () => {
    setFormData({
      clienteId: "",
      companyName: "",
      businessType: "",
      customInstructions: "",
      whatsappSpecific: "",
      widgetSpecific: "",
      active: true,
    })
    setEditingConfig(null)
    setIsCreating(false)
    setPreview(null)
  }

  const handleEdit = (config: ClientPromptConfig) => {
    setFormData({
      clienteId: config.clienteId,
      companyName: config.companyName,
      businessType: config.businessType,
      customInstructions: config.customInstructions,
      whatsappSpecific: config.whatsappSpecific || "",
      widgetSpecific: config.widgetSpecific || "",
      active: config.active,
    })
    setEditingConfig(config)
    setIsCreating(false)
  }

  const handleCreate = () => {
    resetForm()
    setIsCreating(true)
  }

  const handleSave = async () => {
    try {
      const method = editingConfig ? "PUT" : "POST"
      const response = await fetch("/api/dashboard/prompts", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        showMessage("success", editingConfig ? "Configuración actualizada" : "Configuración creada")
        resetForm()
        loadConfigs()
      } else {
        const error = await response.json()
        showMessage("error", error.error || "Error guardando configuración")
      }
    } catch (error) {
      console.error("Error guardando:", error)
      showMessage("error", "Error guardando configuración")
    }
  }

  const handleDelete = async (clienteId: string) => {
    if (!confirm("¿Estás seguro de que quieres eliminar esta configuración?")) return

    try {
      const response = await fetch(`/api/dashboard/prompts?clienteId=${clienteId}`, {
        method: "DELETE",
      })

      if (response.ok) {
        showMessage("success", "Configuración eliminada")
        loadConfigs()
      } else {
        showMessage("error", "Error eliminando configuración")
      }
    } catch (error) {
      console.error("Error eliminando:", error)
      showMessage("error", "Error eliminando configuración")
    }
  }

  const handlePreview = async (clienteId: string, channel: "whatsapp" | "widget" = "whatsapp") => {
    try {
      const response = await fetch(`/api/dashboard/prompts/preview?clienteId=${clienteId}&channel=${channel}`)
      if (response.ok) {
        const data = await response.json()
        setPreview(data.preview)
        setPreviewChannel(channel)
      } else {
        showMessage("error", "Error generando preview")
      }
    } catch (error) {
      console.error("Error generando preview:", error)
      showMessage("error", "Error generando preview")
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">Cargando configuraciones...</div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Gestión de System Prompts</h1>
          <p className="text-muted-foreground">Configura prompts personalizados por cliente y canal</p>
        </div>
        <Button onClick={handleCreate} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nueva Configuración
        </Button>
      </div>

      {message && (
        <Alert className={message.type === "error" ? "border-red-500" : "border-green-500"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lista de configuraciones */}
        <Card>
          <CardHeader>
            <CardTitle>Configuraciones Existentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {configs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No hay configuraciones creadas</p>
            ) : (
              configs.map((config) => (
                <div key={config.clienteId} className="border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold">{config.companyName}</h3>
                      <p className="text-sm text-muted-foreground">Cliente ID: {config.clienteId}</p>
                      <p className="text-sm text-muted-foreground">Tipo: {config.businessType}</p>
                    </div>
                    <Badge variant={config.active ? "default" : "secondary"}>
                      {config.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(config)}
                      className="flex items-center gap-1"
                    >
                      <Edit className="h-3 w-3" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreview(config.clienteId, "whatsapp")}
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(config.clienteId)}
                      className="flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Formulario de edición/creación */}
        {(isCreating || editingConfig) && (
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{editingConfig ? "Editar Configuración" : "Nueva Configuración"}</CardTitle>
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="clienteId">Cliente ID</Label>
                  <Input
                    id="clienteId"
                    value={formData.clienteId}
                    onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })}
                    disabled={!!editingConfig}
                    placeholder="ej: cliente_001"
                  />
                </div>
                <div>
                  <Label htmlFor="companyName">Nombre de la Empresa</Label>
                  <Input
                    id="companyName"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="ej: Clínica San Juan"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="businessType">Tipo de Negocio</Label>
                <Input
                  id="businessType"
                  value={formData.businessType}
                  onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                  placeholder="ej: Centro médico, Clínica dental, etc."
                />
              </div>

              <div>
                <Label htmlFor="customInstructions">Instrucciones Personalizadas</Label>
                <Textarea
                  id="customInstructions"
                  value={formData.customInstructions}
                  onChange={(e) => setFormData({ ...formData, customInstructions: e.target.value })}
                  placeholder="Instrucciones específicas para este cliente..."
                  rows={4}
                />
              </div>

              <Tabs defaultValue="whatsapp" className="w-full">
                <TabsList>
                  <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
                  <TabsTrigger value="widget">Widget</TabsTrigger>
                </TabsList>

                <TabsContent value="whatsapp" className="space-y-4">
                  <div>
                    <Label htmlFor="whatsappSpecific">Instrucciones Específicas para WhatsApp</Label>
                    <Textarea
                      id="whatsappSpecific"
                      value={formData.whatsappSpecific}
                      onChange={(e) => setFormData({ ...formData, whatsappSpecific: e.target.value })}
                      placeholder="Instrucciones adicionales solo para WhatsApp..."
                      rows={3}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="widget" className="space-y-4">
                  <div>
                    <Label htmlFor="widgetSpecific">Instrucciones Específicas para Widget</Label>
                    <Textarea
                      id="widgetSpecific"
                      value={formData.widgetSpecific}
                      onChange={(e) => setFormData({ ...formData, widgetSpecific: e.target.value })}
                      placeholder="Instrucciones adicionales solo para Widget..."
                      rows={3}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex items-center space-x-2">
                <Switch
                  id="active"
                  checked={formData.active}
                  onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
                />
                <Label htmlFor="active">Configuración activa</Label>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} className="flex items-center gap-2">
                  <Save className="h-4 w-4" />
                  Guardar
                </Button>
                {formData.clienteId && (
                  <Button
                    variant="outline"
                    onClick={() => handlePreview(formData.clienteId, "whatsapp")}
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    Preview
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Preview del prompt */}
        {preview && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Preview del System Prompt</CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={previewChannel === "whatsapp" ? "default" : "outline"}
                    onClick={() =>
                      handlePreview(preview ? configs.find((c) => c.clienteId)?.clienteId || "" : "", "whatsapp")
                    }
                  >
                    WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant={previewChannel === "widget" ? "default" : "outline"}
                    onClick={() =>
                      handlePreview(preview ? configs.find((c) => c.clienteId)?.clienteId || "" : "", "widget")
                    }
                  >
                    Widget
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="full" className="w-full">
                <TabsList>
                  <TabsTrigger value="full">Prompt Completo</TabsTrigger>
                  <TabsTrigger value="base">Base</TabsTrigger>
                  <TabsTrigger value="channel">Canal</TabsTrigger>
                  <TabsTrigger value="client">Cliente</TabsTrigger>
                </TabsList>

                <TabsContent value="full">
                  <div className="bg-muted p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm">{preview.fullPrompt}</pre>
                  </div>
                </TabsContent>

                <TabsContent value="base">
                  <div className="bg-muted p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm">{preview.basePrompt}</pre>
                  </div>
                </TabsContent>

                <TabsContent value="channel">
                  <div className="bg-muted p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm">{preview.channelPrompt}</pre>
                  </div>
                </TabsContent>

                <TabsContent value="client">
                  <div className="bg-muted p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm">
                      {preview.clientPrompt || "Sin personalización específica"}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
