"use client"

import { Suspense } from "react"
import dynamic from "next/dynamic"

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

export function DashboardClient() {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
      </div>

      <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>}>
        <DashboardStatsWrapper />
      </Suspense>

      <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>}>
        <WhatsAppConfigsWrapper />
      </Suspense>
    </>
  )
}
