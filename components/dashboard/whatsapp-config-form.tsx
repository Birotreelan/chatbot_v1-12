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
import type { WhatsAppConfig, AdditionalAssistant } from "@/lib/types"
import { Plus, Trash2, Info, Users, Bot } from "lucide-react"
import { ScheduleConfigurator } from "./schedule-configurator"
import { WhatsAppTemplates } from "./whatsapp-templates"

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
    alias: "",
    phoneNumberId: "",
    whatsappNumber: "",
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
    additionalAssistants: [],
    businessHours: [],
    whatsappSupportHours: [],
    timezone: "America/Argentina/Buenos_Aires",
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
    enableSearchByProfessional: true,
    enableSearchBySpecialty: true,
    enableSearchByAnyDoctor: true,
    ...config,
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [humanSupportFlags, setHumanSupportFlags] = useState({
    humanSupport: false,
    humanSupportOfferToPatient: false,
  })
  const [flagsLoading, setFlagsLoading] = useState(false)
  const [flagsSaving, setFlagsSaving] = useState(false)

  useEffect(() => {
    if (config) {
      setFormData((prev) => ({
        ...prev,
        ...config,
      }))
    }
  }, [config])

  // Cargar feature flags del cliente cuando hay un config guardado
  useEffect(() => {
    if (!config?.id) return
    setFlagsLoading(true)
    fetch(`/api/dashboard/feature-flags/${config.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.flags) {
          setHumanSupportFlags({
            humanSupport: !!data.flags.humanSupport,
            humanSupportOfferToPatient: !!data.flags.humanSupportOfferToPatient,
          })
        }
      })
      .catch(console.error)
      .finally(() => setFlagsLoading(false))
  }, [config?.id])

  const saveHumanSupportFlag = async (key: string, value: boolean) => {
    if (!config?.id) return
    setFlagsSaving(true)
    try {
      await fetch(`/api/dashboard/feature-flags/${config.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags: { [key]: value } }),
      })
      setHumanSupportFlags((prev) => ({ ...prev, [key]: value }))
    } catch (err) {
      toast({ title: "Error", description: "No se pudo guardar la configuración.", variant: "destructive" })
    } finally {
      setFlagsSaving(false)
    }
  }

  const addAdditionalAssistant = () => {
    const newAssistant: AdditionalAssistant = {
      functionName: "",
      assistantId: "",
      description: "",
    }
    setFormData((prev) => ({
      ...prev,
      additionalAssistants: [...(prev.additionalAssistants || []), newAssistant],
    }))
  }

  const updateAdditionalAssistant = (index: number, field: keyof AdditionalAssistant, value: string) => {
    setFormData((prev) => {
      const updated = [...(prev.additionalAssistants || [])]
      updated[index] = { ...updated[index], [field]: value }
      return { ...prev, additionalAssistants: updated }
    })
  }

  const removeAdditionalAssistant = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      additionalAssistants: (prev.additionalAssistants || []).filter((_, i) => i !== index),
    }))
  }

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

    if (formData.additionalAssistants && formData.additionalAssistants.length > 0) {
      formData.additionalAssistants.forEach((assistant, index) => {
        if (!assistant.functionName.trim()) {
          newErrors[`additionalAssistant_${index}_functionName`] = "El nombre de función es requerido"
        }
        if (!assistant.assistantId.trim()) {
          newErrors[`additionalAssistant_${index}_assistantId`] = "El Assistant ID es requerido"
        }
        // Validate assistant ID format
        if (assistant.assistantId.trim() && !assistant.assistantId.startsWith("asst_")) {
          newErrors[`additionalAssistant_${index}_assistantId`] = "El ID debe comenzar con 'asst_'"
        }
      })
    }

    // Validar colores hex
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    if (formData.widgetPrimaryColor && !hexColorRegex.test(formData.widgetPrimaryColor)) {
      newErrors.widgetPrimaryColor = "Debe ser un color hexadecimal válido (ej: #0ea5e9)"
    }

    if (formData.widgetSecondaryColor && !hexColorRegex.test(formData.widgetSecondaryColor)) {
      newErrors.widgetSecondaryColor = "Debe ser un color hexadecimal válido (ej: #f0f9ff)"
    }

    // Validar que al menos una opción de búsqueda esté habilitada
    const hasAnySearchOption = 
      formData.enableSearchByProfessional !== false ||
      formData.enableSearchBySpecialty !== false ||
      formData.enableSearchByAnyDoctor !== false

    if (!hasAnySearchOption) {
      newErrors.searchOptions = "Debe habilitar al menos una opción de búsqueda de turnos"
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="widget">Widget</TabsTrigger>
          <TabsTrigger value="support">Atención</TabsTrigger>
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
                  <Label htmlFor="alias">Alias</Label>
                  <Input
                    id="alias"
                    value={formData.alias || ""}
                    onChange={(e) => updateFormData("alias", e.target.value)}
                    placeholder="Ej: Clínica Central (uso interno)"
                  />
                  <p className="text-sm text-muted-foreground">
                    Nombre interno para identificar al cliente en el dashboard
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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

              <Separator className="my-4" />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">Opciones de Búsqueda de Turnos</Label>
                    <p className="text-sm text-muted-foreground">
                      Selecciona qué opciones de búsqueda se mostrarán a los pacientes. Al menos una debe estar habilitada.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pl-0">
                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Switch
                      id="enableSearchByProfessional"
                      checked={formData.enableSearchByProfessional !== false}
                      onCheckedChange={(checked) => updateFormData("enableSearchByProfessional", checked)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="enableSearchByProfessional" className="text-sm font-medium">
                        Médico en particular
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Permite buscar por nombre específico del profesional
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Switch
                      id="enableSearchBySpecialty"
                      checked={formData.enableSearchBySpecialty !== false}
                      onCheckedChange={(checked) => updateFormData("enableSearchBySpecialty", checked)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="enableSearchBySpecialty" className="text-sm font-medium">
                        Por especialidad
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Permite elegir una especialidad y ver profesionales disponibles
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/30">
                    <Switch
                      id="enableSearchByAnyDoctor"
                      checked={formData.enableSearchByAnyDoctor !== false}
                      onCheckedChange={(checked) => updateFormData("enableSearchByAnyDoctor", checked)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="enableSearchByAnyDoctor" className="text-sm font-medium">
                        Cualquier médico disponible
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Muestra los próximos turnos disponibles sin importar el profesional
                      </p>
                    </div>
                  </div>
                </div>

                {errors.searchOptions && (
                  <Alert className="border-red-500 bg-red-50">
                    <AlertDescription className="text-red-700">{errors.searchOptions}</AlertDescription>
                  </Alert>
                )}
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

          <Card>
            <CardHeader>
              <CardTitle>Horarios de Atención al Público</CardTitle>
              <CardDescription>
                Configure los horarios en que la clínica está abierta para recibir pacientes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="timezone">Zona Horaria</Label>
                <Select
                  value={formData.timezone || "America/Argentina/Buenos_Aires"}
                  onValueChange={(value) => updateFormData("timezone", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Argentina/Buenos_Aires">Buenos Aires (GMT-3)</SelectItem>
                    <SelectItem value="America/Montevideo">Montevideo (GMT-3)</SelectItem>
                    <SelectItem value="America/Santiago">Santiago (GMT-3)</SelectItem>
                    <SelectItem value="America/Sao_Paulo">São Paulo (GMT-3)</SelectItem>
                    <SelectItem value="America/Lima">Lima (GMT-5)</SelectItem>
                    <SelectItem value="America/Bogota">Bogotá (GMT-5)</SelectItem>
                    <SelectItem value="America/Mexico_City">Ciudad de México (GMT-6)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator className="my-4" />

              <ScheduleConfigurator
                schedule={formData.businessHours || []}
                onChange={(schedule) => updateFormData("businessHours", schedule)}
                description="Configure los días y horarios de atención. Puede agregar múltiples períodos por día para pausas (ej: 8-12 y 16-20)."
              />
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
                  <Label htmlFor="whatsappNumber">Número de WhatsApp</Label>
                  <Input
                    id="whatsappNumber"
                    value={formData.whatsappNumber || ""}
                    onChange={(e) => updateFormData("whatsappNumber", e.target.value)}
                    placeholder="+54 9 11 1234-5678"
                  />
                  <p className="text-sm text-muted-foreground">
                    Número de teléfono de WhatsApp asociado a esta configuración
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
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

              <Separator className="my-6" />

              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <Label className="text-base font-semibold">Asistentes Adicionales</Label>
                    <p className="text-sm text-muted-foreground">
                      Configura asistentes adicionales que pueden ser invocados mediante function calling
                    </p>
                  </div>
                  <Button type="button" onClick={addAdditionalAssistant} size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    Agregar Asistente
                  </Button>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Ejemplo: El asistente principal puede llamar a la función <code>route_to_reagendamiento</code> y el
                    sistema automáticamente switcheará al asistente configurado con ese nombre de función.
                  </AlertDescription>
                </Alert>

                {formData.additionalAssistants && formData.additionalAssistants.length > 0 ? (
                  <div className="space-y-4">
                    {formData.additionalAssistants.map((assistant, index) => (
                      <Card key={index} className="relative">
                        <CardContent className="pt-6">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute top-2 right-2"
                            onClick={() => removeAdditionalAssistant(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>

                          <div className="grid gap-4">
                            <div className="space-y-2">
                              <Label htmlFor={`functionName_${index}`}>
                                Nombre de Función *
                                <span className="text-xs text-muted-foreground ml-2">
                                  (ej: route_to_reagendamiento)
                                </span>
                              </Label>
                              <Input
                                id={`functionName_${index}`}
                                value={assistant.functionName}
                                onChange={(e) => updateAdditionalAssistant(index, "functionName", e.target.value)}
                                placeholder="route_to_reagendamiento"
                                className={errors[`additionalAssistant_${index}_functionName`] ? "border-red-500" : ""}
                              />
                              {errors[`additionalAssistant_${index}_functionName`] && (
                                <p className="text-sm text-red-500">
                                  {errors[`additionalAssistant_${index}_functionName`]}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`assistantId_${index}`}>
                                Assistant ID *
                                <span className="text-xs text-muted-foreground ml-2">
                                  (ej: asst_4cN7IH01SVAp2witTAfhU3So)
                                </span>
                              </Label>
                              <Input
                                id={`assistantId_${index}`}
                                value={assistant.assistantId}
                                onChange={(e) => updateAdditionalAssistant(index, "assistantId", e.target.value)}
                                placeholder="asst_..."
                                className={errors[`additionalAssistant_${index}_assistantId`] ? "border-red-500" : ""}
                              />
                              {errors[`additionalAssistant_${index}_assistantId`] && (
                                <p className="text-sm text-red-500">
                                  {errors[`additionalAssistant_${index}_assistantId`]}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor={`description_${index}`}>
                                Descripción <span className="text-muted-foreground">(opcional)</span>
                              </Label>
                              <Textarea
                                id={`description_${index}`}
                                value={assistant.description || ""}
                                onChange={(e) => updateAdditionalAssistant(index, "description", e.target.value)}
                                placeholder="Asistente especializado en reagendamiento de turnos"
                                rows={2}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No hay asistentes adicionales configurados. Haz clic en "Agregar Asistente" para comenzar.
                  </div>
                )}
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

          <Card>
            <CardHeader>
              <CardTitle>Horarios de Asistencia por WhatsApp</CardTitle>
              <CardDescription>
                Configure los horarios en que el personal puede responder consultas por WhatsApp
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert className="mb-4">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Estos horarios pueden ser diferentes a los de atención al público. Por ejemplo, el personal puede
                  responder WhatsApp antes o después del horario de atención presencial.
                </AlertDescription>
              </Alert>

              <ScheduleConfigurator
                schedule={formData.whatsappSupportHours || []}
                onChange={(schedule) => updateFormData("whatsappSupportHours", schedule)}
                description="Configure los días y horarios en que el personal puede atender consultas por WhatsApp."
              />
            </CardContent>
          </Card>

          {/* Seccion de Plantillas - Solo mostrar si hay config guardada con wabaId */}
          {config && config.wabaId && (
            <WhatsAppTemplates config={config} />
          )}

          {/* Mensaje si no hay wabaId configurado */}
          {config && !config.wabaId && (
            <Card>
              <CardHeader>
                <CardTitle>Plantillas de WhatsApp</CardTitle>
                <CardDescription>Gestiona las plantillas de mensajes de tu cuenta de WhatsApp Business</CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Para gestionar plantillas, primero debes configurar el <strong>WABA ID</strong> en los campos de arriba y guardar la configuracion.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          {/* Mensaje si es una nueva configuracion */}
          {!config && (
            <Card>
              <CardHeader>
                <CardTitle>Plantillas de WhatsApp</CardTitle>
                <CardDescription>Gestiona las plantillas de mensajes de tu cuenta de WhatsApp Business</CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Guarda esta configuracion primero para poder gestionar las plantillas de WhatsApp.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}
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

        <TabsContent value="support" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Atención al Paciente
              </CardTitle>
              <CardDescription>
                Configura la funcionalidad de atención humana para este cliente. Los agentes podrán monitorear
                conversaciones e intervenir cuando sea necesario.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!config ? (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Guardá esta configuración primero para poder gestionar las opciones de atención al paciente.
                  </AlertDescription>
                </Alert>
              ) : flagsLoading ? (
                <p className="text-sm text-muted-foreground">Cargando configuración...</p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="humanSupport" className="text-base font-medium cursor-pointer">
                          Soporte Humano
                        </Label>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Habilita que los agentes puedan intervenir manualmente en conversaciones, pausar la IA y
                        chatear directamente con el paciente.
                      </p>
                    </div>
                    <Switch
                      id="humanSupport"
                      checked={humanSupportFlags.humanSupport}
                      disabled={flagsSaving}
                      onCheckedChange={(checked) => saveHumanSupportFlag("humanSupport", checked)}
                    />
                  </div>

                  <div className={`flex items-center justify-between rounded-lg border p-4 transition-opacity ${!humanSupportFlags.humanSupport ? "opacity-50 pointer-events-none" : ""}`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="humanSupportOfferToPatient" className="text-base font-medium cursor-pointer">
                          Ofrecer al Paciente
                        </Label>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Cuando el chatbot no pueda responder una consulta, le ofrece automáticamente al paciente la
                        opción de ser atendido por un humano.
                      </p>
                    </div>
                    <Switch
                      id="humanSupportOfferToPatient"
                      checked={humanSupportFlags.humanSupportOfferToPatient}
                      disabled={flagsSaving || !humanSupportFlags.humanSupport}
                      onCheckedChange={(checked) => saveHumanSupportFlag("humanSupportOfferToPatient", checked)}
                    />
                  </div>

                  {flagsSaving && (
                    <p className="text-sm text-muted-foreground text-right">Guardando...</p>
                  )}

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="space-y-1">
                      <p>
                        <strong>Modo A</strong> (ambos OFF): Solo monitoreo. Los agentes ven las conversaciones
                        pero no pueden intervenir.
                      </p>
                      <p>
                        <strong>Modo B</strong> (Soporte ON, Ofrecer OFF): Los agentes pueden intervenir
                        manualmente, pero el bot no le ofrece esta opción al paciente.
                      </p>
                      <p>
                        <strong>Modo C</strong> (ambos ON): Intervención manual + oferta automática al paciente
                        cuando el bot no puede responder.
                      </p>
                    </AlertDescription>
                  </Alert>
                </>
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
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Guardando..." : "Guardar Configuración"}
        </Button>
      </div>
    </form>
  )
}
