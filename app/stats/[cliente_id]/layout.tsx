import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Estadísticas de Citas",
  description: "Panel de estadísticas de gestión de turnos",
}

export default function StatsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

// Permitir que esta página sea embebida en iframes
export async function generateViewport() {
  return {
    // Viewport estándar
  }
}
