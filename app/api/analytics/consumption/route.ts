import { type NextRequest, NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"
import type { ConversationAnalyticsResponse, ConsumptionSummary } from "@/lib/types"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const configId = searchParams.get("configId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const granularity = searchParams.get("granularity") || "DAILY"

    console.log("[v0 Analytics] Iniciando consulta con parámetros:", {
      configId,
      startDate,
      endDate,
      granularity,
    })

    // Validar parámetros requeridos
    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate y endDate son requeridos" }, { status: 400 })
    }

    // Obtener todas las configuraciones y buscar la especificada
    const configs = await getAllWhatsAppConfigs()
    console.log("[v0 Analytics] Total de configuraciones encontradas:", configs.length)

    const config = configs.find((c) => c.id === configId)

    if (!config) {
      console.log("[v0 Analytics] Configuración no encontrada. ID buscado:", configId)
      console.log(
        "[v0 Analytics] IDs disponibles:",
        configs.map((c) => c.id),
      )
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log("[v0 Analytics] Configuración encontrada:", {
      id: config.id,
      displayName: config.displayName,
      wabaId: config.wabaId,
      hasAccessToken: !!config.accessToken,
      tokenLength: config.accessToken?.length || 0,
    })

    // Validar que tenga wabaId y accessToken
    if (!config.wabaId || !config.accessToken) {
      console.log("[v0 Analytics] Configuración incompleta:", {
        hasWabaId: !!config.wabaId,
        hasAccessToken: !!config.accessToken,
      })
      return NextResponse.json(
        { error: "La configuración no tiene wabaId o accessToken configurados" },
        { status: 400 },
      )
    }

    // Convertir fechas a UNIX timestamps
    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000)
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000)

    console.log("[v0 Analytics] Timestamps calculados:", {
      startDate,
      endDate,
      startTimestamp,
      endTimestamp,
    })

    // Construir URL para analytics de mensajería
    const messagingFields = `analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${granularity}).phone_numbers(["${config.phoneNumberId}"])`
    const messagingUrl = `https://graph.facebook.com/v18.0/${config.wabaId}?fields=${encodeURIComponent(messagingFields)}`

    console.log("[v0 Analytics] Intentando primero con messaging analytics...")
    console.log("[v0 Analytics] URL de Messaging API:", messagingUrl)

    // Probar analytics de mensajería
    const messagingResponse = await fetch(messagingUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    })

    console.log("[v0 Analytics] Respuesta de Messaging API:", {
      status: messagingResponse.status,
      statusText: messagingResponse.statusText,
      ok: messagingResponse.ok,
    })

    let messagingData = null
    if (messagingResponse.ok) {
      messagingData = await messagingResponse.json()
      console.log("[v0 Analytics] 🔍 RESPUESTA COMPLETA DE MESSAGING API:")
      console.log(JSON.stringify(messagingData, null, 2))
    } else {
      const errorText = await messagingResponse.text()
      console.log("[v0 Analytics] Error en Messaging API:", errorText)
    }

    // Construir la URL de conversation analytics
    const fields = `conversation_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${granularity}).dimensions(["CONVERSATION_CATEGORY","COUNTRY","CONVERSATION_TYPE"])`
    const metaApiUrl = `https://graph.facebook.com/v18.0/${config.wabaId}?fields=${encodeURIComponent(fields)}`

    console.log("[v0 Analytics] Intentando con conversation analytics...")
    console.log("[v0 Analytics] URL de Conversation API:", metaApiUrl)
    console.log("[v0 Analytics] WABA ID usado:", config.wabaId)

    // Llamar a la API de Meta para conversation analytics
    const response = await fetch(metaApiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    })

    console.log("[v0 Analytics] Respuesta de Conversation API:", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error("[v0 Analytics] Error de Meta API:", errorData)

      // Intentar parsear el error
      let parsedError
      try {
        parsedError = JSON.parse(errorData)
      } catch {
        parsedError = { message: errorData }
      }

      return NextResponse.json(
        {
          error: "Error al consultar la API de Meta",
          details: parsedError,
          statusCode: response.status,
          wabaId: config.wabaId,
        },
        { status: response.status },
      )
    }

    const data: ConversationAnalyticsResponse = await response.json()

    console.log("[v0 Analytics] 🔍 RESPUESTA COMPLETA DE CONVERSATION API:")
    console.log(JSON.stringify(data, null, 2))

    console.log("[v0 Analytics] Datos recibidos de Meta:", {
      hasConversationAnalytics: !!data.conversation_analytics,
      hasData: !!data.conversation_analytics?.data,
      dataLength: data.conversation_analytics?.data?.length || 0,
      dataPointsCount: data.conversation_analytics?.data?.[0]?.data_points?.length || 0,
    })

    // Log completo de los datos para debugging
    if (data.conversation_analytics?.data?.[0]?.data_points) {
      console.log(
        "[v0 Analytics] Primeros 3 data points:",
        JSON.stringify(data.conversation_analytics.data[0].data_points.slice(0, 3), null, 2),
      )
    }

    // Procesar y estructurar los datos
    const summary = processAnalyticsData(data, messagingData, startDate, endDate)

    console.log("[v0 Analytics] Resumen procesado:", {
      totalConversations: summary.totalConversations,
      totalCost: summary.totalCost,
      categories: Object.keys(summary.byCategory).map((key) => ({
        category: key,
        count: summary.byCategory[key as keyof typeof summary.byCategory].count,
      })),
      countries: Object.keys(summary.byCountry).length,
    })

    return NextResponse.json(summary)
  } catch (error) {
    console.error("[v0 Analytics] Error al obtener consumo:", error)
    console.error("[v0 Analytics] Stack trace:", error instanceof Error ? error.stack : "No stack trace")
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
  messagingData: any,
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

  if (messagingData?.analytics?.data?.[0]?.data_points) {
    console.log("[v0 Analytics] Procesando datos de messaging...")
    messagingData.analytics.data[0].data_points.forEach((point: any) => {
      summary.messagesSent += point.sent || 0
      summary.messagesDelivered += point.delivered || 0
    })
    console.log("[v0 Analytics] Mensajes procesados:", {
      sent: summary.messagesSent,
      delivered: summary.messagesDelivered,
    })
  }

  // Si no hay datos de conversaciones, retornar el resumen con datos de messaging
  if (!data.conversation_analytics?.data?.[0]?.data_points) {
    console.log("[v0 Analytics] No hay data_points de conversaciones en la respuesta")
    console.log("[v0 Analytics] ⚠️ Posibles razones:")
    console.log("  1. No hay conversaciones en el período seleccionado")
    console.log("  2. El token no tiene permisos de whatsapp_business_management")
    console.log("  3. El WABA ID es incorrecto")
    console.log("  4. Las analíticas de conversaciones no están disponibles para esta cuenta")
    return summary
  }

  const dataPoints = data.conversation_analytics.data[0].data_points

  console.log("[v0 Analytics] Procesando", dataPoints.length, "data points de conversaciones")

  dataPoints.forEach((point, index) => {
    const count = point.conversation || 0
    const cost = point.cost || 0
    const category = point.conversation_category?.toLowerCase() as keyof typeof summary.byCategory
    const country = point.country || "Unknown"

    if (index < 5) {
      console.log(`[v0 Analytics] Data point ${index}:`, {
        count,
        cost,
        category,
        country,
        rawPoint: point,
      })
    }

    // Totales
    summary.totalConversations += count
    summary.totalCost += cost

    // Por categoría
    if (category && summary.byCategory[category]) {
      summary.byCategory[category].count += count
      summary.byCategory[category].cost += cost
    } else if (category) {
      console.log(`[v0 Analytics] Categoría desconocida: ${category}`)
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
