import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { getMetrics } from "@/lib/monitoring"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Expone el consumo de tokens de OpenAI.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET() {
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    // Obtener métricas relacionadas con tokens y OpenAI
    const messagesReceived = await getMetrics("messages_received")
    const messagesProcessed = await getMetrics("messages_processed")
    const messagesSent = await getMetrics("messages_sent")
    const errors = await getMetrics("errors")
    const openaiErrors = await getMetrics("error:openai")
    const toolsExecuted = await getMetrics("tools_executed")

    // Calcular estadísticas
    const totalMessages = Object.values(messagesReceived).reduce((sum, val) => sum + Number(val), 0)
    const totalProcessed = Object.values(messagesProcessed).reduce((sum, val) => sum + Number(val), 0)
    const totalSent = Object.values(messagesSent).reduce((sum, val) => sum + Number(val), 0)
    const totalErrors = Object.values(errors).reduce((sum, val) => sum + Number(val), 0)
    const totalOpenAIErrors = Object.values(openaiErrors).reduce((sum, val) => sum + Number(val), 0)
    const totalToolsExecuted = Object.values(toolsExecuted).reduce((sum, val) => sum + Number(val), 0)

    // Calcular tasas
    const successRate = totalMessages > 0 ? ((totalProcessed / totalMessages) * 100).toFixed(2) : "0"
    const errorRate = totalMessages > 0 ? ((totalErrors / totalMessages) * 100).toFixed(2) : "0"
    const toolUsageRate = totalProcessed > 0 ? ((totalToolsExecuted / totalProcessed) * 100).toFixed(2) : "0"

    return NextResponse.json({
      success: true,
      stats: {
        messages: {
          received: totalMessages,
          processed: totalProcessed,
          sent: totalSent,
          successRate: `${successRate}%`,
        },
        errors: {
          total: totalErrors,
          openai: totalOpenAIErrors,
          errorRate: `${errorRate}%`,
        },
        tools: {
          executed: totalToolsExecuted,
          usageRate: `${toolUsageRate}%`,
        },
        recommendations: [
          totalToolsExecuted > totalProcessed * 0.8 && "Alto uso de herramientas - considerar optimizar respuestas",
          totalOpenAIErrors > totalErrors * 0.5 && "Muchos errores de OpenAI - revisar configuración",
          Number(errorRate) > 10 && "Tasa de errores alta - revisar logs",
          Number(successRate) < 90 && "Tasa de éxito baja - revisar sistema",
        ].filter(Boolean),
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error al obtener estadísticas de tokens:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
