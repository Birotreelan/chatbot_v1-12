"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import type { WhatsAppConfig } from "@/lib/types"

interface ProxyTestToolProps {
  config: WhatsAppConfig
}

export function ProxyTestTool({ config }: ProxyTestToolProps) {
  const { toast } = useToast()
  const [action, setAction] = useState<string>("get_paciente")
  const [params, setParams] = useState<string>('{\n  "dni": "27158093"\n}')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [result, setResult] = useState<any>(null)

  async function handleTest() {
    // Eliminar la verificación de config.proxy
    if (!config.cliente_id) {
      toast({
        title: "Error",
        description: "La configuración no tiene un ID de cliente configurado",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    setResult(null)

    try {
      // Parsear los parámetros como JSON
      let parsedParams
      try {
        parsedParams = JSON.parse(params)
      } catch (error) {
        toast({
          title: "Error",
          description: "Los parámetros no son un JSON válido",
          variant: "destructive",
        })
        setIsLoading(false)
        return
      }

      // Realizar la petición con la URL hardcodeada
      const response = await fetch("/api/test-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proxyUrl: "https://treelan.net/managment/proxy_service/",
          clienteId: config.cliente_id,
          action,
          params: parsedParams,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast({
          title: "Prueba exitosa",
          description: "El proxy respondió correctamente",
        })
      } else {
        toast({
          title: "Error en la prueba",
          description: data.error || "Error desconocido en la respuesta del proxy",
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
        <CardTitle>Herramienta de Diagnóstico del Proxy</CardTitle>
        <CardDescription>
          Envía solicitudes directamente al proxy para diagnosticar problemas de comunicación.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="action">Acción</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="action">
              <SelectValue placeholder="Selecciona una acción" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="get_paciente">get_paciente</SelectItem>
              <SelectItem value="get_subespecialidades">get_subespecialidades</SelectItem>
              <SelectItem value="get_profesionales">get_profesionales</SelectItem>
              <SelectItem value="get_turnos">get_turnos</SelectItem>
              <SelectItem value="set_turno">set_turno</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="params">Parámetros (JSON)</Label>
          <Textarea
            id="params"
            value={params}
            onChange={(e) => setParams(e.target.value)}
            rows={5}
            placeholder='{
  "dni": "12345678"
}'
          />
        </div>

        <div className="pt-4">
          <Button onClick={handleTest} disabled={isLoading || !config.proxy || !config.cliente_id}>
            {isLoading ? "Enviando..." : "Probar Proxy"}
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
        <p className="text-sm text-muted-foreground">
          Proxy: {config.proxy || "No configurado"} | Cliente ID: {config.cliente_id || "No configurado"}
        </p>
      </CardFooter>
    </Card>
  )
}
