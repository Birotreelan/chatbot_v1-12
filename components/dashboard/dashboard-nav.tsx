"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions"

export function DashboardNav() {
  const router = useRouter()

  async function handleLogout() {
    await logout()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="bg-background border-b">
      {/* ── La navegación (17/11/2026) ────────────────────────────────────
          Son trece enlaces. Con `hidden md:flex` pasaban dos cosas, las dos
          malas:

           · abajo de 768px la barra NO EXISTÍA: en un teléfono el dashboard
             quedaba sin forma de ir a ninguna parte salvo volver al inicio;
           · entre 768 y ~1100 los enlaces entraban a la fuerza y se cortaban
             contra el borde, sin scroll — "Facturación", "Servicio",
             "Portal" e "IDs" eran inalcanzables.

          Ahora la fila se desliza, que es el mismo patrón que usan las
          pestañas del dashboard. Cada enlace lleva `shrink-0` para que no se
          compriman entre sí, y el logo y el botón de salir no se mueven. */}
      <div className="container mx-auto flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/dashboard" className="shrink-0 font-bold text-xl">
            WhatsApp AI
          </Link>
          <nav className="flex gap-6 overflow-x-auto">
            <Link href="/dashboard" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/dashboard/conversations" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Conversaciones
            </Link>
            <Link href="/dashboard/estadisticas" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Estadísticas
            </Link>
            <Link href="/dashboard/integracion" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Integración
            </Link>
            <Link href="/dashboard/consumos" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Consumos
            </Link>
            <Link href="/dashboard/facturacion" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Facturación
            </Link>
            {/* Servicio sólo existe acá, dentro del dashboard. No se agrega a
                FacturacionNav: el área /facturacion es la del rol
                billing_agent, y esta pestaña no le corresponde. */}
            <Link href="/dashboard/servicio" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Servicio
            </Link>
            <Link href="/dashboard/config/new" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Nuevo Número
            </Link>
            <Link href="/dashboard/usuarios" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Usuarios Soporte
            </Link>
            <Link href="/dashboard/feature-flags" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Feature Flags
            </Link>
            <Link href="/dashboard/flows" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Flows
            </Link>
            <Link href="/dashboard/portal" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              Portal
            </Link>
            {/* El banco de pruebas del motor conversacional: conversaciones
                reales etiquetadas a mano. Ver app/dashboard/evaluacion. */}
            <Link
              href="/dashboard/evaluacion"
              className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground"
            >
              Evaluación
            </Link>
            {/* Mantenimiento: los clientes que cambiaron de cliente_id y
                quedaron partidos en dos. Ver app/dashboard/ids/page.tsx. */}
            <Link href="/dashboard/ids" className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground">
              IDs
            </Link>
            <Link
              href="/demo"
              className="shrink-0 whitespace-nowrap text-foreground/60 hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              Demo Widget
            </Link>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Button variant="outline" onClick={handleLogout}>
            Cerrar Sesión
          </Button>
        </div>
      </div>
    </header>
  )
}
