"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Copy, RefreshCw, AlertCircle, CheckCircle, Clock, XCircle, Send, Plus, Trash2, Loader2, Globe, Download, Upload } from "lucide-react"
import type { WhatsAppConfig, GlobalTemplate } from "@/lib/types"
import { WhatsAppTemplateCreator } from "./whatsapp-template-creator"

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
  quality_score?: {
    score: string
    date: string
  }
}

interface WhatsAppTemplatesProps {
  config: WhatsAppConfig
  onSelectTemplate?: (template: Template) => void
}

export function WhatsAppTemplates({ config, onSelectTemplate }: WhatsAppTemplatesProps) {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreator, setShowCreator] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Estados para plantillas globales
  const [showSaveGlobalModal, setShowSaveGlobalModal] = useState(false)
  const [templateToSaveGlobal, setTemplateToSaveGlobal] = useState<Template | null>(null)
  const [globalDisplayName, setGlobalDisplayName] = useState("")
  const [globalDescription, setGlobalDescription] = useState("")
  const [isSavingGlobal, setIsSavingGlobal] = useState(false)

  const [showImportModal, setShowImportModal] = useState(false)
  const [globalTemplates, setGlobalTemplates] = useState<GlobalTemplate[]>([])
  const [loadingGlobalTemplates, setLoadingGlobalTemplates] = useState(false)
  const [selectedGlobalTemplates, setSelectedGlobalTemplates] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importResults, setImportResults] = useState<{
    templateId: string
    name: string
    success: boolean
    error?: string
  }[] | null>(null)

  useEffect(() => {
    fetchTemplates()
  }, [config.id])

  async function fetchTemplates() {
    if (!config.wabaId) {
      setLoading(false)
      setError("No se ha configurado un WABA ID para este número.")
      return
    }

    try {
      setLoading(true)
      setError(null)

      const url = `/api/whatsapp/templates?wabaId=${config.wabaId}&configId=${config.id}`
      console.log(`Fetching templates from: ${url}`)

      const response = await fetch(url)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}: ${response.statusText}`)
      }

      if (data.success && data.templates) {
        setTemplates(data.templates)
        console.log(`Loaded ${data.templates.length} templates`)
      } else {
        throw new Error(data.error || "Error al obtener plantillas")
      }
    } catch (error) {
      console.error("Error al cargar plantillas:", error)
      const errorMessage = error instanceof Error ? error.message : "Error al cargar plantillas"
      setError(errorMessage)
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    await fetchTemplates()
    setRefreshing(false)
  }

  async function handleDeleteTemplate(template: Template) {
    setIsDeleting(true)
    try {
      const response = await fetch(
        `/api/whatsapp/templates/delete?wabaId=${config.wabaId}&configId=${config.id}&name=${template.name}`,
        { method: "DELETE" }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error al eliminar la plantilla")
      }

      toast({
        title: "Plantilla eliminada",
        description: `La plantilla "${template.name}" se ha eliminado correctamente`,
      })

      // Refrescar lista
      await fetchTemplates()
    } catch (error) {
      console.error("Error deleting template:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al eliminar la plantilla",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
      setDeletingTemplate(null)
    }
  }

  function handleTemplateCreated() {
    setShowCreator(false)
    fetchTemplates()
  }

  // Funciones para guardar como plantilla global
  function openSaveGlobalModal(template: Template) {
    setTemplateToSaveGlobal(template)
    setGlobalDisplayName(template.name)
    setGlobalDescription("")
    setShowSaveGlobalModal(true)
  }

  async function handleSaveAsGlobal() {
    if (!templateToSaveGlobal) return

    setIsSavingGlobal(true)
    try {
      const response = await fetch("/api/global-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateToSaveGlobal.name,
          displayName: globalDisplayName || templateToSaveGlobal.name,
          description: globalDescription,
          language: templateToSaveGlobal.language,
          category: templateToSaveGlobal.category,
          components: templateToSaveGlobal.components,
          sourceConfigId: config.id,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error al guardar como plantilla global")
      }

      toast({
        title: "Plantilla guardada",
        description: `La plantilla "${globalDisplayName || templateToSaveGlobal.name}" se guardo como plantilla global`,
      })

      setShowSaveGlobalModal(false)
      setTemplateToSaveGlobal(null)
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al guardar como plantilla global",
        variant: "destructive",
      })
    } finally {
      setIsSavingGlobal(false)
    }
  }

  // Funciones para importar plantillas globales
  async function fetchGlobalTemplates() {
    setLoadingGlobalTemplates(true)
    try {
      const response = await fetch("/api/global-templates")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error al obtener plantillas globales")
      }

      setGlobalTemplates(data.templates || [])
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al cargar plantillas globales",
        variant: "destructive",
      })
    } finally {
      setLoadingGlobalTemplates(false)
    }
  }

  function openImportModal() {
    setSelectedGlobalTemplates([])
    setImportResults(null)
    setShowImportModal(true)
    fetchGlobalTemplates()
  }

  function toggleGlobalTemplateSelection(templateId: string) {
    setSelectedGlobalTemplates((prev) =>
      prev.includes(templateId)
        ? prev.filter((id) => id !== templateId)
        : [...prev, templateId]
    )
  }

  function selectAllGlobalTemplates() {
    if (selectedGlobalTemplates.length === globalTemplates.length) {
      setSelectedGlobalTemplates([])
    } else {
      setSelectedGlobalTemplates(globalTemplates.map((t) => t.id))
    }
  }

  async function handleImportGlobalTemplates() {
    if (selectedGlobalTemplates.length === 0) {
      toast({
        title: "Selecciona plantillas",
        description: "Debes seleccionar al menos una plantilla para importar",
        variant: "destructive",
      })
      return
    }

    setIsImporting(true)
    setImportResults(null)

    try {
      const response = await fetch("/api/global-templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateIds: selectedGlobalTemplates,
          wabaId: config.wabaId,
          configId: config.id,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Error al importar plantillas")
      }

      setImportResults(data.results)

      const successCount = data.results.filter((r: { success: boolean }) => r.success).length

      toast({
        title: "Importacion completada",
        description: data.message || `Se importaron ${successCount} de ${selectedGlobalTemplates.length} plantillas`,
      })

      // Refrescar la lista de plantillas
      await fetchTemplates()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error al importar plantillas",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "APPROVED":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "PENDING":
        return <Clock className="h-4 w-4 text-yellow-500" />
      case "REJECTED":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />
    }
  }

  function getStatusVariant(status: string) {
    switch (status) {
      case "APPROVED":
        return "default"
      case "PENDING":
        return "secondary"
      case "REJECTED":
        return "destructive"
      default:
        return "outline"
    }
  }

  function copyTemplateToClipboard(template: Template) {
    const templateJson = {
      template: {
        name: template.name,
        language: {
          code: template.language,
        },
      },
    }

    const jsonString = JSON.stringify(templateJson, null, 2)
    navigator.clipboard.writeText(jsonString)

    toast({
      title: "Plantilla copiada",
      description: `Plantilla "${template.name}" copiada al portapapeles`,
    })
  }

  function copyTemplateForSending(template: Template) {
    const templateData = {
      name: template.name,
      language: template.language,
      components: template.components,
    }

    const jsonString = JSON.stringify(templateData, null, 2)
    navigator.clipboard.writeText(jsonString)

    toast({
      title: "Datos de plantilla copiados",
      description: `Datos completos de "${template.name}" copiados para envío`,
    })
  }

  function handleSelectTemplate(template: Template) {
    if (onSelectTemplate) {
      onSelectTemplate(template)
      toast({
        title: "Plantilla seleccionada",
        description: `Plantilla "${template.name}" seleccionada para envío`,
      })
    }
  }

  function renderTemplatePreview(template: Template) {
    const headerComponent = template.components.find((c) => c.type === "HEADER")
    const bodyComponent = template.components.find((c) => c.type === "BODY")
    const footerComponent = template.components.find((c) => c.type === "FOOTER")

    return (
      <div className="mt-2 p-3 bg-gray-50 rounded-md">
        <p className="text-sm text-gray-600 font-medium mb-2">Vista previa:</p>
        <div className="space-y-1">
          {headerComponent?.text && <p className="text-sm font-semibold text-gray-800">{headerComponent.text}</p>}
          {bodyComponent?.text && <p className="text-sm text-gray-700">{bodyComponent.text}</p>}
          {footerComponent?.text && <p className="text-xs text-gray-500 mt-2">{footerComponent.text}</p>}
        </div>
      </div>
    )
  }

  if (!config.wabaId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plantillas de WhatsApp</CardTitle>
          <CardDescription>No se ha configurado un WABA ID para este número.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Para ver las plantillas, configure el WABA ID en la configuración de WhatsApp.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Plantillas de WhatsApp</CardTitle>
          <CardDescription>Cargando plantillas desde WhatsApp Business API...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col space-y-2">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Plantillas de WhatsApp</CardTitle>
            <CardDescription>WABA ID: {config.wabaId}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Reintentar
          </Button>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Plantillas de WhatsApp</CardTitle>
          <CardDescription>
            {templates.length} plantilla{templates.length !== 1 ? "s" : ""} encontrada
            {templates.length !== 1 ? "s" : ""} para WABA ID: {config.wabaId}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openImportModal}
            className="flex items-center gap-1"
          >
            <Download className="h-4 w-4" />
            Importar Globales
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setShowCreator(true)}
            className="flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Crear Plantilla
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No se encontraron plantillas para este WABA ID.</div>
        ) : (
          <div className="space-y-6">
            {templates.map((template, index) => (
              <div key={template.id || index} className="border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(template.status)}
                      <h3 className="font-medium text-lg">{template.name}</h3>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="outline">{template.language}</Badge>
                      <Badge variant={getStatusVariant(template.status)}>{template.status}</Badge>
                      {template.category && <Badge variant="outline">{template.category}</Badge>}
                      {template.quality_score && (
                        <Badge variant="outline">Calidad: {template.quality_score.score}</Badge>
                      )}
                    </div>
                    {renderTemplatePreview(template)}
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyTemplateToClipboard(template)}
                      className="flex items-center gap-1"
                    >
                      <Copy className="h-4 w-4" />
                      Copiar JSON
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => copyTemplateForSending(template)}
                      className="flex items-center gap-1"
                    >
                      <Copy className="h-4 w-4" />
                      Copiar Datos
                    </Button>
                    {onSelectTemplate && template.status === "APPROVED" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleSelectTemplate(template)}
                        className="flex items-center gap-1"
                      >
                        <Send className="h-4 w-4" />
                        Usar
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openSaveGlobalModal(template)}
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                    >
                      <Globe className="h-4 w-4" />
                      Guardar Global
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingTemplate(template)}
                      className="flex items-center gap-1 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Modal de creacion - usando portal para evitar que este dentro del formulario */}
      {showCreator && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <div 
            className="fixed inset-4 z-50 overflow-auto rounded-lg border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6" onClick={(e) => e.stopPropagation()}>
              <WhatsAppTemplateCreator
                config={config}
                onTemplateCreated={handleTemplateCreated}
                onCancel={() => setShowCreator(false)}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Dialogo de confirmacion de eliminacion */}
      <AlertDialog open={!!deletingTemplate} onOpenChange={() => setDeletingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Plantilla</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion eliminara permanentemente la plantilla <strong>"{deletingTemplate?.name}"</strong> de tu
              cuenta de WhatsApp Business. Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingTemplate && handleDeleteTemplate(deletingTemplate)}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal para guardar como plantilla global */}
      <Dialog open={showSaveGlobalModal} onOpenChange={setShowSaveGlobalModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Guardar como Plantilla Global
            </DialogTitle>
            <DialogDescription>
              Esta plantilla quedara disponible para importar en cualquier otro cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="globalDisplayName">Nombre para mostrar</Label>
              <Input
                id="globalDisplayName"
                value={globalDisplayName}
                onChange={(e) => setGlobalDisplayName(e.target.value)}
                placeholder="Ej: Confirmacion de turno"
              />
              <p className="text-xs text-muted-foreground">
                Nombre interno: {templateToSaveGlobal?.name}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="globalDescription">Descripcion (opcional)</Label>
              <Textarea
                id="globalDescription"
                value={globalDescription}
                onChange={(e) => setGlobalDescription(e.target.value)}
                placeholder="Describe el proposito de esta plantilla..."
                rows={3}
              />
            </div>
            <div className="bg-muted rounded-lg p-3">
              <p className="text-sm font-medium mb-2">Vista previa:</p>
              <div className="text-sm text-muted-foreground space-y-1">
                <p><strong>Idioma:</strong> {templateToSaveGlobal?.language}</p>
                <p><strong>Categoria:</strong> {templateToSaveGlobal?.category}</p>
                <p><strong>Componentes:</strong> {templateToSaveGlobal?.components.length}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveGlobalModal(false)}
              disabled={isSavingGlobal}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveAsGlobal}
              disabled={isSavingGlobal || !globalDisplayName.trim()}
            >
              {isSavingGlobal ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Guardar Global
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal para importar plantillas globales */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Importar Plantillas Globales
            </DialogTitle>
            <DialogDescription>
              Selecciona las plantillas que deseas importar a este cliente.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto py-4">
            {loadingGlobalTemplates ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Cargando plantillas...</span>
              </div>
            ) : globalTemplates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay plantillas globales disponibles.</p>
                <p className="text-sm mt-2">Guarda una plantilla como global desde la lista de plantillas.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllGlobalTemplates}
                    className="text-sm"
                  >
                    {selectedGlobalTemplates.length === globalTemplates.length
                      ? "Deseleccionar todo"
                      : "Seleccionar todo"}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {selectedGlobalTemplates.length} de {globalTemplates.length} seleccionadas
                  </span>
                </div>

                <div className="space-y-2">
                  {globalTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        selectedGlobalTemplates.includes(template.id)
                          ? "border-primary bg-primary/5"
                          : "hover:border-muted-foreground/50"
                      }`}
                      onClick={() => toggleGlobalTemplateSelection(template.id)}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selectedGlobalTemplates.includes(template.id)}
                          onCheckedChange={() => toggleGlobalTemplateSelection(template.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium truncate">{template.displayName}</h4>
                            <Badge variant="outline" className="text-xs">
                              {template.language}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {template.category}
                            </Badge>
                          </div>
                          {template.description && (
                            <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Nombre interno: {template.name}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Resultados de la importacion */}
                {importResults && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="font-medium mb-2">Resultados de la importacion:</h4>
                    <div className="space-y-2">
                      {importResults.map((result) => (
                        <div
                          key={result.templateId}
                          className={`flex items-center gap-2 text-sm p-2 rounded ${
                            result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                          }`}
                        >
                          {result.success ? (
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 flex-shrink-0" />
                          )}
                          <span className="flex-1">{result.name}</span>
                          {result.error && (
                            <span className="text-xs">{result.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setShowImportModal(false)}
              disabled={isImporting}
            >
              {importResults ? "Cerrar" : "Cancelar"}
            </Button>
            {!importResults && (
              <Button
                onClick={handleImportGlobalTemplates}
                disabled={isImporting || selectedGlobalTemplates.length === 0}
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Importar ({selectedGlobalTemplates.length})
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
