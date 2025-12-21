import Link from "next/link"
import { Button } from "@/components/ui/button"

export function DashboardHeader({ title }: { title?: string }) {
  return (
    <div className="flex justify-between items-center mb-8">
      <h1 className="text-3xl font-bold">{title || "Panel de Control de Treelan Iris AI"}</h1>
      <Link href="/dashboard/config/new">
        <Button>Nuevo Número de WhatsApp</Button>
      </Link>
    </div>
  )
}
