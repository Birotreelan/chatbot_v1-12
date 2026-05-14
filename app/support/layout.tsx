import type React from "react"
import { Suspense } from "react"
import { headers } from "next/headers"
import { SupportNav } from "@/components/support/support-nav"
import { SessionProvider } from "@/components/support/session-provider"
import { requireSupportAgent } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación de agente de soporte
  // Nota: El middleware maneja el SSO (_sid) antes de llegar aquí
  await requireSupportAgent()

  // Obtener el session ID del header (para Safari fallback)
  const headerList = await headers()
  const sessionIdFromHeader = headerList.get("x-session-id")

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Cargando...</div>}>
      <SessionProvider initialSessionId={sessionIdFromHeader}>
        <div className="flex min-h-screen flex-col">
          <SupportNav />
          <main className="flex-1">{children}</main>
        </div>
      </SessionProvider>
    </Suspense>
  )
}
