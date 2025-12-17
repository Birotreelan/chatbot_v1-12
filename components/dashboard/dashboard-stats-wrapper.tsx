"use client"

import { useEffect, useState, useCallback } from "react"
import { DashboardStats } from "./dashboard-stats"
import { DateRangeFilter } from "./date-range-filter"
import type { SystemStats } from "@/lib/types"

export default function DashboardStatsWrapper() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const todayUTC = new Date()
  const today = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate()))
    .toISOString()
    .split("T")[0]
  const [dateFilter, setDateFilter] = useState<{ startDate: string | null; endDate: string | null }>({
    startDate: today,
    endDate: today,
  })

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (dateFilter.startDate) params.append("startDate", dateFilter.startDate)
      if (dateFilter.endDate) params.append("endDate", dateFilter.endDate)

      const url = `/api/dashboard/stats${params.toString() ? `?${params.toString()}` : ""}`
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error("Error al cargar estadísticas:", error)
    } finally {
      setLoading(false)
    }
  }, [dateFilter])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleFilterChange = (startDate: string | null, endDate: string | null) => {
    setDateFilter({ startDate, endDate })
  }

  return (
    <div>
      <DateRangeFilter onFilterChange={handleFilterChange} />

      {loading ? (
        <div className="p-4 border rounded-md my-4">Cargando estadísticas...</div>
      ) : !stats ? (
        <div className="p-4 border rounded-md my-4 text-center">
          No se pudieron cargar las estadísticas. Por favor, intenta de nuevo más tarde.
        </div>
      ) : (
        <DashboardStats stats={stats} />
      )}
    </div>
  )
}
