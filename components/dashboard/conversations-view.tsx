"use client"

import { useState, useEffect } from "react"
import type { WhatsAppConfig } from "@/lib/types"
import { ConversationsList } from "./conversations-list"
import { ConversationChat } from "./conversation-chat"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

export function ConversationsView() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([])
  const [selectedConfig, setSelectedConfig] = useState<WhatsAppConfig | null>(null)
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    loadConfigs()
  }, [])

  async function loadConfigs() {
    try {
      const response = await fetch("/api/dashboard/configs")
      if (response.ok) {
        const allConfigs = await response.json()
        setConfigs(allConfigs)
        if (allConfigs.length > 0) {
          setSelectedConfig(allConfigs[0])
        }
      } else {
        console.error("Error al cargar configuraciones:", response.statusText)
      }
    } catch (error) {
      console.error("Error cargando configuraciones:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    if (!selectedConfig) return

    try {
      setExporting(true)
      const response = await fetch(`/api/conversations/export?configId=${selectedConfig.id}`)

      if (!response.ok) {
        throw new Error("Error al exportar conversaciones")
      }

      // Descargar el archivo
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `conversaciones_${selectedConfig.displayName}_${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error("Error exportando conversaciones:", error)
      alert("Error al exportar conversaciones. Por favor intenta de nuevo.")
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Cargando clientes...</p>
      </div>
    )
  }

  if (configs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold mb-2">No hay clientes configurados</h2>
          <p className="text-muted-foreground">
            Agrega un número de WhatsApp en el Dashboard para comenzar a monitorear conversaciones
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b bg-background p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Monitor de Conversaciones</h1>
          {selectedConfig && (
            <Button onClick={handleExport} disabled={exporting} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Exportando..." : "Exportar CSV"}
            </Button>
          )}
        </div>
        <Tabs
          value={selectedConfig?.id}
          onValueChange={(value) => {
            const config = configs.find((c) => c.id === value)
            setSelectedConfig(config || null)
            setSelectedContact(null)
          }}
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            {configs.map((config) => (
              <TabsTrigger key={config.id} value={config.id} className="flex-shrink-0">
                {config.displayName}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {selectedConfig && (
          <>
            <div className="w-80 border-r bg-background overflow-y-auto">
              <ConversationsList
                configId={selectedConfig.id}
                selectedContact={selectedContact}
                onSelectContact={setSelectedContact}
              />
            </div>
            <div className="flex-1 bg-muted/20">
              {selectedContact ? (
                <ConversationChat configId={selectedConfig.id} phoneNumber={selectedContact} />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-muted-foreground">Selecciona un contacto para ver la conversación</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
