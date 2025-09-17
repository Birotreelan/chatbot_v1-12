"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Settings, MessageCircle, Activity } from "lucide-react"

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
    name: "Conversaciones",
    href: "/dashboard/conversations",
    icon: MessageCircle,
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
    <nav className="space-y-1">
      {navigation.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
              isActive
                ? "bg-blue-100 text-blue-700 border-r-2 border-blue-700"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50",
            )}
          >
            <item.icon className="mr-3 h-4 w-4" />
            {item.name}
          </Link>
        )
      })}
    </nav>
  )
}
