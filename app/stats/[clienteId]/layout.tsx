import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Estadísticas de Turnos",
  description: "Panel de estadísticas de gestión de turnos",
}

export default function PublicStatsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Layout aislado sin navegación del dashboard
  // Solo renderiza el contenido de las estadísticas
  return <>{children}</>
}
