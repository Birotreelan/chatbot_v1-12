"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface WhatsAppConfigFormProps {
  config: WhatsAppConfig
}

export function WhatsAppConfigForm({ config }: WhatsAppConfigFormProps) {
  const [formData, setFormData] = useState({
    displayName: config.displayName || "",
    phoneNumberId: config.phoneNumberId || "",
    wabaId: config.wabaId || "", // Agregar esta línea
    assistantId: config.assistantId || "",
    accessToken: config.accessToken || "",
    verifyToken: config.verifyToken || "",
    active: config.active || false,
  })
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      console.log(`[FORM] Enviando actualización para configuración ${config.id}:`, formData)

      // Intentar primero con la ruta dinámica
      let response = await fetch(`/api/dashboard/configs/${config.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      // Si falla con 405, intentar con la ruta alternativa
      if (response.status === 405) {
        console.log(`[FORM] Ruta dinámica falló, intentando ruta alternativa`)
        response = await fetch(`/api/dashboard/configs/update`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: config.id, ...formData }),
        })
      }

      console.log(`[FORM] Respuesta del servidor:`, response.status, response.statusText)

      if (!response.ok) {
        // Intentar obtener más detalles del error
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

      const updatedConfig = await response.json()
      console.log(`[FORM] Configuración actualizada exitosamente:`, updatedConfig)

      toast({
        title: "Configuración actualizada",
        description: "La configuración de WhatsApp se ha actualizado correctamente.",
      })
    } catch (error) {
      console.error(`[FORM] Error al actualizar configuración:`, error)

      const errorMessage = error instanceof Error ? error.message : "Error desconocido"

      toast({
        title: "Error al actualizar",
        description: `No se pudo actualizar la configuración: ${errorMessage}`,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración de WhatsApp</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Nombre de la configuración</Label>
              <Input
                id="displayName"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="Mi WhatsApp Bot"
              />
            </div>

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
              <Label htmlFor="assistantId">Assistant ID</Label>
              <Input
                id="assistantId"
                name="assistantId"
                value={formData.assistantId}
                onChange={handleChange}
                placeholder="asst_..."
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

            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                name="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
              />
              <Label htmlFor="active">Configuración activa</Label>
            </div>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full">
            {isLoading ? "Actualizando..." : "Actualizar Configuración"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
