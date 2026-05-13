import type React from "react"
import { SupportNav } from "@/components/support/support-nav"
import { requireSupportAgent } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación de agente de soporte
  // Nota: Si viene un sso_token, el middleware ya lo redirigió a /api/auth/sso
  await requireSupportAgent()

  return (
    <div className="flex min-h-screen flex-col">
      <SupportNav />
      <main className="flex-1">{children}</main>
    </div>
  )
}
