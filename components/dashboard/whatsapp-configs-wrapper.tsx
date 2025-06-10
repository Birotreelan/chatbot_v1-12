"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WhatsAppConfigList } from "@/components/dashboard/whatsapp-config-list"
import { EmptyState } from "@/components/dashboard/empty-state"
import { RefreshButton } from "@/components/dashboard/refresh-button"
import type { WhatsAppConfig } from "@/lib/types"

export default function WhatsAppConfigsWrapper() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfigs = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch("/api/dashboard/configs", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setConfigs(data.configs || [])
    } catch (error) {
      console.error("Error fetching configs:", error)
      setError(error instanceof Error ? error.message : "Error desconocido")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configuraciones de Clientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-10 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error al cargar configuraciones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-600 mb-4">
            <p>No se pudieron cargar las configuraciones de clientes.</p>
            <p className="text-sm mt-2">Error: {error}</p>
          </div>
          <Button onClick={fetchConfigs} variant="outline">
            Reintentar
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Configuraciones de Clientes</CardTitle>
        <div className="flex gap-2">
          <RefreshButton onRefresh={fetchConfigs} />
          <Link href="/dashboard/config/new">
            <Button>Nuevo Cliente</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>{configs.length === 0 ? <EmptyState /> : <WhatsAppConfigList configs={configs} />}</CardContent>
    </Card>
  )
}
