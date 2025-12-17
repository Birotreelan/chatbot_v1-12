"use client"

import { useState, useEffect } from "react"
import type { ClientAppointmentStats } from "@/lib/types"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppointmentStatsDetail } from "./appointment-stats-detail"
import { Loader2 } from "lucide-react"

interface ClientWithStats {
  configId: string
  clienteId: string
  displayName: string
  stats: Partial<ClientAppointmentStats>
}

export function AppointmentStatsView() {
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientWithStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    try {
      const todayUTC = new Date()
      const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()))
        .toISOString()
        .split("T")[0]
      const response = await fetch(`/api/appointment-stats?startDate=${today}&endDate=${today}`)
      if (response.ok) {
        const data = await response.json()
        setClients(data)
        if (data.length > 0) {
          setSelectedClient(data[0])
        }
      }
    } catch (error) {
      console.error("Error cargando clientes:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Cargando estadísticas...</span>
      </div>
    )
  }

  if (clients.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <Card className="p-8 text-center max-w-md">
          <CardHeader>
            <CardTitle>Sin clientes configurados</CardTitle>
            <CardDescription>
              No hay clientes con cliente_id configurado. Para visualizar estadísticas de citas, asegúrate de que cada
              configuración de WhatsApp tenga un cliente_id asignado.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b bg-background p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Estadísticas de Citas</h1>
            <p className="text-muted-foreground text-sm">
              Monitoreo de recordatorios, confirmaciones, cancelaciones y reagendamientos
            </p>
          </div>
        </div>
        <Tabs
          value={selectedClient?.clienteId}
          onValueChange={(value) => {
            const client = clients.find((c) => c.clienteId === value)
            setSelectedClient(client || null)
          }}
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            {clients.map((client) => (
              <TabsTrigger key={client.clienteId} value={client.clienteId} className="flex-shrink-0">
                {client.displayName}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {selectedClient && (
          <AppointmentStatsDetail clienteId={selectedClient.clienteId} displayName={selectedClient.displayName} />
        )}
      </div>
    </div>
  )
}
