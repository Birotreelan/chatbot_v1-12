"use client"

import Link from "next/link"
import type { WhatsAppConfig } from "@/lib/types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DeleteWhatsAppConfig } from "@/components/dashboard/delete-whatsapp-config"
import { Pause, Play, Activity, AlertTriangle, XCircle } from "lucide-react"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"

interface WhatsAppConfigListProps {
  configs: WhatsAppConfig[]
}

export function WhatsAppConfigList({ configs: initialConfigs }: WhatsAppConfigListProps) {
  const [configs, setConfigs] = useState(initialConfigs)
  const [loadingPause, setLoadingPause] = useState<string | null>(null)
  const [loadingHealth, setLoadingHealth] = useState<string | null>(null)
  const { toast } = useToast()

  const handleTogglePause = async (configId: string) => {
    setLoadingPause(configId)
    try {
      const response = await fetch("/api/dashboard/configs/toggle-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId }),
      })

      if (!response.ok) throw new Error("Error al cambiar estado de pausa")

      const data = await response.json()

      // Update local state
      setConfigs((prev) => prev.map((c) => (c.id === configId ? { ...c, paused: data.paused } : c)))

      toast({
        title: data.paused ? "IA Pausada" : "IA Reanudada",
        description: data.message,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cambiar el estado de la IA",
        variant: "destructive",
      })
    } finally {
      setLoadingPause(null)
    }
  }

  const handleCheckHealth = async (configId: string) => {
    setLoadingHealth(configId)
    try {
      const response = await fetch("/api/dashboard/configs/check-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId }),
      })

      if (!response.ok) throw new Error("Error al verificar health status")

      const data = await response.json()

      // Update local state
      setConfigs((prev) =>
        prev.map((c) =>
          c.id === configId
            ? {
                ...c,
                healthStatus: data.healthStatus,
                lastHealthCheck: new Date().toISOString(),
                healthCheckError: data.errors && data.errors.length > 0 ? JSON.stringify(data.errors) : undefined,
              }
            : c,
        ),
      )

      toast({
        title: "Health Status Actualizado",
        description: `Estado: ${data.healthStatus}`,
        variant: data.healthStatus === "BLOCKED" ? "destructive" : "default",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo verificar el health status",
        variant: "destructive",
      })
    } finally {
      setLoadingHealth(null)
    }
  }

  const getHealthStatusBadge = (config: WhatsAppConfig) => {
    if (!config.healthStatus) {
      return (
        <Badge variant="outline" className="gap-1">
          <Activity className="h-3 w-3" />
          No verificado
        </Badge>
      )
    }

    switch (config.healthStatus) {
      case "AVAILABLE":
        return (
          <Badge variant="success" className="gap-1">
            <Activity className="h-3 w-3" />
            Disponible
          </Badge>
        )
      case "LIMITED":
        return (
          <Badge variant="secondary" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Limitado
          </Badge>
        )
      case "BLOCKED":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Bloqueado
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Activity className="h-3 w-3" />
            Desconocido
          </Badge>
        )
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>ID de Número</TableHead>
            <TableHead>ID de Asistente</TableHead>
            <TableHead>Asistentes Extra</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Health Status</TableHead>
            <TableHead>Mensajes</TableHead>
            <TableHead>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map((config) => (
            <TableRow key={config.id}>
              <TableCell className="font-medium">{config.displayName}</TableCell>
              <TableCell>{config.phoneNumberId}</TableCell>
              <TableCell>
                <span className="truncate max-w-[150px] inline-block">{config.whatsappAssistantId}</span>
              </TableCell>
              <TableCell>
                {config.additionalAssistants && config.additionalAssistants.length > 0 ? (
                  <Badge variant="secondary">{config.additionalAssistants.length} configurados</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">-</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  {config.active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="destructive">Inactivo</Badge>
                  )}
                  {config.paused && <Badge variant="secondary">IA Pausada</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-2">
                  {getHealthStatusBadge(config)}
                  {config.lastHealthCheck && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(config.lastHealthCheck).toLocaleString()}
                    </span>
                  )}
                  {config.healthCheckError && (
                    <span className="text-xs text-red-600" title={config.healthCheckError}>
                      Ver error
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {config.stats?.messagesReceived || 0} recibidos
                <br />
                {config.stats?.messagesProcessed || 0} procesados
              </TableCell>
              <TableCell>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckHealth(config.id)}
                    disabled={loadingHealth === config.id}
                    title="Verificar Health Status"
                  >
                    <Activity className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={config.paused ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleTogglePause(config.id)}
                    disabled={loadingPause === config.id}
                    title={config.paused ? "Reanudar IA" : "Pausar IA"}
                  >
                    {config.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Link href={`/dashboard/config/${config.id}`}>
                    <Button variant="outline" size="sm">
                      Editar
                    </Button>
                  </Link>
                  <DeleteWhatsAppConfig id={config.id} name={config.displayName} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
