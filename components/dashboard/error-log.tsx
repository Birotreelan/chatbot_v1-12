"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface ErrorEntry {
  timestamp: string
  message: string
  stack?: string
  category: string
}

interface ErrorLogData {
  [category: string]: ErrorEntry[]
}

export function ErrorLog() {
  const [errorData, setErrorData] = useState<ErrorLogData>({})
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>("all")

  useEffect(() => {
    let isMounted = true

    const fetchErrorLog = async () => {
      try {
        const response = await fetch("/api/dashboard/errors")
        if (response.ok && isMounted) {
          const data = await response.json()
          setErrorData(data)

          // Seleccionar la primera categoría si no hay ninguna seleccionada
          if (selectedCategory === "all" && Object.keys(data).length > 0) {
            setSelectedCategory(Object.keys(data)[0])
          }
        }
      } catch (error) {
        if (isMounted) {
          console.error("Error al cargar log de errores:", error)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchErrorLog()

    // Actualizar cada minuto
    const interval = setInterval(() => {
      if (isMounted) {
        fetchErrorLog()
      }
    }, 60000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [selectedCategory])

  const getCategoryBadgeVariant = (category: string) => {
    switch (category) {
      case "webhook":
        return "default"
      case "openai":
        return "secondary"
      case "queue":
        return "outline"
      case "rate_limit":
        return "destructive"
      default:
        return "outline"
    }
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString()
  }

  const truncateMessage = (message: string, maxLength = 100) => {
    return message.length > maxLength ? `${message.substring(0, maxLength)}...` : message
  }

  if (loading) {
    return <div className="p-4 border rounded-md">Cargando log de errores...</div>
  }

  const categories = Object.keys(errorData)
  const allErrors = Object.values(errorData)
    .flat()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Registro de Errores</CardTitle>
        <CardDescription>Errores recientes del sistema organizados por categoría</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">Todos ({allErrors.length})</TabsTrigger>
            {categories.map((category) => (
              <TabsTrigger key={category} value={category}>
                <Badge variant={getCategoryBadgeVariant(category)} className="mr-2">
                  {category}
                </Badge>
                ({errorData[category].length})
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all">
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {allErrors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No hay errores registrados. ¡El sistema está funcionando correctamente!
                </div>
              ) : (
                allErrors.slice(0, 20).map((error, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center space-x-2">
                        <Badge variant={getCategoryBadgeVariant(error.category)}>{error.category}</Badge>
                        <span className="text-sm text-muted-foreground">{formatTimestamp(error.timestamp)}</span>
                      </div>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">{truncateMessage(error.message)}</p>
                      {error.stack && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Ver stack trace</summary>
                          <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1 overflow-x-auto">
                            {error.stack}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {categories.map((category) => (
            <TabsContent key={category} value={category}>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {errorData[category].length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay errores en la categoría "{category}"
                  </div>
                ) : (
                  errorData[category].slice(0, 20).map((error, index) => (
                    <div key={index} className="border rounded-lg p-4 space-y-2">
                      <div className="flex justify-between items-start">
                        <span className="text-sm text-muted-foreground">{formatTimestamp(error.timestamp)}</span>
                      </div>
                      <div className="text-sm">
                        <p className="font-medium">{error.message}</p>
                        {error.stack && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-muted-foreground">Ver stack trace</summary>
                            <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1 overflow-x-auto">
                              {error.stack}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
