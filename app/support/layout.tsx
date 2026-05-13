import type React from "react"
import { SupportNav } from "@/components/support/support-nav"
import { SSOHandler } from "@/components/support/sso-handler"
import { requireSupportAgent } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación de agente de soporte
  await requireSupportAgent()

  return (
    <div className="flex min-h-screen flex-col">
      <SSOHandler />
      <SupportNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}
