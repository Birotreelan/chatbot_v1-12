"use client"

import { MessageSquare } from "lucide-react"
import { useRouter } from "next/router"

const DashboardNav = () => {
  const router = useRouter()
  const pathname = router.pathname

  const navigation = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: "home",
      current: pathname === "/dashboard",
    },
    {
      name: "Monitoring",
      href: "/dashboard/monitoring",
      icon: "monitor",
      current: pathname === "/dashboard/monitoring",
    },
    {
      name: "Conversaciones",
      href: "/dashboard/conversations",
      icon: MessageSquare,
      current: pathname === "/dashboard/conversations",
    },
    // ** rest of code here **
  ]

  return (
    <nav>
      {navigation.map((item) => (
        <a href={item.href} key={item.name}>
          {item.icon}
          {item.name}
        </a>
      ))}
    </nav>
  )
}

export default DashboardNav
