import { Button } from "@/components/ui/button"
import Link from "next/link"

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 rounded-full bg-primary/10 p-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-primary"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>
      <h3 className="mb-2 text-lg font-semibold">No hay configuraciones</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        No se encontraron configuraciones. Crea una nueva para comenzar.
      </p>
      <Button asChild>
        <Link href="/dashboard/config/new">Nuevo Cliente</Link>
      </Button>
    </div>
  )
}
