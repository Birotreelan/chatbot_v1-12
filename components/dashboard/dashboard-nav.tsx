"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions"

export function DashboardNav() {
  const router = useRouter()

  async function handleLogout() {
    await logout()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="bg-background border-b">
      <div className="container mx-auto flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-bold text-xl">
            WhatsApp AI
          </Link>
          <nav className="hidden md:flex gap-6">
            <Link href="/dashboard" className="text-foreground/60 hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/dashboard/conversations" className="text-foreground/60 hover:text-foreground">
              Conversaciones
            </Link>
            <Link href="/dashboard/config/new" className="text-foreground/60 hover:text-foreground">
              Nuevo Número
            </Link>
            <Link
              href="/demo"
              className="text-foreground/60 hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              Demo Widget
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
