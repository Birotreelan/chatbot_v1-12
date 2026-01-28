"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import {
  Plus,
  Trash2,
  Info,
  Loader2,
  Phone,
  Link,
  MessageSquare,
  Copy,
  Image,
  Video,
  FileText,
  Type,
} from "lucide-react"
import type { WhatsAppConfig } from "@/lib/types"

// Tipos para la plantilla
interface TemplateVariable {
  index: number
  example: string
}

interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW"
  text: string
  url?: string
  phoneNumber?: string
  example?: string[]
  flowId?: string
  flowAction?: string
}

interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS"
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"
  text?: string
  buttons?: TemplateButton[]
  example?: {
    header_text?: string[]
    body_text?: string[][]
    header_handle?: string[]
  }
}

interface TemplateFormData {
  name: string
  language: string
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  // Header
  headerEnabled: boolean
  headerFormat: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "NONE"
  headerText: string
  headerVariables: TemplateVariable[]
  headerMediaHandle: string
  // Body
  bodyText: string
  bodyVariables: TemplateVariable[]
  // Footer
  footerEnabled: boolean
  footerText: string
  // Buttons
  buttonsEnabled: boolean
  buttons: TemplateButton[]
}

interface WhatsAppTemplateCreatorProps {
  config: WhatsAppConfig
  onTemplateCreated: () => void
  onCancel: () => void
}

const LANGUAGES = [
  { code: "es", name: "Espanol" },
  { code: "es_AR", name: "Espanol (Argentina)" },
  { code: "es_MX", name: "Espanol (Mexico)" },
  { code: "es_ES", name: "Espanol (Espana)" },
  { code: "en", name: "English" },
  { code: "en_US", name: "English (US)" },
  { code: "en_GB", name: "English (UK)" },
  { code: "pt_BR", name: "Portugues (Brasil)" },
  { code: "pt_PT", name: "Portugues (Portugal)" },
]

const CATEGORIES = [
  {
    value: "UTILITY",
    label: "Utilidad",
    description: "Confirmaciones, recordatorios, actualizaciones",
  },
  {
    value: "MARKETING",
    label: "Marketing",
    description: "Promociones, ofertas, newsletters",
  },
  {
    value: "AUTHENTICATION",
    label: "Autenticacion",
    description: "Codigos OTP, verificacion",
  },
]

