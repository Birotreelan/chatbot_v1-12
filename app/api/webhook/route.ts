import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import { handleMessage } from "@/lib/whatsapp"
import { enqueueMessage } from "@/lib/queue"
import { incrementMetric, logError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"

// Permitir que la función se ejecute durante más tiempo
export const maxDuration = 60

// Manejar la verificación del webhook (GET)
export async function GET(req: Request) {
  console.log("[WEBHOOK-GET] ========== VERIFICACIÓN WEBHOOK ==========")
  console.log("[WEBHOOK-GET] Timestamp:", new Date().toISOString())

  try {
    const url = new URL(req.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")
    const phoneNumberId = url.searchParams.get("phone_number_id")

    console.log("[WEBHOOK-GET] Parámetros recibidos:", {
      mode,
      token: token?.substring(0, 3) + "***",
      challenge: challenge?.substring(0, 10) + "...",
      phoneNumberId,
      fullUrl: req.url,
    })

    // Si se proporciona un phoneNumberId, verificar con la configuración específica
    if (phoneNumberId) {
      console.log(`[WEBHOOK-GET] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
      const config = await getWhatsAppConfigByPhoneId(phoneNumberId)

      if (config) {
        console.log(`[WEBHOOK-GET] Configuración encontrada: ${config.displayName}`)
        if (mode === "subscribe" && token === config.verifyToken) {
          console.log(`[WEBHOOK-GET] ✅ Verificación exitosa para phoneNumberId=${phoneNumberId}`)
          return new Response(challenge, { status: 200 })
        } else {
          console.log(
            `[WEBHOOK-GET] ❌ Token no coincide. Esperado: ${config.verifyToken?.substring(0, 3)}***, Recibido: ${token?.substring(0, 3)}***`,
          )
        }
      } else {
        console.log(`[WEBHOOK-GET] ❌ No se encontró configuración para phoneNumberId: ${phoneNumberId}`)
      }
    } else {
      // Si no se proporciona phoneNumberId, verificar con el token global
      console.log(`[WEBHOOK-GET] Verificando con token global`)
      const globalToken = process.env.WHATSAPP_VERIFY_TOKEN
      console.log(`[WEBHOOK-GET] Token global disponible: ${!!globalToken}`)

      if (mode === "subscribe" && token === globalToken) {
        console.log(`[WEBHOOK-GET] ✅ Verificación exitosa con token global`)
        return new Response(challenge, { status: 200 })
      } else {
        console.log(`[WEBHOOK-GET] ❌ Token global no coincide`)
        console.log(
          `[WEBHOOK-GET] Esperado: ${globalToken?.substring(0, 3)}***, Recibido: ${token?.substring(0, 3)}***`,
        )
      }
    }

    console.log(`[WEBHOOK-GET] ❌ Verificación fallida`)
    return new Response("Verification failed", { status: 403 })
  } catch (error) {
    console.error("[WEBHOOK-GET] ❌ Error en verificación:", error)
    await logError("webhook_verification", error instanceof Error ? error : new Error(String(error)))
    return new Response("Error processing verification", { status: 500 })
  }
}

// Manejar los mensajes entrantes (POST)
export async function POST(req: Request) {
  // LOGS INMEDIATOS PARA DEBUG
  console.log("=".repeat(80))
  console.log("[WEBHOOK-POST] ========== MENSAJE ENTRANTE ==========")
  console.log("[WEBHOOK-POST] Timestamp:", new Date().toISOString())
  console.log("[WEBHOOK-POST] URL:", req.url)
  console.log("[WEBHOOK-POST] Method:", req.method)
  console.log("=".repeat(80))

  try {
    // Obtener headers importantes
    const headers = {
      ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      contentType: req.headers.get("content-type") || "unknown",
      authorization: req.headers.get("authorization") || "none",
    }

    console.log(`[WEBHOOK-POST] Headers:`, headers)

    // Aplicar rate limiting básico
    console.log(`[WEBHOOK-POST] Aplicando rate limiting para IP: ${headers.ip}`)
    try {
      const rateLimitResult = await rateLimit(`ip:${headers.ip}`)
      if (!rateLimitResult.success) {
        console.warn(`[WEBHOOK-POST] ⚠️ Solicitud limitada por tasa para IP: ${headers.ip}`)
        return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
      }
      console.log(`[WEBHOOK-POST] ✅ Rate limiting pasado`)
    } catch (rateLimitError) {
      console.error(`[WEBHOOK-POST] Error en rate limiting:`, rateLimitError)
      // Continuar sin rate limiting si falla
    }

    // Procesar el cuerpo de la solicitud
    console.log(`[WEBHOOK-POST] Leyendo cuerpo de la solicitud...`)
    let body: any
    try {
      const rawBody = await req.text()
      console.log(`[WEBHOOK-POST] Raw body length: ${rawBody.length}`)
      console.log(`[WEBHOOK-POST] Raw body preview: ${rawBody.substring(0, 500)}...`)

      body = JSON.parse(rawBody)
      console.log(`[WEBHOOK-POST] Body parseado exitosamente`)
    } catch (parseError) {
      console.error(`[WEBHOOK-POST] Error parseando JSON:`, parseError)
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    console.log(`[WEBHOOK-POST] Cuerpo completo:`, JSON.stringify(body, null, 2))

    // Verificar si es un mensaje de WhatsApp
    if (body.object !== "whatsapp_business_account") {
      console.warn(`[WEBHOOK-POST] ⚠️ Objeto no reconocido: ${body.object}`)
      console.log(`[WEBHOOK-POST] Estructura del body:`, Object.keys(body))
      return NextResponse.json({ success: false, error: "Not a WhatsApp message" }, { status: 400 })
    }
    console.log(`[WEBHOOK-POST] ✅ Objeto WhatsApp válido`)

    // Incrementar métrica de mensajes recibidos
    try {
      await incrementMetric("messages_received")
      console.log(`[WEBHOOK-POST] ✅ Métrica incrementada`)
    } catch (metricError) {
      console.error(`[WEBHOOK-POST] Error incrementando métrica:`, metricError)
    }

    // Procesar cada entrada y cambio
    const entries = body.entry || []
    console.log(`[WEBHOOK-POST] Procesando ${entries.length} entradas`)

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex]
      console.log(`[WEBHOOK-POST] === Procesando entry ${entryIndex + 1}/${entries.length} ===`)
      console.log(`[WEBHOOK-POST] Entry:`, JSON.stringify(entry, null, 2))

      const changes = entry.changes || []
      console.log(`[WEBHOOK-POST] Entry tiene ${changes.length} cambios`)

      for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
        const change = changes[changeIndex]
        console.log(`[WEBHOOK-POST] --- Procesando change ${changeIndex + 1}/${changes.length} ---`)
        console.log(`[WEBHOOK-POST] Change field: ${change.field}`)
        console.log(`[WEBHOOK-POST] Change:`, JSON.stringify(change, null, 2))

        if (change.field === "messages" && change.value && change.value.messages && change.value.messages.length > 0) {
          const phoneNumberId = change.value.metadata?.phone_number_id
          const messages = change.value.messages
          const firstMessage = messages[0]
          const userPhoneNumber = firstMessage?.from
          const messageText = firstMessage?.text?.body || "Sin texto"
          const messageType = firstMessage?.type

          console.log(`[WEBHOOK-POST] 📱 MENSAJE DETECTADO:`)
          console.log(`[WEBHOOK-POST] - PhoneNumberId: ${phoneNumberId}`)
          console.log(`[WEBHOOK-POST] - De: ${userPhoneNumber}`)
          console.log(`[WEBHOOK-POST] - Tipo: ${messageType}`)
          console.log(`[WEBHOOK-POST] - Texto: "${messageText}"`)
          console.log(`[WEBHOOK-POST] - ID: ${firstMessage?.id}`)
          console.log(`[WEBHOOK-POST] - Timestamp: ${firstMessage?.timestamp}`)

          if (!phoneNumberId) {
            console.error(`[WEBHOOK-POST] ❌ phoneNumberId faltante en metadata`)
            continue
          }

          if (!userPhoneNumber) {
            console.error(`[WEBHOOK-POST] ❌ Número de teléfono del usuario faltante`)
            continue
          }

          // Obtener la configuración de WhatsApp
          console.log(`[WEBHOOK-POST] 🔍 Buscando configuración para phoneNumberId: ${phoneNumberId}`)
          let config
          try {
            config = await getWhatsAppConfigByPhoneId(phoneNumberId)
          } catch (configError) {
            console.error(`[WEBHOOK-POST] ❌ Error obteniendo configuración:`, configError)
            continue
          }

          if (!config) {
            console.error(`[WEBHOOK-POST] ❌ Configuración no encontrada para phoneNumberId=${phoneNumberId}`)

            // Debug: Listar todas las configuraciones disponibles
            try {
              const { getAllWhatsAppConfigs } = await import("@/lib/db")
              const allConfigs = await getAllWhatsAppConfigs()
              console.log(`[WEBHOOK-POST] 🔍 Configuraciones disponibles (${allConfigs.length}):`)
              allConfigs.forEach((cfg, index) => {
                console.log(`[WEBHOOK-POST]   ${index + 1}. ID: ${cfg.id}`)
                console.log(`[WEBHOOK-POST]      PhoneNumberId: ${cfg.phoneNumberId}`)
                console.log(`[WEBHOOK-POST]      DisplayName: ${cfg.displayName}`)
                console.log(`[WEBHOOK-POST]      Active: ${cfg.active}`)
              })
            } catch (debugError) {
              console.error(`[WEBHOOK-POST] Error obteniendo configuraciones para debug:`, debugError)
            }

            continue
          }

          console.log(`[WEBHOOK-POST] ✅ Configuración encontrada:`)
          console.log(`[WEBHOOK-POST] - ID: ${config.id}`)
          console.log(`[WEBHOOK-POST] - DisplayName: ${config.displayName}`)
          console.log(`[WEBHOOK-POST] - ClienteId: ${config.cliente_id}`)
          console.log(`[WEBHOOK-POST] - AssistantId: ${config.whatsappAssistantId}`)
          console.log(`[WEBHOOK-POST] - Active: ${config.active}`)

          if (!config.active) {
            console.warn(`[WEBHOOK-POST] ⚠️ Configuración inactiva, ignorando mensaje`)
            continue
          }

          // Determinar método de procesamiento
          const useQStash = process.env.USE_QSTASH === "true"
          console.log(
            `[WEBHOOK-POST] Método de procesamiento: ${useQStash ? "QStash (asíncrono)" : "Directo (síncrono)"}`,
          )

          try {
            if (useQStash) {
              // Encolar el mensaje para procesamiento asíncrono
              console.log(`[WEBHOOK-POST] 📤 Encolando mensaje para procesamiento asíncrono`)
              const result = await enqueueMessage(change.value)
              if (result.success && result.messageId) {
                console.log(`[WEBHOOK-POST] ✅ Mensaje encolado con ID: ${result.messageId}`)
              } else {
                console.error(`[WEBHOOK-POST] ❌ Error al encolar mensaje, procesando directamente`)
                console.log(`[WEBHOOK-POST] 🔄 Iniciando procesamiento directo como fallback...`)
                await handleMessage(change.value)
                console.log(`[WEBHOOK-POST] ✅ Procesamiento directo completado`)
              }
            } else {
              // Procesar el mensaje directamente
              console.log(`[WEBHOOK-POST] 🔄 Procesando mensaje directamente`)
              await handleMessage(change.value)
              console.log(`[WEBHOOK-POST] ✅ Procesamiento directo completado`)
            }
          } catch (processingError) {
            console.error(`[WEBHOOK-POST] ❌ Error en procesamiento:`, processingError)
            console.error(
              `[WEBHOOK-POST] Stack trace:`,
              processingError instanceof Error ? processingError.stack : "No stack",
            )

            // Intentar enviar mensaje de error al usuario
            try {
              const { sendWhatsAppMessage } = await import("@/lib/whatsapp-api")
              await sendWhatsAppMessage(
                phoneNumberId,
                config.accessToken,
                userPhoneNumber,
                "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta de nuevo más tarde.",
              )
              console.log(`[WEBHOOK-POST] ✅ Mensaje de error enviado al usuario`)
            } catch (sendError) {
              console.error(`[WEBHOOK-POST] ❌ Error enviando mensaje de error:`, sendError)
            }
          }
        } else {
          console.log(`[WEBHOOK-POST] ⚠️ Change no contiene mensajes válidos:`)
          console.log(`[WEBHOOK-POST] - Field: ${change.field}`)
          console.log(`[WEBHOOK-POST] - Has value: ${!!change.value}`)
          console.log(`[WEBHOOK-POST] - Has messages: ${!!change.value?.messages}`)
          console.log(`[WEBHOOK-POST] - Messages length: ${change.value?.messages?.length || 0}`)
        }
      }
    }

    console.log(`[WEBHOOK-POST] ✅ Procesamiento de webhook completado exitosamente`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("=".repeat(80))
    console.error("[WEBHOOK-POST] ❌ ERROR CRÍTICO EN WEBHOOK:")
    console.error("[WEBHOOK-POST] Error name:", error?.constructor?.name || "Unknown")
    console.error("[WEBHOOK-POST] Error message:", error?.message || "No message")
    console.error("[WEBHOOK-POST] Stack trace:", error instanceof Error ? error.stack : "No stack trace")
    console.error("=".repeat(80))

    try {
      await logError("webhook", error instanceof Error ? error : new Error(String(error)))
    } catch (logErr) {
      console.error("[WEBHOOK-POST] Error logging error:", logErr)
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
