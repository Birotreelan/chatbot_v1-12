"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions"
import { LogOut, Receipt } from "lucide-react"

export function FacturacionNav() {
  const router = useRouter()

  async function handleLogout() {
    await logout()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="bg-primary text-primary-foreground shadow-sm">
      <div className="container mx-auto flex h-11 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          <span className="font-semibold text-sm">Facturación</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="h-7 text-xs text-primary-foreground hover:bg-primary-foreground/10"
        >
          <LogOut className="h-3 w-3 mr-1" />
          Cerrar Sesion
        </Button>
      </div>
    </header>
  )
}