export function WhatsAppTemplateCreator({ config, onTemplateCreated, onCancel }: WhatsAppTemplateCreatorProps) {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [formData, setFormData] = useState<TemplateFormData>({
    name: "",
    language: "es",
    category: "UTILITY",
    // Header
    headerEnabled: false,
    headerFormat: "TEXT",
    headerText: "",
    headerVariables: [],
    headerMediaHandle: "",
    // Body
    bodyText: "",
    bodyVariables: [],
    // Footer
    footerEnabled: false,
    footerText: "",
    // Buttons
    buttonsEnabled: false,
    buttons: [],
  })

  // Extraer variables del texto (formato {{1}}, {{2}}, etc.)
  const extractVariables = (text: string): number[] => {
    const matches = text.match(/\{\{(\d+)\}\}/g)
    if (!matches) return []
    return [...new Set(matches.map((m) => parseInt(m.replace(/[{}]/g, ""))))].sort((a, b) => a - b)
  }

  // Actualizar variables cuando cambia el texto
  const updateVariablesForText = (
    text: string,
    currentVariables: TemplateVariable[],
    setVariables: (vars: TemplateVariable[]) => void
  ) => {
    const varNumbers = extractVariables(text)
    const newVariables: TemplateVariable[] = varNumbers.map((num) => {
      const existing = currentVariables.find((v) => v.index === num)
      return existing || { index: num, example: "" }
    })
    setVariables(newVariables)
  }

  const updateFormData = <K extends keyof TemplateFormData>(field: K, value: TemplateFormData[K]) => {
    setFormData((prev) => {
      const newData = { ...prev, [field]: value }

      // Auto-actualizar variables si es body o header text
      if (field === "bodyText") {
        const varNumbers = extractVariables(value as string)
        newData.bodyVariables = varNumbers.map((num) => {
          const existing = prev.bodyVariables.find((v) => v.index === num)
          return existing || { index: num, example: "" }
        })
      }

      if (field === "headerText") {
        const varNumbers = extractVariables(value as string)
        newData.headerVariables = varNumbers.map((num) => {
          const existing = prev.headerVariables.find((v) => v.index === num)
          return existing || { index: num, example: "" }
        })
      }

      return newData
    })

    // Limpiar error
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }))
    }
  }

  const updateBodyVariable = (index: number, example: string) => {
    setFormData((prev) => ({
      ...prev,
      bodyVariables: prev.bodyVariables.map((v) => (v.index === index ? { ...v, example } : v)),
    }))
  }

  const updateHeaderVariable = (index: number, example: string) => {
    setFormData((prev) => ({
      ...prev,
      headerVariables: prev.headerVariables.map((v) => (v.index === index ? { ...v, example } : v)),
    }))
  }

  // Botones
  const addButton = () => {
    if (formData.buttons.length >= 3) {
      toast({
        title: "Limite alcanzado",
        description: "Solo se pueden agregar hasta 3 botones por plantilla",
        variant: "destructive",
      })
      return
    }
    setFormData((prev) => ({
      ...prev,
      buttons: [...prev.buttons, { type: "QUICK_REPLY", text: "" }],
    }))
  }

  const updateButton = (index: number, updates: Partial<TemplateButton>) => {
    setFormData((prev) => ({
      ...prev,
      buttons: prev.buttons.map((btn, i) => (i === index ? { ...btn, ...updates } : btn)),
    }))
  }

  const removeButton = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }))
  }

  // Validacion
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    // Nombre: solo letras minusculas, numeros y guiones bajos
    if (!formData.name.trim()) {
      newErrors.name = "El nombre es requerido"
    } else if (!/^[a-z0-9_]+$/.test(formData.name)) {
      newErrors.name = "Solo letras minusculas, numeros y guiones bajos"
    } else if (formData.name.length > 512) {
      newErrors.name = "Maximo 512 caracteres"
    }

    // Body es requerido
    if (!formData.bodyText.trim()) {
      newErrors.bodyText = "El cuerpo del mensaje es requerido"
    } else if (formData.bodyText.length > 1024) {
      newErrors.bodyText = "Maximo 1024 caracteres"
    }

    // Validar ejemplos de variables del body
    formData.bodyVariables.forEach((v) => {
      if (!v.example.trim()) {
        newErrors[`bodyVar_${v.index}`] = `Ejemplo requerido para variable {{${v.index}}}`
      }
    })

    // Header
    if (formData.headerEnabled) {
      if (formData.headerFormat === "TEXT") {
        if (!formData.headerText.trim()) {
          newErrors.headerText = "El texto del header es requerido"
        } else if (formData.headerText.length > 60) {
          newErrors.headerText = "Maximo 60 caracteres"
        }
        // Validar ejemplos de variables del header
        formData.headerVariables.forEach((v) => {
          if (!v.example.trim()) {
            newErrors[`headerVar_${v.index}`] = `Ejemplo requerido para variable {{${v.index}}}`
          }
        })
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(formData.headerFormat)) {
        if (!formData.headerMediaHandle.trim()) {
          newErrors.headerMediaHandle = "El handle del media es requerido"
        }
      }
    }

    // Footer
    if (formData.footerEnabled && formData.footerText.length > 60) {
      newErrors.footerText = "Maximo 60 caracteres"
    }

    // Botones
    if (formData.buttonsEnabled) {
      formData.buttons.forEach((btn, i) => {
        if (!btn.text.trim()) {
          newErrors[`button_${i}_text`] = "El texto del boton es requerido"
        } else if (btn.text.length > 25) {
          newErrors[`button_${i}_text`] = "Maximo 25 caracteres"
        }

        if (btn.type === "URL" && !btn.url?.trim()) {
          newErrors[`button_${i}_url`] = "La URL es requerida"
        }

        if (btn.type === "PHONE_NUMBER" && !btn.phoneNumber?.trim()) {
          newErrors[`button_${i}_phone`] = "El numero es requerido"
        }
      })
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Construir el payload para la API de Meta
  const buildTemplatePayload = () => {
    const components: TemplateComponent[] = []

    // Header
    if (formData.headerEnabled && formData.headerFormat !== "NONE") {
      const headerComponent: TemplateComponent = {
        type: "HEADER",
        format: formData.headerFormat,
      }

      if (formData.headerFormat === "TEXT") {
        headerComponent.text = formData.headerText
        if (formData.headerVariables.length > 0) {
          headerComponent.example = {
            header_text: formData.headerVariables.map((v) => v.example),
          }
        }
      } else {
        // Para media, necesitamos el handle
        headerComponent.example = {
          header_handle: [formData.headerMediaHandle],
        }
      }

      components.push(headerComponent)
    }

    // Body (siempre requerido)
    const bodyComponent: TemplateComponent = {
      type: "BODY",
      text: formData.bodyText,
    }

    if (formData.bodyVariables.length > 0) {
      bodyComponent.example = {
        body_text: [formData.bodyVariables.map((v) => v.example)],
      }
    }

    components.push(bodyComponent)

    // Footer
    if (formData.footerEnabled && formData.footerText.trim()) {
      components.push({
        type: "FOOTER",
        text: formData.footerText,
      })
    }

    // Buttons
    if (formData.buttonsEnabled && formData.buttons.length > 0) {
      const buttonsComponent: TemplateComponent = {
        type: "BUTTONS",
        buttons: formData.buttons.map((btn) => {
          const button: TemplateButton = {
            type: btn.type,
            text: btn.text,
          }

          if (btn.type === "URL") {
            button.url = btn.url
            // Si la URL tiene variables, necesitamos ejemplo
            if (btn.url?.includes("{{")) {
              button.example = [btn.example?.[0] || "https://example.com"]
            }
          }

          if (btn.type === "PHONE_NUMBER") {
            button.phoneNumber = btn.phoneNumber
          }

          return button
        }),
      }

      components.push(buttonsComponent)
    }

    return {
      name: formData.name,
      language: formData.language,
      category: formData.category,
      components,
    }
  }

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast({
        title: "Error de validacion",
        description: "Por favor, corrige los errores en el formulario",
        variant: "destructive",
      })
      return
    }

    if (!config.wabaId) {
      toast({
        title: "Error",
        description: "No se ha configurado un WABA ID para este numero",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)

    try {
      const payload = buildTemplatePayload()

      const response = await fetch("/api/whatsapp/templates/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          wabaId: config.wabaId,
          configId: config.id,
          template: payload,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.details?.error?.message || "Error al crear la plantilla")
      }

      toast({
        title: "Plantilla creada",
        description: `La plantilla "${formData.name}" se ha enviado para revision. Estado: PENDING`,
      })

      onTemplateCreated()
    } catch (error) {
      console.error("Error creating template:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al crear la plantilla",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Vista previa
  const renderPreview = () => {
    let headerPreview = formData.headerText
    formData.headerVariables.forEach((v) => {
      headerPreview = headerPreview.replace(`{{${v.index}}}`, v.example || `[Variable ${v.index}]`)
    })

    let bodyPreview = formData.bodyText
    formData.bodyVariables.forEach((v) => {
      bodyPreview = bodyPreview.replace(`{{${v.index}}}`, v.example || `[Variable ${v.index}]`)
    })

    return (
      <div className="bg-[#e5ddd5] rounded-lg p-4 min-h-[300px]">
        <div className="max-w-[280px] bg-white rounded-lg shadow-sm overflow-hidden">
          {/* Header */}
          {formData.headerEnabled && formData.headerFormat !== "NONE" && (
            <div className="p-3 border-b">
              {formData.headerFormat === "TEXT" && (
                <p className="font-semibold text-sm text-gray-900">{headerPreview || "Titulo del mensaje"}</p>
              )}
              {formData.headerFormat === "IMAGE" && (
                <div className="bg-gray-200 h-32 rounded flex items-center justify-center">
                  <Image className="h-8 w-8 text-gray-400" />
                </div>
              )}
              {formData.headerFormat === "VIDEO" && (
                <div className="bg-gray-200 h-32 rounded flex items-center justify-center">
                  <Video className="h-8 w-8 text-gray-400" />
                </div>
              )}
              {formData.headerFormat === "DOCUMENT" && (
                <div className="bg-gray-200 h-20 rounded flex items-center justify-center gap-2">
                  <FileText className="h-6 w-6 text-gray-400" />
                  <span className="text-sm text-gray-500">Documento</span>
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div className="p-3">
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{bodyPreview || "Escribe el cuerpo del mensaje..."}</p>
          </div>

          {/* Footer */}
          {formData.footerEnabled && formData.footerText && (
            <div className="px-3 pb-2">
              <p className="text-xs text-gray-500">{formData.footerText}</p>
            </div>
          )}

          {/* Buttons */}
          {formData.buttonsEnabled && formData.buttons.length > 0 && (
            <div className="border-t">
              {formData.buttons.map((btn, i) => (
                <button
                  key={i}
                  className="w-full py-2 px-3 text-sm text-[#00a884] font-medium border-b last:border-b-0 flex items-center justify-center gap-2 hover:bg-gray-50"
                >
                  {btn.type === "PHONE_NUMBER" && <Phone className="h-4 w-4" />}
                  {btn.type === "URL" && <Link className="h-4 w-4" />}
                  {btn.type === "QUICK_REPLY" && <MessageSquare className="h-4 w-4" />}
                  {btn.type === "COPY_CODE" && <Copy className="h-4 w-4" />}
                  {btn.text || "Texto del boton"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Formulario */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Crear Nueva Plantilla</CardTitle>
            <CardDescription>
              Define los componentes de tu plantilla de mensaje de WhatsApp
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Informacion basica */}
            <div className="space-y-4">
              <h3 className="font-medium">Informacion Basica</h3>

              <div className="space-y-2">
                <Label htmlFor="name">Nombre de la Plantilla *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => updateFormData("name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="confirmacion_turno"
                  className={errors.name ? "border-red-500" : ""}
                />
                {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
                <p className="text-xs text-muted-foreground">Solo letras minusculas, numeros y guiones bajos</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="language">Idioma</Label>
                  <Select value={formData.language} onValueChange={(v) => updateFormData("language", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code}>
                          {lang.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Categoria</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => updateFormData("category", v as TemplateFormData["category"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          <div>
                            <span>{cat.label}</span>
                            <p className="text-xs text-muted-foreground">{cat.description}</p>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Header */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Header (Encabezado)</h3>
                  <p className="text-sm text-muted-foreground">Opcional - Titulo o media</p>
                </div>
                <Switch
                  checked={formData.headerEnabled}
                  onCheckedChange={(v) => updateFormData("headerEnabled", v)}
                />
              </div>

              {formData.headerEnabled && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label>Formato</Label>
                    <Select
                      value={formData.headerFormat}
                      onValueChange={(v) => updateFormData("headerFormat", v as TemplateFormData["headerFormat"])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TEXT">
                          <div className="flex items-center gap-2">
                            <Type className="h-4 w-4" />
                            Texto
                          </div>
                        </SelectItem>
                        <SelectItem value="IMAGE">
                          <div className="flex items-center gap-2">
                            <Image className="h-4 w-4" />
                            Imagen
                          </div>
                        </SelectItem>
                        <SelectItem value="VIDEO">
                          <div className="flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            Video
                          </div>
                        </SelectItem>
                        <SelectItem value="DOCUMENT">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Documento
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.headerFormat === "TEXT" && (
                    <>
                      <div className="space-y-2">
                        <Label>Texto del Header</Label>
                        <Input
                          value={formData.headerText}
                          onChange={(e) => updateFormData("headerText", e.target.value)}
                          placeholder="Recordatorio de turno"
                          className={errors.headerText ? "border-red-500" : ""}
                          maxLength={60}
                        />
                        {errors.headerText && <p className="text-sm text-red-500">{errors.headerText}</p>}
                        <p className="text-xs text-muted-foreground">
                          {formData.headerText.length}/60 caracteres. Usa {"{{1}}"} para variables.
                        </p>
                      </div>

                      {formData.headerVariables.length > 0 && (
                        <div className="space-y-2">
                          <Label>Ejemplos de Variables del Header</Label>
                          {formData.headerVariables.map((v) => (
                            <div key={v.index} className="flex items-center gap-2">
                              <Badge variant="outline">{`{{${v.index}}}`}</Badge>
                              <Input
                                value={v.example}
                                onChange={(e) => updateHeaderVariable(v.index, e.target.value)}
                                placeholder={`Ejemplo para {{${v.index}}}`}
                                className={errors[`headerVar_${v.index}`] ? "border-red-500" : ""}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {["IMAGE", "VIDEO", "DOCUMENT"].includes(formData.headerFormat) && (
                    <div className="space-y-2">
                      <Label>Media Handle</Label>
                      <Input
                        value={formData.headerMediaHandle}
                        onChange={(e) => updateFormData("headerMediaHandle", e.target.value)}
                        placeholder="4::aW1hZ2UvanBlZw==:ARb..."
                        className={errors.headerMediaHandle ? "border-red-500" : ""}
                      />
                      {errors.headerMediaHandle && <p className="text-sm text-red-500">{errors.headerMediaHandle}</p>}
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Primero debes subir el archivo usando la API de Meta y obtener el handle.
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Body */}
            <div className="space-y-4">
              <h3 className="font-medium">Body (Cuerpo) *</h3>

              <div className="space-y-2">
                <Label>Texto del Mensaje</Label>
                <Textarea
                  value={formData.bodyText}
                  onChange={(e) => updateFormData("bodyText", e.target.value)}
                  placeholder="Hola {{1}}, te recordamos tu turno para el dia {{2}} a las {{3}} hs."
                  rows={4}
                  className={errors.bodyText ? "border-red-500" : ""}
                  maxLength={1024}
                />
                {errors.bodyText && <p className="text-sm text-red-500">{errors.bodyText}</p>}
                <p className="text-xs text-muted-foreground">
                  {formData.bodyText.length}/1024 caracteres. Usa {"{{1}}"}, {"{{2}}"}, etc. para variables.
                </p>
              </div>

              {formData.bodyVariables.length > 0 && (
                <div className="space-y-3">
                  <Label>Ejemplos de Variables</Label>
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Meta requiere ejemplos para cada variable. Estos se usan para la revision de la plantilla.
                    </AlertDescription>
                  </Alert>
                  {formData.bodyVariables.map((v) => (
                    <div key={v.index} className="flex items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {`{{${v.index}}}`}
                      </Badge>
                      <Input
                        value={v.example}
                        onChange={(e) => updateBodyVariable(v.index, e.target.value)}
                        placeholder={`Ejemplo: ${v.index === 1 ? "Juan" : v.index === 2 ? "15/03/2024" : "14:30"}`}
                        className={errors[`bodyVar_${v.index}`] ? "border-red-500" : ""}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Footer */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Footer (Pie de mensaje)</h3>
                  <p className="text-sm text-muted-foreground">Opcional - Texto pequeno al final</p>
                </div>
                <Switch
                  checked={formData.footerEnabled}
                  onCheckedChange={(v) => updateFormData("footerEnabled", v)}
                />
              </div>

              {formData.footerEnabled && (
                <div className="space-y-2 pl-4 border-l-2 border-muted">
                  <Input
                    value={formData.footerText}
                    onChange={(e) => updateFormData("footerText", e.target.value)}
                    placeholder="Responde CONFIRMAR o CANCELAR"
                    className={errors.footerText ? "border-red-500" : ""}
                    maxLength={60}
                  />
                  {errors.footerText && <p className="text-sm text-red-500">{errors.footerText}</p>}
                  <p className="text-xs text-muted-foreground">{formData.footerText.length}/60 caracteres</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Buttons */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Botones</h3>
                  <p className="text-sm text-muted-foreground">Opcional - Maximo 3 botones</p>
                </div>
                <Switch
                  checked={formData.buttonsEnabled}
                  onCheckedChange={(v) => updateFormData("buttonsEnabled", v)}
                />
              </div>

              {formData.buttonsEnabled && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  {formData.buttons.map((btn, index) => (
                    <Card key={index} className="relative">
                      <CardContent className="pt-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => removeButton(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label>Tipo de Boton</Label>
                            <Select
                              value={btn.type}
                              onValueChange={(v) => updateButton(index, { type: v as TemplateButton["type"] })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="QUICK_REPLY">
                                  <div className="flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4" />
                                    Respuesta Rapida
                                  </div>
                                </SelectItem>
                                <SelectItem value="URL">
                                  <div className="flex items-center gap-2">
                                    <Link className="h-4 w-4" />
                                    URL
                                  </div>
                                </SelectItem>
                                <SelectItem value="PHONE_NUMBER">
                                  <div className="flex items-center gap-2">
                                    <Phone className="h-4 w-4" />
                                    Llamar
                                  </div>
                                </SelectItem>
                                <SelectItem value="COPY_CODE">
                                  <div className="flex items-center gap-2">
                                    <Copy className="h-4 w-4" />
                                    Copiar Codigo
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label>Texto del Boton</Label>
                            <Input
                              value={btn.text}
                              onChange={(e) => updateButton(index, { text: e.target.value })}
                              placeholder="Confirmar"
                              maxLength={25}
                              className={errors[`button_${index}_text`] ? "border-red-500" : ""}
                            />
                            {errors[`button_${index}_text`] && (
                              <p className="text-sm text-red-500">{errors[`button_${index}_text`]}</p>
                            )}
                          </div>

                          {btn.type === "URL" && (
                            <div className="space-y-2">
                              <Label>URL</Label>
                              <Input
                                value={btn.url || ""}
                                onChange={(e) => updateButton(index, { url: e.target.value })}
                                placeholder="https://ejemplo.com/turno/{{1}}"
                                className={errors[`button_${index}_url`] ? "border-red-500" : ""}
                              />
                              {errors[`button_${index}_url`] && (
                                <p className="text-sm text-red-500">{errors[`button_${index}_url`]}</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                Puedes usar {"{{1}}"} para una variable dinamica al final
                              </p>
                            </div>
                          )}

                          {btn.type === "PHONE_NUMBER" && (
                            <div className="space-y-2">
                              <Label>Numero de Telefono</Label>
                              <Input
                                value={btn.phoneNumber || ""}
                                onChange={(e) => updateButton(index, { phoneNumber: e.target.value })}
                                placeholder="+5491112345678"
                                className={errors[`button_${index}_phone`] ? "border-red-500" : ""}
                              />
                              {errors[`button_${index}_phone`] && (
                                <p className="text-sm text-red-500">{errors[`button_${index}_phone`]}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {formData.buttons.length < 3 && (
                    <Button type="button" variant="outline" size="sm" onClick={addButton}>
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Boton
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Acciones */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creando...
              </>
            ) : (
              "Crear Plantilla"
            )}
          </Button>
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Vista Previa</CardTitle>
            <CardDescription>Asi se vera tu mensaje en WhatsApp</CardDescription>
          </CardHeader>
          <CardContent>{renderPreview()}</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Informacion de la Plantilla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nombre:</span>
              <Badge variant="outline">{formData.name || "-"}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Idioma:</span>
              <Badge variant="outline">{formData.language}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Categoria:</span>
              <Badge variant="outline">{formData.category}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Variables Body:</span>
              <Badge variant="outline">{formData.bodyVariables.length}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Botones:</span>
              <Badge variant="outline">{formData.buttons.length}</Badge>
            </div>
          </CardContent>
        </Card>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Las plantillas deben ser aprobadas por Meta antes de poder usarlas. El proceso puede tomar desde minutos
            hasta 24 horas. Estado inicial: <Badge variant="secondary">PENDING</Badge>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
