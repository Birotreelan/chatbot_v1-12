// Sistema de diagnóstico avanzado
export class SystemDiagnostics {
  private static instance: SystemDiagnostics
  private diagnosticData: Map<string, any> = new Map()

  static getInstance(): SystemDiagnostics {
    if (!SystemDiagnostics.instance) {
      SystemDiagnostics.instance = new SystemDiagnostics()
    }
    return SystemDiagnostics.instance
  }

  // Registrar evento de diagnóstico
  recordEvent(category: string, event: string, data?: any) {
    const timestamp = new Date().toISOString()
    const key = `${category}:${event}`

    if (!this.diagnosticData.has(key)) {
      this.diagnosticData.set(key, [])
    }

    this.diagnosticData.get(key).push({
      timestamp,
      data,
    })

    // Mantener solo los últimos 100 eventos por categoría
    const events = this.diagnosticData.get(key)
    if (events.length > 100) {
      events.splice(0, events.length - 100)
    }

    console.log(`[DIAGNOSTICS] ${category}:${event}`, data)
  }

  // Obtener eventos de diagnóstico
  getEvents(category?: string): any {
    if (category) {
      const events = {}
      for (const [key, value] of this.diagnosticData.entries()) {
        if (key.startsWith(category)) {
          events[key] = value
        }
      }
      return events
    }
    return Object.fromEntries(this.diagnosticData)
  }

  // Autodiagnóstico del sistema
  async runSystemDiagnostics(): Promise<{
    status: "healthy" | "warning" | "critical"
    issues: string[]
    recommendations: string[]
  }> {
    const issues: string[] = []
    const recommendations: string[] = []

    // Verificar errores recientes
    const recentErrors = this.getRecentErrors()
    if (recentErrors.length > 10) {
      issues.push(`${recentErrors.length} errores en los últimos 10 minutos`)
      recommendations.push("Revisar logs de errores y corregir problemas recurrentes")
    }

    // Verificar parámetros de OpenAI
    const openaiErrors = recentErrors.filter((e) =>
      e.message?.includes("Path parameters result in path with invalid segments"),
    )
    if (openaiErrors.length > 0) {
      issues.push("Errores de parámetros en llamadas a OpenAI API")
      recommendations.push("Verificar orden de parámetros en openai.beta.threads.runs.retrieve()")
    }

    // Verificar runs activos
    const activeRunErrors = recentErrors.filter(
      (e) =>
        e.message?.includes("Can't add messages to thread") &&
        e.message?.includes("while a run") &&
        e.message?.includes("is active"),
    )
    if (activeRunErrors.length > 0) {
      issues.push("Múltiples errores de runs activos")
      recommendations.push("Implementar mejor cancelación de runs activos antes de crear nuevos")
    }

    // Determinar estado del sistema
    let status: "healthy" | "warning" | "critical" = "healthy"
    if (issues.length > 0) {
      status = issues.length > 3 ? "critical" : "warning"
    }

    return {
      status,
      issues,
      recommendations,
    }
  }

  // Obtener errores recientes
  private getRecentErrors(): any[] {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const errors: any[] = []

    for (const [key, events] of this.diagnosticData.entries()) {
      if (key.includes("error")) {
        const recentEvents = events.filter((e: any) => new Date(e.timestamp) > tenMinutesAgo)
        errors.push(...recentEvents)
      }
    }

    return errors
  }

  // Generar reporte de salud del sistema
  generateHealthReport(): string {
    const report = []
    report.push("=== REPORTE DE SALUD DEL SISTEMA ===")
    report.push(`Timestamp: ${new Date().toISOString()}`)
    report.push("")

    // Estadísticas generales
    const totalEvents = Array.from(this.diagnosticData.values()).reduce((sum, events) => sum + events.length, 0)
    report.push(`Total de eventos registrados: ${totalEvents}`)

    // Errores por categoría
    report.push("\n=== ERRORES POR CATEGORÍA ===")
    for (const [key, events] of this.diagnosticData.entries()) {
      if (key.includes("error")) {
        report.push(`${key}: ${events.length} eventos`)
      }
    }

    // Recomendaciones
    const diagnostics = this.runSystemDiagnostics()
    diagnostics.then((result) => {
      report.push(`\n=== ESTADO DEL SISTEMA: ${result.status.toUpperCase()} ===`)
      if (result.issues.length > 0) {
        report.push("\nProblemas detectados:")
        result.issues.forEach((issue) => report.push(`- ${issue}`))
      }
      if (result.recommendations.length > 0) {
        report.push("\nRecomendaciones:")
        result.recommendations.forEach((rec) => report.push(`- ${rec}`))
      }
    })

    return report.join("\n")
  }
}

// Función para registrar eventos de diagnóstico
export function recordDiagnosticEvent(category: string, event: string, data?: any) {
  SystemDiagnostics.getInstance().recordEvent(category, event, data)
}

// Función para obtener reporte de salud
export function getSystemHealthReport(): string {
  return SystemDiagnostics.getInstance().generateHealthReport()
}
