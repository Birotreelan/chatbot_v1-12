"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions"
import { useSession } from "./session-provider"
import { LogOut, Headphones } from "lucide-react"

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
    <header className="bg-primary text-primary-foreground shadow-sm">
      <div className="container mx-auto flex h-11 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4" />
          <Link href={supportUrl} className="font-semibold text-sm">
            Atencion al Paciente
          </Link>
        </div>
        {/* Solo mostrar botón de cerrar sesión si NO es login por SSO */}
        {!effectiveSid && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleLogout}
            className="h-7 text-xs text-primary-foreground hover:bg-primary-foreground/10"
          >
            <LogOut className="h-3 w-3 mr-1" />
            Cerrar Sesion
          </Button>
        )}
      </div>
    </header>
  )
}
