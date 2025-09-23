"use client"

import { useEffect, useState } from "react"
import { DashboardStats } from "./dashboard-stats"
import type { SystemStats } from "@/lib/types"

export default function DashboardStatsWrapper() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/dashboard/stats")
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        }
      } catch (error) {
        console.error("Error al cargar estadísticas:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  if (loading) {
    return <div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>
  }

  if (!stats) {
    return (
      <div className="p-4 border rounded-md my-4 text-center">
        No se pudieron cargar las estadísticas. Por favor, intenta de nuevo más tarde.
      </div>
    )
  }

  return <DashboardStats stats={stats} />
}
