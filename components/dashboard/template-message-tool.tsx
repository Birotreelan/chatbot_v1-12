"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WhatsAppTemplates } from "./whatsapp-templates"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { WhatsAppConfig } from "@/lib/types"

interface TemplateComponent {
  type: string
  text?: string
  format?: string
  example?: {
    header_text?: string[]
    body_text?: string[][]
    header_handle?: string[]
  }
}

interface Template {
  id: string
  name: string
  language: string
  status: string
  category: string
  components: TemplateComponent[]
}

interface TemplateMessageToolProps {
  config: WhatsAppConfig
}

export function TemplateMessageTool({ config }: TemplateMessageToolProps) {
  const { toast } = useToast()
  const [phone, setPhone] = useState<string>("")
  const [type, setType] = useState<string>("text")
  const [mensaje, setMensaje] = useState<string>("Mensaje de prueba")
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [templateParams, setTemplateParams] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<any>(null)

  function handleTemplateSelect(template: Template) {
    setSelectedTemplate(template)
    setType("template")
    setLastError(null)

    // Extraer parámetros del template
    const bodyComponent = template.components.find((c) => c.type === "BODY")
    if (bodyComponent?.text) {
      const params = bodyComponent.text.match(/\{\{\d+\}\}/g) || []
      setTemplateParams(new Array(params.length).fill(""))
    }
  }

  function updateTemplateParam(index: number, value: string) {
    const newParams = [...templateParams]
    newParams[index] = value
    setTemplateParams(newParams)
  }

  async function handleSendTemplate() {
    if (!phone) {
      toast({
        title: "Error",
        description: "Se requiere un número de teléfono",
        variant: "destructive",
      })
      return
    }

    if (type === "template" && !selectedTemplate) {
      toast({
        title: "Error",
        description: "Selecciona una plantilla para enviar",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setLastError(null)
    setDebugInfo(null)

    try {
      let params: URLSearchParams

      if (type === "template" && selectedTemplate) {
        // Construir datos de plantilla
        const templateData = {
          name: selectedTemplate.name,
          language: selectedTemplate.language,
          components: [],
        }

        // Agregar componentes con parámetros si los hay
        const bodyComponent = selectedTemplate.components.find((c) => c.type === "BODY")
        if (bodyComponent && templateParams.length > 0 && templateParams.some((p) => p.trim())) {
          templateData.components = [
            {
              type: "BODY",
              parameters: templateParams
                .filter((param) => param.trim())
                .map((param) => ({ type: "text", text: param.trim() })),
            },
          ]
        }

        console.log("Enviando plantilla con datos:", templateData)

        params = new URLSearchParams({
          cliente_id: config.cliente_id || "",
          phone_number_id: config.phoneNumberId,
          phone: phone,
          type: "template",
          template_data: JSON.stringify(templateData),
        })
      } else {
        // Envío de texto simple
        params = new URLSearchParams({
          cliente_id: config.cliente_id || "",
          phone_number_id: config.phoneNumberId,
          phone: phone,
          type: type,
          mensaje: mensaje,
        })
      }

      console.log("Enviando request con parámetros:", params.toString())

      const response = await fetch(`/api/test-template?${params.toString()}`)
      const data = await response.json()

      console.log("Respuesta del servidor:", data)
      setDebugInfo(data)

      if (data.success) {
        toast({
          title: "Mensaje enviado",
          description: `Mensaje enviado correctamente${data.details?.messageId ? ` (ID: ${data.details.messageId})` : ""}`,
        })

        // Limpiar formulario después del envío exitoso
        if (type === "template") {
          setTemplateParams(new Array(templateParams.length).fill(""))
        }
      } else {
        const errorMessage = data.error || "Error desconocido"
        setLastError(errorMessage)

        toast({
          title: "Error al enviar mensaje",
          description: errorMessage,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error en el frontend:", error)
      const errorMessage = error instanceof Error ? error.message : "Error de conexión"
      setLastError(errorMessage)

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  function renderTemplatePreview() {
    if (!selectedTemplate) return null

    const headerComponent = selectedTemplate.components.find((c) => c.type === "HEADER")
    const bodyComponent = selectedTemplate.components.find((c) => c.type === "BODY")
    const footerComponent = selectedTemplate.components.find((c) => c.type === "FOOTER")

    let bodyText = bodyComponent?.text || ""
    templateParams.forEach((param, index) => {
      if (param) {
        bodyText = bodyText.replace(`{{${index + 1}}}`, param)
      }
    })

    return (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-medium mb-2">Vista previa del mensaje:</h4>
        <div className="space-y-2">
          {headerComponent?.text && <p className="font-semibold text-gray-800">{headerComponent.text}</p>}
          <p className="text-gray-700">{bodyText}</p>
          {footerComponent?.text && <p className="text-sm text-gray-500">{footerComponent.text}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="send" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="send">Enviar Mensaje</TabsTrigger>
          <TabsTrigger value="templates">Ver Plantillas</TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Enviar Mensaje de Prueba</CardTitle>
              <CardDescription>Prueba el envío de mensajes de texto o plantillas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {lastError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <strong>Error:</strong> {lastError}
                  </AlertDescription>
                </Alert>
              )}

              {debugInfo && process.env.NODE_ENV === "development" && (
                <Alert>
                  <AlertDescription>
                    <strong>Debug Info:</strong>
                    <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(debugInfo, null, 2)}</pre>
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="phone">Número de Teléfono</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej: +5491112345678"
                />
              </div>

              <div className="space-y-2">
                <Label>Tipo de Mensaje</Label>
                <RadioGroup value={type} onValueChange={setType} className="flex space-x-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="text" id="text" />
                    <Label htmlFor="text">Texto</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="template" id="template" />
                    <Label htmlFor="template">Plantilla</Label>
                  </div>
                </RadioGroup>
              </div>

              {type === "text" && (
                <div className="space-y-2">
                  <Label htmlFor="mensaje">Mensaje</Label>
                  <Textarea
                    id="mensaje"
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    rows={4}
                    placeholder="Escribe el mensaje que deseas enviar"
                  />
                </div>
              )}

              {type === "template" && (
                <div className="space-y-4">
                  {selectedTemplate ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">Plantilla seleccionada:</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline">{selectedTemplate.name}</Badge>
                            <Badge variant="outline">{selectedTemplate.language}</Badge>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelectedTemplate(null)}>
                          Cambiar
                        </Button>
                      </div>

                      {templateParams.length > 0 && (
                        <div className="space-y-2">
                          <Label>Parámetros de la plantilla:</Label>
                          {templateParams.map((param, index) => (
                            <div key={index} className="space-y-1">
                              <Label htmlFor={`param-${index}`}>Parámetro {index + 1}</Label>
                              <Input
                                id={`param-${index}`}
                                value={param}
                                onChange={(e) => updateTemplateParam(index, e.target.value)}
                                placeholder={`Valor para parámetro ${index + 1}`}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {renderTemplatePreview()}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No hay plantilla seleccionada.</p>
                      <p className="text-sm">Ve a la pestaña "Ver Plantillas" para seleccionar una.</p>
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleSendTemplate}
                disabled={isLoading || (type === "template" && !selectedTemplate)}
                className="w-full"
              >
                {isLoading ? "Enviando..." : "Enviar Mensaje"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates">
          <WhatsAppTemplates config={config} onSelectTemplate={handleTemplateSelect} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
