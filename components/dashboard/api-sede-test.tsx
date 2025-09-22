"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

export function APISedeTester() {
  const [clienteId, setClienteId] = useState("a9454478-89c1-11e3-a751-081012379997")
  const [sedeId, setSedeId] = useState("cfe6a025-1b9d-102d-b564-6096d05021b3")
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<any>(null)

  const testAPIs = async () => {
    setIsLoading(true)
    setResults(null)

    try {
      const params = new URLSearchParams({
        cliente_id: clienteId,
      })

      if (sedeId.trim()) {
        params.append("sede_id", sedeId)
      }

      const response = await fetch(`/api/test-sedes?${params.toString()}`)
      const data = await response.json()

      setResults(data)
    } catch (error) {
      console.error("Error testing APIs:", error)
      setResults({
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const testSpecificAPI = async (action: string) => {
    setIsLoading(true)

    try {
      const response = await fetch("/api/test-sedes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clienteId,
          sedeId: sedeId.trim() || undefined,
          action,
        }),
      })

      const data = await response.json()
      setResults(data)
    } catch (error) {
      console.error(`Error testing ${action}:`, error)
      setResults({
        error: error.message,
        action,
        timestamp: new Date().toISOString(),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = (success: boolean) => {
    return success ? (
      <Badge variant="default" className="bg-green-500">
        ✅ Éxito
      </Badge>
    ) : (
      <Badge variant="destructive">❌ Error</Badge>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Probador de APIs de Sede</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clienteId">Cliente ID</Label>
              <Input
                id="clienteId"
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                placeholder="a9454478-89c1-11e3-a751-081012379997"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sedeId">Sede ID (opcional)</Label>
              <Input
                id="sedeId"
                value={sedeId}
                onChange={(e) => setSedeId(e.target.value)}
                placeholder="cfe6a025-1b9d-102d-b564-6096d05021b3"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={testAPIs} disabled={isLoading || !clienteId} className="flex-1 md:flex-none">
              {isLoading ? "Probando..." : "Probar Todas las APIs"}
            </Button>
            <Button onClick={() => testSpecificAPI("getSedes")} disabled={isLoading || !clienteId} variant="outline">
              Probar getSedes
            </Button>
            <Button onClick={() => testSpecificAPI("getMedicos")} disabled={isLoading || !clienteId} variant="outline">
              Probar getMedicos
            </Button>
          </div>
        </CardContent>
      </Card>

      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Resultados de las Pruebas
              <Badge variant="outline">{new Date(results.timestamp).toLocaleString()}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 font-medium">Error General:</p>
                <p className="text-red-600">{results.error}</p>
              </div>
            ) : (
              <>
                {results.tests && (
                  <div className="space-y-4">
                    {results.tests.sedeEspecifica && (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-medium">Sede Específica</h4>
                          {getStatusBadge(results.tests.sedeEspecifica.success)}
                        </div>
                        {results.tests.sedeEspecifica.success ? (
                          <div className="text-sm text-green-700">
                            <p>Datos obtenidos: {JSON.stringify(results.tests.sedeEspecifica.data, null, 2)}</p>
                          </div>
                        ) : (
                          <div className="text-sm text-red-700">
                            <p>Error: {results.tests.sedeEspecifica.error}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {results.tests.todasSedes && (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-medium">Todas las Sedes</h4>
                          {getStatusBadge(results.tests.todasSedes.success)}
                        </div>
                        {results.tests.todasSedes.success ? (
                          <div className="text-sm text-green-700">
                            <p>
                              Sedes encontradas:{" "}
                              {Array.isArray(results.tests.todasSedes.data)
                                ? results.tests.todasSedes.data.length
                                : "N/A"}
                            </p>
                            <details className="mt-2">
                              <summary className="cursor-pointer">Ver datos completos</summary>
                              <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
                                {JSON.stringify(results.tests.todasSedes.data, null, 2)}
                              </pre>
                            </details>
                          </div>
                        ) : (
                          <div className="text-sm text-red-700">
                            <p>Error: {results.tests.todasSedes.error}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {results.tests.medicos && (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-medium">Médicos</h4>
                          {getStatusBadge(results.tests.medicos.success)}
                        </div>
                        {results.tests.medicos.success ? (
                          <div className="text-sm text-green-700">
                            <p>
                              Médicos encontrados:{" "}
                              {Array.isArray(results.tests.medicos.data) ? results.tests.medicos.data.length : "N/A"}
                            </p>
                            <details className="mt-2">
                              <summary className="cursor-pointer">Ver datos completos</summary>
                              <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto">
                                {JSON.stringify(results.tests.medicos.data, null, 2)}
                              </pre>
                            </details>
                          </div>
                        ) : (
                          <div className="text-sm text-red-700">
                            <p>Error: {results.tests.medicos.error}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {results.result && (
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium">Resultado de {results.action}</h4>
                      {getStatusBadge(results.result.success)}
                    </div>
                    <Textarea
                      value={JSON.stringify(results.result, null, 2)}
                      readOnly
                      rows={10}
                      className="font-mono text-sm"
                    />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
