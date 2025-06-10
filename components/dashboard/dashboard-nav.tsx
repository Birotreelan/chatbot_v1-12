"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LayoutDashboard, Plus, Activity } from "lucide-react"

const navigation = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Nuevo Cliente",
    href: "/dashboard/config/new",
    icon: Plus,
  },
  {
    name: "Monitoreo",
    href: "/dashboard/monitoring",
    icon: Activity,
  },
]

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1">
      {navigation.map((item) => {
        const isActive = pathname === item.href
        return (
          <Link key={item.name} href={item.href}>
            <Button
              variant={isActive ? "secondary" : "ghost"}
              className={cn("w-full justify-start", isActive && "bg-muted font-medium")}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.name}
            </Button>
          </Link>
        )
      })}
    </nav>
  )
}
