interface SystemHealth {
  timestamp: string
  openaiStatus: "healthy" | "degraded" | "down"
  whatsappStatus: "healthy" | "degraded" | "down"
  redisStatus: "healthy" | "degraded" | "down"
  overallStatus: "healthy" | "degraded" | "down"
  metrics: {
    totalMessages: number
    successfulMessages: number
    failedMessages: number
    averageResponseTime: number
    errorRate: number
  }
  errors: Array<{
    timestamp: string
    type: string
    message: string
    count: number
  }>
  recommendations: string[]
}

interface DiagnosticEvent {
  timestamp: string
  type: "error" | "warning" | "info" | "success"
  component: string
  message: string
  data?: any
}

export class SystemDiagnostics {
  private static instance: SystemDiagnostics
  private events: DiagnosticEvent[] = []
  private maxEvents = 1000
  private errorPatterns: Map<string, number> = new Map()

  constructor() {
    // Limpiar eventos antiguos cada hora
    setInterval(() => this.cleanupOldEvents(), 60 * 60 * 1000)
  }

  static getInstance(): SystemDiagnostics {
    if (!SystemDiagnostics.instance) {
      SystemDiagnostics.instance = new SystemDiagnostics()
    }
    return SystemDiagnostics.instance
  }

  logEvent(type: DiagnosticEvent["type"], component: string, message: string, data?: any) {
    const event: DiagnosticEvent = {
      timestamp: new Date().toISOString(),
      type,
      component,
      message,
      data,
    }

    this.events.push(event)

    // Mantener solo los eventos más recientes
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents)
    }

    // Rastrear patrones de error
    if (type === "error") {
      const pattern = `${component}:${message}`
      this.errorPatterns.set(pattern, (this.errorPatterns.get(pattern) || 0) + 1)
    }

    // Log a consola con formato mejorado
    const prefix = `[DIAGNOSTICS] [${type.toUpperCase()}] [${component}]`
    if (data) {
      console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2))
    } else {
      console.log(`${prefix} ${message}`)
    }
  }

  error(component: string, message: string, data?: any) {
    this.logEvent("error", component, message, data)
  }

  warning(component: string, message: string, data?: any) {
    this.logEvent("warning", component, message, data)
  }

  info(component: string, message: string, data?: any) {
    this.logEvent("info", component, message, data)
  }

  success(component: string, message: string, data?: any) {
    this.logEvent("success", component, message, data)
  }

  private cleanupOldEvents() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    this.events = this.events.filter((event) => event.timestamp > oneHourAgo)
  }

  getRecentEvents(minutes = 60): DiagnosticEvent[] {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString()
    return this.events.filter((event) => event.timestamp > cutoff)
  }

  getErrorPatterns(): Array<{ pattern: string; count: number }> {
    return Array.from(this.errorPatterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
  }

  async generateHealthReport(): Promise<SystemHealth> {
    const recentEvents = this.getRecentEvents(60)
    const errors = recentEvents.filter((e) => e.type === "error")
    const successes = recentEvents.filter((e) => e.type === "success")

    const totalMessages = recentEvents.filter((e) => e.component === "WHATSAPP-PROCESSOR").length
    const successfulMessages = successes.filter((e) => e.component === "WHATSAPP-PROCESSOR").length
    const failedMessages = errors.filter((e) => e.component === "WHATSAPP-PROCESSOR").length

    const errorRate = totalMessages > 0 ? (failedMessages / totalMessages) * 100 : 0

    // Determinar estado de componentes
    const openaiErrors = errors.filter((e) => e.component.includes("OPENAI") || e.message.includes("openai"))
    const whatsappErrors = errors.filter((e) => e.component.includes("WHATSAPP") || e.message.includes("whatsapp"))
    const redisErrors = errors.filter((e) => e.component.includes("REDIS") || e.message.includes("redis"))

    const openaiStatus = this.determineComponentStatus(openaiErrors.length, totalMessages)
    const whatsappStatus = this.determineComponentStatus(whatsappErrors.length, totalMessages)
    const redisStatus = this.determineComponentStatus(redisErrors.length, totalMessages)

    const overallStatus = this.determineOverallStatus([openaiStatus, whatsappStatus, redisStatus])

    // Generar recomendaciones
    const recommendations = this.generateRecommendations(errors, errorRate, {
      openaiStatus,
      whatsappStatus,
      redisStatus,
    })

    return {
      timestamp: new Date().toISOString(),
      openaiStatus,
      whatsappStatus,
      redisStatus,
      overallStatus,
      metrics: {
        totalMessages,
        successfulMessages,
        failedMessages,
        averageResponseTime: 0, // TODO: Implementar medición de tiempo de respuesta
        errorRate,
      },
      errors: this.summarizeErrors(errors),
      recommendations,
    }
  }

  private determineComponentStatus(errorCount: number, totalOperations: number): "healthy" | "degraded" | "down" {
    if (totalOperations === 0) return "healthy"

    const errorRate = (errorCount / totalOperations) * 100

    if (errorRate > 50) return "down"
    if (errorRate > 10) return "degraded"
    return "healthy"
  }

  private determineOverallStatus(statuses: Array<"healthy" | "degraded" | "down">): "healthy" | "degraded" | "down" {
    if (statuses.includes("down")) return "down"
    if (statuses.includes("degraded")) return "degraded"
    return "healthy"
  }

  private summarizeErrors(
    errors: DiagnosticEvent[],
  ): Array<{ timestamp: string; type: string; message: string; count: number }> {
    const errorSummary = new Map<string, { timestamp: string; count: number }>()

    errors.forEach((error) => {
      const key = `${error.component}:${error.message}`
      if (errorSummary.has(key)) {
        errorSummary.get(key)!.count++
      } else {
        errorSummary.set(key, { timestamp: error.timestamp, count: 1 })
      }
    })

    return Array.from(errorSummary.entries()).map(([key, data]) => ({
      timestamp: data.timestamp,
      type: key.split(":")[0],
      message: key.split(":").slice(1).join(":"),
      count: data.count,
    }))
  }

  private generateRecommendations(
    errors: DiagnosticEvent[],
    errorRate: number,
    componentStatuses: { openaiStatus: string; whatsappStatus: string; redisStatus: string },
  ): string[] {
    const recommendations: string[] = []

    // Recomendaciones basadas en tasa de error
    if (errorRate > 20) {
      recommendations.push("🚨 Alta tasa de errores detectada. Revisar logs inmediatamente.")
    } else if (errorRate > 10) {
      recommendations.push("⚠️ Tasa de errores elevada. Monitorear de cerca.")
    }

    // Recomendaciones específicas por componente
    if (componentStatuses.openaiStatus === "down") {
      recommendations.push("🔴 OpenAI API no responde. Verificar conectividad y límites de rate.")
    } else if (componentStatuses.openaiStatus === "degraded") {
      recommendations.push("🟡 OpenAI API con problemas. Considerar reducir frecuencia de llamadas.")
    }

    if (componentStatuses.whatsappStatus === "down") {
      recommendations.push("🔴 WhatsApp API no responde. Verificar tokens y configuración.")
    } else if (componentStatuses.whatsappStatus === "degraded") {
      recommendations.push("🟡 WhatsApp API con problemas. Verificar límites de mensajes.")
    }

    if (componentStatuses.redisStatus === "down") {
      recommendations.push("🔴 Redis no disponible. Verificar conexión a base de datos.")
    }

    // Recomendaciones basadas en patrones de error
    const errorPatterns = this.getErrorPatterns()
    errorPatterns.slice(0, 3).forEach((pattern) => {
      if (pattern.count > 5) {
        recommendations.push(`🔍 Error recurrente detectado: ${pattern.pattern} (${pattern.count} veces)`)
      }
    })

    // Recomendaciones generales
    if (recommendations.length === 0) {
      recommendations.push("✅ Sistema funcionando correctamente.")
    }

    return recommendations
  }

  async runHealthCheck(): Promise<void> {
    const report = await this.generateHealthReport()

    console.log("=".repeat(80))
    console.log("🏥 REPORTE DE SALUD DEL SISTEMA")
    console.log("=".repeat(80))
    console.log(`📅 Timestamp: ${report.timestamp}`)
    console.log(`🌐 Estado General: ${this.getStatusEmoji(report.overallStatus)} ${report.overallStatus.toUpperCase()}`)
    console.log("")
    console.log("📊 ESTADO DE COMPONENTES:")
    console.log(`  🤖 OpenAI: ${this.getStatusEmoji(report.openaiStatus)} ${report.openaiStatus}`)
    console.log(`  💬 WhatsApp: ${this.getStatusEmoji(report.whatsappStatus)} ${report.whatsappStatus}`)
    console.log(`  🗄️  Redis: ${this.getStatusEmoji(report.redisStatus)} ${report.redisStatus}`)
    console.log("")
    console.log("📈 MÉTRICAS:")
    console.log(`  📨 Total Mensajes: ${report.metrics.totalMessages}`)
    console.log(`  ✅ Exitosos: ${report.metrics.successfulMessages}`)
    console.log(`  ❌ Fallidos: ${report.metrics.failedMessages}`)
    console.log(`  📊 Tasa de Error: ${report.metrics.errorRate.toFixed(2)}%`)
    console.log("")
    console.log("💡 RECOMENDACIONES:")
    report.recommendations.forEach((rec) => console.log(`  ${rec}`))
    console.log("=".repeat(80))
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case "healthy":
        return "🟢"
      case "degraded":
        return "🟡"
      case "down":
        return "🔴"
      default:
        return "⚪"
    }
  }
}

