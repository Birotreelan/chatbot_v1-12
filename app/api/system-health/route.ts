import { type NextRequest, NextResponse } from "next/server"
import { systemDiagnostics } from "@/lib/advanced-monitoring"
import { isAuthenticated } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Generar reporte de salud
    const healthReport = await systemDiagnostics.generateHealthReport()

    // Obtener eventos recientes
    const recentEvents = systemDiagnostics.getRecentEvents(60) // Últimos 60 minutos

    // Obtener patrones de error
    const errorPatterns = systemDiagnostics.getErrorPatterns()

    return NextResponse.json({
      health: healthReport,
      recentEvents: recentEvents.slice(-50), // Últimos 50 eventos
      errorPatterns: errorPatterns.slice(0, 10), // Top 10 patrones de error
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error obteniendo estado del sistema:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación
    if (!isAuthenticated(request)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { action } = await request.json()

    if (action === "run-health-check") {
      // Ejecutar chequeo de salud manual
      await systemDiagnostics.runHealthCheck()
      return NextResponse.json({ message: "Chequeo de salud ejecutado" })
    }

    if (action === "clear-events") {
      // Limpiar eventos (solo para testing)
      systemDiagnostics["events"] = []
      systemDiagnostics["errorPatterns"].clear()
      return NextResponse.json({ message: "Eventos limpiados" })
    }

    return NextResponse.json({ error: "Acción no válida" }, { status: 400 })
  } catch (error) {
    console.error("Error en acción del sistema:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
