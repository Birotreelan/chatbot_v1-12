import Link from "next/link"
import { MessageSquare } from "lucide-react"

const DashboardNav = () => {
  const navItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: Home,
    },
    {
      title: "Monitoreo",
      href: "/dashboard/monitoring",
      icon: Monitor,
    },
    {
      title: "Conversaciones",
      href: "/dashboard/conversations",
      icon: MessageSquare,
    },
    //** rest of code here **/
  ]

  return (
    <nav>
      {navItems.map((item) => (
        <Link key={item.title} href={item.href}>
          <a className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900">
            {item.icon}
            <span className="ml-3">{item.title}</span>
          </a>
        </Link>
      ))}
    </nav>
  )
}

export default DashboardNav
