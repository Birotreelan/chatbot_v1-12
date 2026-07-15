import type React from "react"
import { FacturacionNav } from "@/components/facturacion/facturacion-nav"
import { requireBillingAgent } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function FacturacionLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Solo billing_agent o super_admin pueden acceder a esta área
  await requireBillingAgent()

  return (
    <div className="flex min-h-screen flex-col">
      <FacturacionNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}
