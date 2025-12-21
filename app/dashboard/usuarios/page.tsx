import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { SupportUsersManager } from "@/components/dashboard/support-users-manager"

export default function SupportUsersPage() {
  return (
    <div className="container mx-auto py-8">
      <DashboardHeader title="Usuarios de Atención al Cliente" />
      <SupportUsersManager />
    </div>
  )
}

export const dynamic = "force-dynamic"
