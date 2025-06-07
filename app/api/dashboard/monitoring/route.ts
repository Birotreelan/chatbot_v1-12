import { NextResponse } from "next/server"
import { getMetrics } from "@/lib/monitoring"

export async function GET() {
  try {
    // Obtener métricas del sistema
    const messagesReceived = (await getMetrics("messages_received")) || {}
    const messagesProcessed = (await getMetrics("messages_processed")) || {}
    const errors = (await getMetrics("errors")) || {}
    const rateLimited = (await getMetrics("rate_limited")) || {}

    // Calcular totales
    const totalMessages = Object.values(messagesReceived).reduce((sum, val) => sum + Number(val), 0)
    const totalProcessed = Object.values(messagesProcessed).reduce((sum, val) => sum + Number(val), 0)
    const totalErrors = Object.values(errors).reduce((sum, val) => sum + Number(val), 0)
    const totalRateLimited = Object.values(rateLimited).reduce((sum, val) => sum + Number(val), 0)

    // Calcular tasa de errores
    const errorRate = totalMessages > 0 ? (totalErrors / totalMessages) * 100 : 0

    // Determinar estado del sistema
    let systemHealth: "healthy" | "warning" | "critical" = "healthy"
    if (errorRate > 10) {
      systemHealth = "critical"
    } else if (errorRate > 5) {
      systemHealth = "warning"
    }

    // Simular tiempo de respuesta promedio (en un sistema real, esto vendría de métricas reales)
    const averageResponseTime = Math.random() * 10 + 5 // Entre 5 y 15 segundos

    // Simular threads activos
    const activeThreads = Math.floor(Math.random() * 50) + 10

    // Simular tamaño de cola
    const queueSize = Math.floor(Math.random() * 20)

    const monitoringData = {
      totalMessages,
      messagesProcessed: totalProcessed,
      errorRate,
      averageResponseTime,
      activeThreads,
      queueSize,
      systemHealth,
      lastUpdated: new Date().toISOString(),
    }

    return NextResponse.json(monitoringData)
  } catch (error) {
    console.error("Error al obtener datos de monitoreo:", error)
    return NextResponse.json(
      {
        totalMessages: 0,
        messagesProcessed: 0,
        errorRate: 0,
        averageResponseTime: 0,
        activeThreads: 0,
        queueSize: 0,
        systemHealth: "critical",
        lastUpdated: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
