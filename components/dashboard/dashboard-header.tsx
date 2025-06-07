import Link from "next/link"
import { Button } from "@/components/ui/button"

export function DashboardHeader() {
  return (
    <div className="flex justify-between items-center mb-8">
      <h1 className="text-3xl font-bold">Panel de Control de WhatsApp AI</h1>
      <Link href="/dashboard/config/new">
        <Button>Nuevo Número de WhatsApp</Button>
      </Link>
    </div>
  )
}
