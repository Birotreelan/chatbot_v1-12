"use client"

import { Suspense, useState } from "react"
import { Settings, MessageCircle, BarChart3, Cog } from "lucide-react"
import { toast } from "sonner"
import dynamic from "next/dynamic"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Importamos los componentes de manera dinámica con SSR desactivado
const DashboardStatsWrapper = dynamic(
  () => import("@/components/dashboard/dashboard-stats-wrapper").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>,
  },
)

const WhatsAppConfigsWrapper = dynamic(
  () => import("@/components/dashboard/whatsapp-configs-wrapper").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>,
  },
)

const ConversationsWrapper = dynamic(
  () => import("@/components/dashboard/conversations-wrapper").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => <div className="p-4 border rounded-md my-4">Cargando conversaciones...</div>,
  },
)

export function DashboardClient() {
  const [activeTab, setActiveTab] = useState("overview")

  const handleMigration = async () => {
    try {
      const response = await fetch("/api/migrate-widget", {
        method: "POST",
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: "Migración Exitosa",
          description: `${result.migratedCount} configuraciones actualizadas.`,
        })
        // Recargar los datos
        window.location.reload()
      } else {
        toast({
          title: "Error en Migración",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo ejecutar la migración",
        variant: "destructive",
      })
    }
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">Dashboard</h2>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Resumen
            </TabsTrigger>
            <TabsTrigger value="conversations" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Conversaciones
            </TabsTrigger>
            <TabsTrigger value="configurations" className="flex items-center gap-2">
              <Cog className="h-4 w-4" />
              Configuraciones
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Herramientas de Administración</h3>
              <div className="space-x-2">
                <Button
                  onClick={handleMigration}
                  variant="outline"
                  className="bg-blue-50 hover:bg-blue-100 border-blue-200"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Migrar Widgets
                </Button>
              </div>
            </div>

            <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>}>
              <DashboardStatsWrapper />
            </Suspense>

            <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>}>
              <WhatsAppConfigsWrapper />
            </Suspense>
          </TabsContent>

          <TabsContent value="conversations" className="mt-6">
            <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando conversaciones...</div>}>
              <ConversationsWrapper />
            </Suspense>
          </TabsContent>

          <TabsContent value="configurations" className="mt-6">
            <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>}>
              <WhatsAppConfigsWrapper />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
