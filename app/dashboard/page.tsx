import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { DashboardClient } from "@/components/dashboard/dashboard-client"

export default function DashboardPage() {
  return (
    <div className="container mx-auto py-8">
      <DashboardHeader />
      <DashboardClient />
    </div>
  )
}

// Desactivamos la generación estática para esta página
export const dynamic = "force-dynamic"
