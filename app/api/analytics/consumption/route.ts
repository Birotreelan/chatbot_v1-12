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
      phoneNumberId: config.phoneNumberId,
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

    const startTimestamp = Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000)
    const endTimestamp = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)

    // Verificar que las fechas sean razonables (no en el futuro, no más de 1 año atrás)
    const now = Math.floor(Date.now() / 1000)
    const oneYearAgo = now - 365 * 24 * 60 * 60
    // Permitir hasta 24 horas en el futuro para manejar el día actual
    const maxFutureTimestamp = now + 24 * 60 * 60

    console.log("[v0 Analytics] Timestamps calculados:", {
      startDate,
      endDate,
      startTimestamp,
      endTimestamp,
      now,
      oneYearAgo,
      isStartInFuture: startTimestamp > maxFutureTimestamp,
      isEndInFuture: endTimestamp > maxFutureTimestamp,
      isStartTooOld: startTimestamp < oneYearAgo,
    })

    if (startTimestamp > maxFutureTimestamp) {
      console.log("[v0 Analytics] ⚠️ ERROR: La fecha de inicio está demasiado en el futuro!")
      return NextResponse.json(
        {
          error: "La fecha de inicio no puede estar en el futuro",
          details: {
            startDate,
            startTimestamp,
            currentTimestamp: now,
          },
        },
        { status: 400 },
      )
    }

    if (endTimestamp > maxFutureTimestamp) {
      console.log("[v0 Analytics] ⚠️ ERROR: La fecha de fin está demasiado en el futuro!")
      return NextResponse.json(
        {
          error: "La fecha de fin no puede estar en el futuro",
          details: {
            endDate,
            endTimestamp,
            currentTimestamp: now,
          },
        },
        { status: 400 },
      )
    }

    if (startTimestamp < oneYearAgo || endTimestamp < oneYearAgo) {
      console.log("[v0 Analytics] ⚠️ ADVERTENCIA: Las fechas están más de 1 año atrás!")
      return NextResponse.json(
        {
          error: "Las fechas no pueden estar más de 1 año atrás",
          details: {
            startDate,
            endDate,
            startTimestamp,
            endTimestamp,
            oneYearAgoTimestamp: oneYearAgo,
          },
        },
        { status: 400 },
      )
    }

    // Messaging analytics usa: DAY, MONTH, HALF_HOUR
    // Conversation analytics usa: DAILY, MONTHLY, HALF_HOUR
    const messagingGranularity = granularity === "DAILY" ? "DAY" : granularity === "MONTHLY" ? "MONTH" : "HALF_HOUR"
    const conversationGranularity = granularity // Ya viene en formato correcto desde el cliente

    console.log("[v0 Analytics] Granularidad ajustada:", {
      original: granularity,
      messaging: messagingGranularity,
      conversation: conversationGranularity,
    })

    // Intentar primero conversation analytics (es lo más importante para costos)
    const messagingFields = `analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${messagingGranularity}).phone_numbers([])`
    const messagingUrl = `https://graph.facebook.com/v18.0/${config.wabaId}?fields=${messagingFields}&access_token=${config.accessToken}`

    console.log("[v0 Analytics] =================================")
    console.log("[v0 Analytics] Consultando Messaging Analytics primero para obtener el número de teléfono...")
    console.log("[v0 Analytics] URL completa:", messagingUrl.replace(config.accessToken, "TOKEN_OCULTO"))
    console.log("[v0 Analytics] =================================")

    const messagingResponse = await fetch(messagingUrl, {
      method: "GET",
    })

    console.log("[v0 Analytics] Respuesta de Messaging API:", {
      status: messagingResponse.status,
      statusText: messagingResponse.statusText,
      ok: messagingResponse.ok,
    })

    let messagingData = null
    let phoneNumber = null

    if (messagingResponse.ok) {
      messagingData = await messagingResponse.json()
      console.log("[v0 Analytics] 📨 RESPUESTA MESSAGING API:")
      console.log(JSON.stringify(messagingData, null, 2))

      // Extraer el número de teléfono de la respuesta
      if (messagingData?.analytics?.phone_numbers?.[0]) {
        phoneNumber = messagingData.analytics.phone_numbers[0]
        console.log("[v0 Analytics] ✅ Número de teléfono detectado:", phoneNumber)
      }
    } else {
      const errorText = await messagingResponse.text()
      console.log("[v0 Analytics] ❌ Error en Messaging API:", errorText)
    }

    // Según docs oficiales, necesitamos: dimensions, metric_types, y el número específico
    // Los parámetros deben ir sin corchetes, separados por comas
    const conversationFields = phoneNumber
      ? `conversation_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${conversationGranularity}).phone_numbers(${phoneNumber})`
      : `conversation_analytics.start(${startTimestamp}).end(${endTimestamp}).granularity(${conversationGranularity})`

    const conversationUrl = `https://graph.facebook.com/v18.0/${config.wabaId}?fields=${conversationFields}&access_token=${config.accessToken}`

    console.log("[v0 Analytics] =================================")
    console.log("[v0 Analytics] Consultando Conversation Analytics...")
    console.log("[v0 Analytics] WABA ID:", config.wabaId)
    console.log("[v0 Analytics] Phone Number:", phoneNumber || "all")
    console.log("[v0 Analytics] Fields:", conversationFields)
    console.log("[v0 Analytics] URL completa:", conversationUrl.replace(config.accessToken, "TOKEN_OCULTO"))
    console.log("[v0 Analytics] =================================")

    const conversationResponse = await fetch(conversationUrl, {
      method: "GET",
    })

    console.log("[v0 Analytics] Respuesta de Conversation API:", {
      status: conversationResponse.status,
      statusText: conversationResponse.statusText,
      ok: conversationResponse.ok,
    })

    let conversationData: ConversationAnalyticsResponse | null = null
    let conversationError = null

    if (conversationResponse.ok) {
      conversationData = await conversationResponse.json()
      console.log("[v0 Analytics] 🎯 RESPUESTA CONVERSATION API:")
      console.log(JSON.stringify(conversationData, null, 2))
    } else {
      const errorText = await conversationResponse.text()
      console.log("[v0 Analytics] ❌ Error en Conversation API:", errorText)
      try {
        conversationError = JSON.parse(errorText)
      } catch {
        conversationError = { message: errorText }
      }
    }

    // Si ambas APIs fallaron, retornar error
    if (!conversationData && conversationError) {
      return NextResponse.json(
        {
          error: "Error al consultar la API de Meta",
          details: conversationError,
          statusCode: conversationResponse.status,
          wabaId: config.wabaId,
        },
        { status: conversationResponse.status },
      )
    }

    // Procesar y estructurar los datos
    const summary = processAnalyticsData(conversationData, messagingData, startDate, endDate)

    console.log("[v0 Analytics] ✅ Resumen procesado:", {
      totalConversations: summary.totalConversations,
      totalCost: summary.totalCost,
      messagesSent: summary.messagesSent,
      messagesDelivered: summary.messagesDelivered,
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
  data: ConversationAnalyticsResponse | null,
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

  if (messagingData?.analytics?.data_points) {
    console.log("[v0 Analytics] Procesando datos de messaging desde data_points...")
    messagingData.analytics.data_points.forEach((point: any) => {
      summary.messagesSent += point.sent || 0
      summary.messagesDelivered += point.delivered || 0
    })
    console.log("[v0 Analytics] Mensajes procesados:", {
      sent: summary.messagesSent,
      delivered: summary.messagesDelivered,
    })
  }

  // La estructura según docs oficiales es: conversation_analytics.data.data_points
  const conversationDataPoints = data?.conversation_analytics?.data?.data_points

  if (!conversationDataPoints || conversationDataPoints.length === 0) {
    console.log("[v0 Analytics] ⚠️ No hay data_points de conversaciones en la respuesta")
    console.log("[v0 Analytics] Estructura recibida:", JSON.stringify(data?.conversation_analytics, null, 2))
    console.log("[v0 Analytics] Nota: Los datos de mensajería están disponibles")
    console.log("[v0 Analytics] Posibles razones para no tener datos de conversaciones:")
    console.log("  1. La cuenta usa facturación por mensajes (modelo antiguo)")
    console.log("  2. No hay conversaciones en el período seleccionado")
    console.log("  3. El token no tiene permisos de analytics completos")
    console.log("  4. La cuenta factura a través de un BSP")
    return summary
  }

  console.log("[v0 Analytics] ✅ Procesando", conversationDataPoints.length, "data points de conversaciones")

  conversationDataPoints.forEach((point, index) => {
    const count = point.conversation || 0
    const cost = point.cost || 0
    const category = point.conversation_category?.toLowerCase() as keyof typeof summary.byCategory
    const country = point.country || "Unknown"

    if (index < 3) {
      console.log(`[v0 Analytics] Data point ${index}:`, {
        count,
        cost,
        category,
        country,
        type: point.conversation_type,
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
      console.log(`[v0 Analytics] ⚠️ Categoría desconocida: ${category}`)
    }

    // Por país
    if (!summary.byCountry[country]) {
      summary.byCountry[country] = { count: 0, cost: 0 }
    }
    summary.byCountry[country].count += count
    summary.byCountry[country].cost += cost
  })

  console.log("[v0 Analytics] ✅ Procesamiento completado")

  return summary
}
