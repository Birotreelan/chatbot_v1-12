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
      <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>}>
        <DashboardStatsWrapper />
      </Suspense>

      <Suspense fallback={<div className="p-4 border rounded-md my-4">Cargando configuraciones...</div>}>
        <WhatsAppConfigsWrapper />
      </Suspense>
    </>
  )
}
