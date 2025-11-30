import { AppointmentStatsView } from "@/components/dashboard/appointment-stats-view"

export default function EstadisticasPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <AppointmentStatsView />
    </div>
  )
}

export const dynamic = "force-dynamic"
