"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface ClienteIdTestProps {
  config: WhatsAppConfig
}

export function ClienteIdTest({ config }: ClienteIdTestProps) {
  const { toast } = useToast()
  const [clienteId, setClienteId] = useState<string>(config.cliente_id || "")
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [result, setResult] = useState<any>(null)

  // Modificar la función handleTest para usar la URL hardcodeada
  async function handleTest() {
    // Eliminar la verificación de config.proxy
    if (!clienteId) {
      toast({
        title: "Error",
        description: "Se requiere un Cliente_Id para la prueba",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      // Realizar la petición con la URL hardcodeada
      const response = await fetch("/api/test-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proxyUrl: "https://treelan.net/managment/proxy_service/",
          clienteId: clienteId,
          action: "get_paciente",
          params: { dni: "27158093" }, // Un DNI de ejemplo
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast({
          title: "Prueba exitosa",
          description: "El Cliente_Id es válido",
        })
      } else {
        toast({
          title: "Error en la prueba",
          description: data.responseData?.error || "Error desconocido en la respuesta del proxy",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error al realizar la prueba:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error desconocido al realizar la prueba",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Prueba de Cliente_Id</CardTitle>
        <CardDescription>Prueba si el Cliente_Id es válido para el proxy.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cliente-id">Cliente_Id</Label>
          <Input
            id="cliente-id"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            placeholder="Ingrese el Cliente_Id"
          />
        </div>

        <div className="pt-4">
          <Button onClick={handleTest} disabled={isLoading || !clienteId}>
            {isLoading ? "Probando..." : "Probar Cliente_Id"}
          </Button>
        </div>

        {result && (
          <div className="mt-4 space-y-4">
            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-900">
              <h4 className="font-medium mb-2">Solicitud:</h4>
              <pre className="text-xs overflow-auto max-h-40 p-2 bg-white dark:bg-gray-800 rounded border">
                {JSON.stringify(result.requestInfo, null, 2)}
              </pre>
            </div>

            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-900">
              <h4 className="font-medium mb-2">Información de la respuesta:</h4>
              <pre className="text-xs overflow-auto max-h-40 p-2 bg-white dark:bg-gray-800 rounded border">
                {JSON.stringify(result.responseInfo, null, 2)}
              </pre>
            </div>

            <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-900">
              <h4 className="font-medium mb-2">Texto de la respuesta:</h4>
              <pre className="text-xs overflow-auto max-h-40 p-2 bg-white dark:bg-gray-800 rounded border">
                {result.responseText}
              </pre>
            </div>

            {result.responseData && (
              <div className="p-4 border rounded-md bg-gray-50 dark:bg-gray-900">
                <h4 className="font-medium mb-2">Datos JSON de la respuesta:</h4>
                <pre className="text-xs overflow-auto max-h-60 p-2 bg-white dark:bg-gray-800 rounded border">
                  {JSON.stringify(result.responseData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <p className="text-sm text-muted-foreground">Prueba de validación del Cliente ID</p>
      </CardFooter>
    </Card>
  )
}
