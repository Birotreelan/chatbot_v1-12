import { type NextRequest, NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"
import type { ConversationAnalyticsResponse, ConsumptionSummary } from "@/lib/types"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const configId = searchParams.get("configId")
    const startDate = searchParams.get("startDate") // Expected format: YYYY-MM-DD
    const endDate = searchParams.get("endDate") // Expected format: YYYY-MM-DD
    const granularity = searchParams.get("granularity") || "DAILY"

    // Validar parámetros requeridos
    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate y endDate son requeridos" }, { status: 400 })
    }

    // Obtener todas las configuraciones y buscar la especificada
    const configs = await getAllWhatsAppConfigs()
    const config = configs.find((c) => c.id === configId)

    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Validar que tenga wabaId y accessToken
    if (!config.wabaId || !config.accessToken) {
      return NextResponse.json(
        { error: "La configuración no tiene wabaId o accessToken configurados" },
        { status: 400 },
      )
    }

    // Convertir fechas a UNIX timestamps
    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000)
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000)

    // Construir la URL de la API de Meta
    const fields = `conversation_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${granularity}).dimensions(["CONVERSATION_CATEGORY","COUNTRY","CONVERSATION_TYPE","CONVERSATION_DIRECTION"])`
    const metaApiUrl = `https://graph.facebook.com/v18.0/${config.wabaId}?fields=${encodeURIComponent(fields)}`

    console.log("[Analytics] Consultando Meta API:", metaApiUrl)

    // Llamar a la API de Meta
    const response = await fetch(metaApiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("[Analytics] Error de Meta API:", errorData)
      return NextResponse.json(
        { error: "Error al consultar la API de Meta", details: errorData },
        { status: response.status },
      )
    }

    const data: ConversationAnalyticsResponse = await response.json()

    // Procesar y estructurar los datos
    const summary = processAnalyticsData(data, startDate, endDate)

    return NextResponse.json(summary)
  } catch (error) {
    console.error("[Analytics] Error al obtener consumo:", error)
    return NextResponse.json(
      {
        error: "Error interno al procesar analíticas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

function processAnalyticsData(
  data: ConversationAnalyticsResponse,
  startDate: string,
  endDate: string,
): ConsumptionSummary {
  const summary: ConsumptionSummary = {
    totalConversations: 0,
    totalCost: 0,
    messagesSent: 0,
    messagesDelivered: 0,
    byCategory: {
      authentication: { count: 0, cost: 0 },
      marketing: { count: 0, cost: 0 },
      service: { count: 0, cost: 0 },
      utility: { count: 0, cost: 0 },
    },
    byCountry: {},
    periodStart: startDate,
    periodEnd: endDate,
    currency: "USD",
  }

  // Si no hay datos, retornar el resumen vacío
  if (!data.conversation_analytics?.data?.[0]?.data_points) {
    return summary
  }

  const dataPoints = data.conversation_analytics.data[0].data_points

  dataPoints.forEach((point) => {
    const count = point.conversation || 0
    const cost = point.cost || 0
    const category = point.conversation_category?.toLowerCase() as keyof typeof summary.byCategory
    const country = point.country || "Unknown"

    // Totales
    summary.totalConversations += count
    summary.totalCost += cost

    // Por categoría
    if (category && summary.byCategory[category]) {
      summary.byCategory[category].count += count
      summary.byCategory[category].cost += cost
    }

    // Por país
    if (!summary.byCountry[country]) {
      summary.byCountry[country] = { count: 0, cost: 0 }
    }
    summary.byCountry[country].count += count
    summary.byCountry[country].cost += cost
  })

  return summary
}
