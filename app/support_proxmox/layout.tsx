import type React from "react"
import { Suspense } from "react"
import { SupportNav } from "@/components/support-proxmox/support-nav"
import { SessionProvider } from "@/components/support-proxmox/session-provider"
import { redirect } from "next/navigation"
import { requireSupportAgent, getSessionId, rutaPanelSoporte } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function SupportLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación de agente de soporte
  // Nota: El middleware maneja el SSO (_sid) antes de llegar aquí
  const sesion = await requireSupportAgent()

  // Espejo del control del panel estándar: si este cliente NO es Proxmox, no
  // tiene nada que hacer acá. Evita que los dos paneles queden accesibles a
  // cualquiera por conocer la URL.
  const panelQueCorresponde = await rutaPanelSoporte(sesion.tenantId)
  if (panelQueCorresponde !== "/support_proxmox") {
    redirect(panelQueCorresponde)
  }

  // Session ID vigente, venga de la cookie o del header.
  //
  // 14/9/2026: antes acá sólo se leía el header `x-session-id`, que el middleware
  // pone únicamente cuando la URL trae `_sid`. Resultado: en Chrome —donde la
  // cookie viajaba sola y nadie necesitaba `_sid`— el cliente nunca sabía su
  // session ID, así que las navegaciones internas del panel salían sin él. En
  // cuanto Chrome dejó de mandar la cookie dentro del iframe, esas navegaciones
  // quedaron sin autenticar y "Ver" dejó de abrir. Safari seguía funcionando
  // porque su camino nunca dependió de la cookie.
  const sessionId = await getSessionId()

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Cargando...</div>}>
      <SessionProvider initialSessionId={sessionId}>
        <div className="flex min-h-screen flex-col">
          <SupportNav />
          <main className="flex-1">{children}</main>
        </div>
      </SessionProvider>
    </Suspense>
  )
}
