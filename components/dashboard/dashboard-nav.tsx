"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, Settings, Activity, MessageSquare, LogOut } from "lucide-react"

const navigation = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Configuraciones",
    href: "/dashboard/config",
    icon: Settings,
  },
  {
    name: "Monitoreo",
    href: "/dashboard/monitoring",
    icon: Activity,
  },
  {
    name: "Conversaciones",
    href: "/dashboard/conversations",
    icon: MessageSquare,
  },
]

export function DashboardNav() {
  const pathname = usePathname()

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      })

      if (response.ok) {
        window.location.href = "/login"
      }
    } catch (error) {
      console.error("Error cerrando sesión:", error)
    }
  }

  return (
    <nav className="flex items-center space-x-4 lg:space-x-6">
      {navigation.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex items-center space-x-2 text-sm font-medium transition-colors hover:text-primary",
              isActive ? "text-black dark:text-white" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.name}</span>
          </Link>
        )
      })}

      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        className="flex items-center space-x-2 text-sm font-medium text-muted-foreground hover:text-primary"
      >
        <LogOut className="h-4 w-4" />
        <span>Salir</span>
      </Button>
    </nav>
  )
}