// Función para registrar eventos de diagnóstico
export function recordDiagnosticEvent(component: string, message: string, data?: any) {
  SystemDiagnostics.getInstance().logEvent("error", component, message, data)
}

// Función para obtener reporte de salud
export function getSystemHealthReport(): Promise<string> {
  return SystemDiagnostics.getInstance()
    .generateHealthReport()
    .then((report) => {
      const reportString = []
      reportString.push("=== REPORTE DE SALUD DEL SISTEMA ===")
      reportString.push(`Timestamp: ${report.timestamp}`)
      reportString.push("")

      // Estadísticas generales
      const totalEvents = report.metrics.totalMessages
      reportString.push(`Total de eventos registrados: ${totalEvents}`)

      // Errores por categoría
      reportString.push("\n=== ERRORES POR CATEGORÍA ===")
      report.errors.forEach((error) => {
        reportString.push(`${error.component}: ${error.message} (${error.count} veces)`)
      })

      // Recomendaciones
      reportString.push("\n=== RECOMENDACIONES ===")
      report.recommendations.forEach((rec) => reportString.push(`- ${rec}`))

      return reportString.join("\n")
    })
}

// Instancia global del sistema de diagnósticos
export const systemDiagnostics = new SystemDiagnostics()

// Función para ejecutar chequeo de salud automático
export async function runAutomaticHealthCheck() {
  try {
    await systemDiagnostics.runHealthCheck()
  } catch (error) {
    console.error("Error ejecutando chequeo de salud:", error)
  }
}

// Ejecutar chequeo de salud cada 15 minutos
if (typeof setInterval !== "undefined") {
  setInterval(runAutomaticHealthCheck, 15 * 60 * 1000)
}

export type { SystemHealth, DiagnosticEvent }
