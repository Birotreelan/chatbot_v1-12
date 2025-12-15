import type React from "react"
import { DashboardNav } from "@/components/dashboard/dashboard-nav"
import { requireAuth } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación
  await requireAuth()

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}

// Desactivamos la generación estática para este layout
export const dynamic = "force-dynamic"
