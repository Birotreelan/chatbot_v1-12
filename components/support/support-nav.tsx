"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions"
import { useSession } from "./session-provider"

export function SupportNav() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { sessionId: ssoSessionId } = useSession()
  
  // Obtener _sid de la URL o del contexto de sesión
  const sidFromUrl = searchParams.get("_sid")
  const effectiveSid = sidFromUrl || ssoSessionId

  async function handleLogout() {
    await logout()
    router.push("/login")
    router.refresh()
  }

  // Construir URLs con _sid para Safari fallback
  const supportUrl = effectiveSid ? `/support?_sid=${encodeURIComponent(effectiveSid)}` : "/support"

  return (
    <header className="bg-background border-b">
      <div className="container mx-auto flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href={supportUrl} className="font-bold text-xl">
            Atención al Cliente
          </Link>
          <nav className="hidden md:flex gap-6">
            <Link href={supportUrl} className="text-foreground/60 hover:text-foreground">
              Conversaciones
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={handleLogout}>
            Cerrar Sesión
          </Button>
        </div>
      </div>
    </header>
  )
}
