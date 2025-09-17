"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, Settings, Activity, MessageCircle } from "lucide-react"

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

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex space-x-8 border-b border-gray-200">
      {navigation.map((item) => {
        const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))

        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors",
              isActive
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.name}
          </Link>
        )
      })}
    </nav>
  )
}
