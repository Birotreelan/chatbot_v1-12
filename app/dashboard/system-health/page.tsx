import { SystemHealthMonitor } from "@/components/dashboard/system-health-monitor"

export default function SystemHealthPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Monitor de Salud del Sistema</h1>
        <p className="text-muted-foreground">
          Monitoreo en tiempo real del estado y rendimiento del sistema WhatsApp Bot
        </p>
      </div>
      <SystemHealthMonitor />
    </div>
  )
}
