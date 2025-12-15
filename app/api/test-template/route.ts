import { NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId, getWhatsAppConfig } from "@/lib/db"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp-api"
import { logError, incrementMetric } from "@/lib/monitoring"

export async function GET(request: Request) {
  const startTime = Date.now()

  try {
    console.log("[TEST-TEMPLATE] Iniciando envío de mensaje de prueba")

    const { searchParams } = new URL(request.url)
    const cliente_id = searchParams.get("cliente_id")
    const phone_number_id = searchParams.get("phone_number_id")
    const phone = searchParams.get("phone")
    const type = searchParams.get("type") || "text"
    const mensaje = searchParams.get("mensaje")
    const template_data = searchParams.get("template_data")

    console.log("[TEST-TEMPLATE] Parámetros recibidos:", {
      cliente_id,
      phone_number_id,
      phone,
      type,
      mensaje: mensaje?.substring(0, 50) + "...",
      template_data: template_data?.substring(0, 100) + "...",
    })

    // Validaciones básicas
    if (!cliente_id) {
      console.error("[TEST-TEMPLATE] Error: cliente_id es requerido")
      return NextResponse.json({ success: false, error: "cliente_id es requerido" }, { status: 400 })
    }

    if (!phone_number_id) {
      console.error("[TEST-TEMPLATE] Error: phone_number_id es requerido")
      return NextResponse.json({ success: false, error: "phone_number_id es requerido" }, { status: 400 })
    }

    if (!phone) {
      console.error("[TEST-TEMPLATE] Error: phone es requerido")
      return NextResponse.json({ success: false, error: "phone es requerido" }, { status: 400 })
    }

    if (type === "text" && !mensaje) {
      console.error("[TEST-TEMPLATE] Error: mensaje es requerido para tipo text")
      return NextResponse.json({ success: false, error: "mensaje es requerido para tipo text" }, { status: 400 })
    }

    if (type === "template" && !template_data) {
      console.error("[TEST-TEMPLATE] Error: template_data es requerido para tipo template")
      return NextResponse.json(
        { success: false, error: "template_data es requerido para tipo template" },
        { status: 400 },
      )
    }

    // Buscar configuración
    console.log("[TEST-TEMPLATE] Buscando configuración de WhatsApp...")
    let config = await getWhatsAppConfigByPhoneId(phone_number_id)

    if (!config) {
      console.log("[TEST-TEMPLATE] No se encontró por phone_number_id, buscando por cliente_id...")
      config = await getWhatsAppConfig(cliente_id)
    }

    if (!config) {
      console.error("[TEST-TEMPLATE] Error: No se encontró configuración")
      await logError(
        "test-template",
        `No se encontró configuración para cliente_id: ${cliente_id}, phone_number_id: ${phone_number_id}`,
      )
      return NextResponse.json({ success: false, error: "No se encontró configuración de WhatsApp" }, { status: 404 })
    }

    console.log("[TEST-TEMPLATE] Configuración encontrada:", {
      phoneNumberId: config.phoneNumberId,
      wabaId: config.wabaId,
      active: config.active,
      hasToken: !!config.accessToken,
    })

    if (!config.active) {
      console.error("[TEST-TEMPLATE] Error: Configuración no está activa")
      return NextResponse.json(
        { success: false, error: "La configuración de WhatsApp no está activa" },
        { status: 400 },
      )
    }

    if (!config.accessToken) {
      console.error("[TEST-TEMPLATE] Error: No hay access token")
      return NextResponse.json({ success: false, error: "No hay access token configurado" }, { status: 400 })
    }

    // Formatear número de teléfono
    let formattedPhone = phone
    if (!formattedPhone.startsWith("+")) {
      formattedPhone = `+${formattedPhone}`
    }

    console.log("[TEST-TEMPLATE] Número de teléfono formateado:", formattedPhone)

    let result

    if (type === "template") {
      console.log("[TEST-TEMPLATE] Enviando plantilla...")

      let templateObject
      try {
        templateObject = JSON.parse(template_data!)
        console.log("[TEST-TEMPLATE] Template data parseado:", templateObject)
      } catch (parseError) {
        console.error("[TEST-TEMPLATE] Error al parsear template_data:", parseError)
        await logError("test-template", `Error al parsear template_data: ${parseError}`)
        return NextResponse.json({ success: false, error: "template_data debe ser un JSON válido" }, { status: 400 })
      }

      // Construir el cuerpo de la plantilla
      const templateBody = {
        template: {
          name: templateObject.name,
          language: {
            code: templateObject.language || "es",
          },
        },
      }

      // Agregar componentes si existen
      if (templateObject.components && templateObject.components.length > 0) {
        const components = templateObject.components
          .filter((comp: any) => comp.parameters && comp.parameters.length > 0)
          .map((comp: any) => ({
            type: comp.type.toLowerCase(),
            parameters: comp.parameters,
          }))

        if (components.length > 0) {
          templateBody.template.components = components
        }
      }

      console.log("[TEST-TEMPLATE] Cuerpo de plantilla construido:", JSON.stringify(templateBody, null, 2))

      result = await sendWhatsAppTemplate(
        config.phoneNumberId,
        config.accessToken,
        formattedPhone,
        templateBody,
        config.wabaId,
      )
    } else {
      console.log("[TEST-TEMPLATE] Enviando mensaje de texto...")
      result = await sendWhatsAppMessage(config.phoneNumberId, config.accessToken, formattedPhone, mensaje!)
    }

    console.log("[TEST-TEMPLATE] Resultado del envío:", result)

    // Incrementar métricas
    await incrementMetric("test-template-success")
    await incrementMetric(`test-template-${type}-success`)

    const duration = Date.now() - startTime
    console.log(`[TEST-TEMPLATE] Mensaje enviado exitosamente en ${duration}ms`)

    return NextResponse.json({
      success: true,
      message: "Mensaje enviado correctamente",
      details: {
        type,
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        destinationPhone: formattedPhone,
        duration,
        messageId: result.messages?.[0]?.id,
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime
    console.error("[TEST-TEMPLATE] Error completo:", error)

    // Log detallado del error
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
      timestamp: new Date().toISOString(),
    }

    console.error("[TEST-TEMPLATE] Detalles del error:", errorDetails)

    await logError("test-template", errorDetails)
    await incrementMetric("test-template-error")

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al enviar mensaje",
        details: process.env.NODE_ENV === "development" ? errorDetails : undefined,
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { templateName, data } = await request.json()

    if (!templateName) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 })
    }

    // Basic template validation (expand as needed)
    const validTemplates = ["template1", "template2", "template3"] // Example templates
    if (!validTemplates.includes(templateName)) {
      return NextResponse.json({ error: "Template no reconocido" }, { status: 400 })
    }

    // Simulate processing based on template name
    let result
    switch (templateName) {
      case "template1":
        result = `Processed template1 with data: ${JSON.stringify(data)}`
        break
      case "template2":
        result = `Processed template2 with data: ${JSON.stringify(data)}`
        break
      case "template3":
        result = `Processed template3 with data: ${JSON.stringify(data)}`
        break
      default:
        return NextResponse.json({ error: "Template no reconocido" }, { status: 400 }) // Redundant, but included for clarity
    }

    return NextResponse.json({ message: "Template processed successfully", result }, { status: 200 })
  } catch (error) {
    console.error("Error processing template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
