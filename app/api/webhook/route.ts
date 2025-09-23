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
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log(`[WEBHOOK-GET] ✅ Verificación exitosa con token global`)
        return new Response(challenge, { status: 200 })
      } else {
        console.log(`[WEBHOOK-GET] ❌ Token global no coincide`)
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
  console.log("[WEBHOOK-POST] ========== MENSAJE ENTRANTE ==========")
  console.log("[WEBHOOK-POST] Timestamp:", new Date().toISOString())

  try {
    // Obtener la IP del cliente
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown"
    console.log(`[WEBHOOK-POST] IP del cliente: ${ip}`)

    // Obtener headers importantes
    const userAgent = req.headers.get("user-agent") || "unknown"
    const contentType = req.headers.get("content-type") || "unknown"
    console.log(`[WEBHOOK-POST] User-Agent: ${userAgent}`)
    console.log(`[WEBHOOK-POST] Content-Type: ${contentType}`)

    // Aplicar rate limiting, pero permitir IPs de Meta/WhatsApp
    console.log(`[WEBHOOK-POST] Aplicando rate limiting...`)
    const rateLimitResult = await rateLimit(`ip:${ip}`)
    if (!rateLimitResult.success) {
      console.warn(`[WEBHOOK-POST] ⚠️ Solicitud limitada por tasa para IP: ${ip}`)
      return NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 })
    }
    console.log(`[WEBHOOK-POST] ✅ Rate limiting pasado`)

    // Procesar el cuerpo de la solicitud
    console.log(`[WEBHOOK-POST] Leyendo cuerpo de la solicitud...`)
    const body = await req.json()
    console.log(`[WEBHOOK-POST] Cuerpo completo recibido:`, JSON.stringify(body, null, 2))

    // Verificar si es un mensaje de WhatsApp
    if (body.object !== "whatsapp_business_account") {
      console.warn(`[WEBHOOK-POST] ⚠️ Objeto no reconocido: ${body.object}`)
      return NextResponse.json({ success: false, error: "Not a WhatsApp message" }, { status: 400 })
    }
    console.log(`[WEBHOOK-POST] ✅ Objeto WhatsApp válido`)

    // Incrementar métrica de mensajes recibidos
    await incrementMetric("messages_received")
    console.log(`[WEBHOOK-POST] ✅ Métrica incrementada`)

    // Procesar cada entrada y cambio
    console.log(`[WEBHOOK-POST] Procesando entradas... Total: ${body.entry?.length || 0}`)

    for (const entry of body.entry || []) {
      console.log(`[WEBHOOK-POST] Procesando entry:`, JSON.stringify(entry, null, 2))

      for (const change of entry.changes || []) {
        console.log(`[WEBHOOK-POST] Procesando change:`, JSON.stringify(change, null, 2))

        if (change.field === "messages" && change.value && change.value.messages && change.value.messages.length > 0) {
          const phoneNumberId = change.value.metadata.phone_number_id
          const userPhoneNumber = change.value.messages[0].from
          const messageText = change.value.messages[0].text?.body || "Sin texto"

          console.log(`[WEBHOOK-POST] 📱 Mensaje detectado:`)
          console.log(`[WEBHOOK-POST] - De: ${userPhoneNumber}`)
          console.log(`[WEBHOOK-POST] - Para phoneNumberId: ${phoneNumberId}`)
          console.log(`[WEBHOOK-POST] - Texto: "${messageText}"`)
          console.log(`[WEBHOOK-POST] - Tipo: ${change.value.messages[0].type}`)

          // Obtener la configuración de WhatsApp
          console.log(`[WEBHOOK-POST] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
          const config = await getWhatsAppConfigByPhoneId(phoneNumberId)
          if (!config) {
            console.error(`[WEBHOOK-POST] ❌ Configuración no encontrada para phoneNumberId=${phoneNumberId}`)

            // Listar todas las configuraciones disponibles para debug
            const { getAllWhatsAppConfigs } = await import("@/lib/db")
            const allConfigs = await getAllWhatsAppConfigs()
            console.log(`[WEBHOOK-POST] 🔍 Configuraciones disponibles:`)
            allConfigs.forEach((cfg, index) => {
              console.log(
                `[WEBHOOK-POST]   ${index + 1}. ID: ${cfg.id}, PhoneNumberId: ${cfg.phoneNumberId}, DisplayName: ${cfg.displayName}`,
              )
            })

            continue
          }

          console.log(`[WEBHOOK-POST] ✅ Configuración encontrada:`)
          console.log(`[WEBHOOK-POST] - ID: ${config.id}`)
          console.log(`[WEBHOOK-POST] - DisplayName: ${config.displayName}`)
          console.log(`[WEBHOOK-POST] - ClienteId: ${config.cliente_id}`)
          console.log(`[WEBHOOK-POST] - AssistantId: ${config.whatsappAssistantId}`)

          // Determinar si debemos usar QStash o procesar directamente
          const useQStash = process.env.USE_QSTASH === "true"
          console.log(`[WEBHOOK-POST] Usando QStash: ${useQStash}`)

          if (useQStash) {
            // Encolar el mensaje para procesamiento asíncrono
            console.log(`[WEBHOOK-POST] 📤 Encolando mensaje para procesamiento asíncrono`)
            try {
              const result = await enqueueMessage(change.value)
              if (result.success && result.messageId) {
                console.log(`[WEBHOOK-POST] ✅ Mensaje encolado con ID: ${result.messageId}`)
              } else {
                console.error(`[WEBHOOK-POST] ❌ Error al encolar mensaje, procesando directamente como fallback`)
                console.log(`[WEBHOOK-POST] 🔄 Iniciando procesamiento directo...`)
                await handleMessage(change.value)
                console.log(`[WEBHOOK-POST] ✅ Procesamiento directo completado`)
              }
            } catch (error) {
              console.error(`[WEBHOOK-POST] ❌ Error al encolar mensaje:`, error)
              // Si falla el encolamiento, procesar de forma síncrona como fallback
              console.log(`[WEBHOOK-POST] 🔄 Procesando mensaje directamente como fallback`)
              await handleMessage(change.value)
              console.log(`[WEBHOOK-POST] ✅ Procesamiento fallback completado`)
            }
          } else {
            // Procesar el mensaje directamente
            console.log(`[WEBHOOK-POST] 🔄 Procesando mensaje directamente`)
            await handleMessage(change.value)
            console.log(`[WEBHOOK-POST] ✅ Procesamiento directo completado`)
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

    console.log(`[WEBHOOK-POST] ✅ Procesamiento de webhook completado`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[WEBHOOK-POST] ❌ Error crítico al procesar webhook:", error)
    console.error("[WEBHOOK-POST] Stack trace:", error instanceof Error ? error.stack : "No stack trace")
    await logError("webhook", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
