import { type NextRequest, NextResponse } from "next/server"
import { kv } from "@vercel/kv"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")

    if (!clienteId) {
      return NextResponse.json({ error: "Cliente ID requerido" }, { status: 400 })
    }

    console.log(`[WIDGET-API] Buscando configuración para cliente: ${clienteId}`)

    // Buscar configuración por cliente_id
    const configs = (await kv.hgetall("whatsapp_configs")) || {}

    let targetConfig = null
    for (const [configId, configData] of Object.entries(configs)) {
      const config = typeof configData === "string" ? JSON.parse(configData) : configData
      if (config.cliente_id === clienteId) {
        targetConfig = { id: configId, ...config }
        break
      }
    }

    if (!targetConfig) {
      console.log(`[WIDGET-API] No se encontró configuración para cliente: ${clienteId}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    if (!targetConfig.active) {
      console.log(`[WIDGET-API] Configuración inactiva para cliente: ${clienteId}`)
      return NextResponse.json({ error: "Configuración inactiva" }, { status: 403 })
    }

    if (!targetConfig.widgetEnabled) {
      console.log(`[WIDGET-API] Widget deshabilitado para cliente: ${clienteId}`)
      return NextResponse.json({ error: "Widget no habilitado" }, { status: 403 })
    }

    console.log(`[WIDGET-API] Configuración encontrada para cliente: ${clienteId}`)

    // Devolver solo los datos necesarios para el widget
    const widgetConfig = {
      id: targetConfig.id,
      displayName: targetConfig.displayName,
      cliente_id: targetConfig.cliente_id,
      widgetAssistantId: targetConfig.widgetAssistantId,
      widgetEnabled: targetConfig.widgetEnabled,
      widgetTitle: targetConfig.widgetTitle,
      widgetPrimaryColor: targetConfig.widgetPrimaryColor,
      widgetSecondaryColor: targetConfig.widgetSecondaryColor,
      widgetPosition: targetConfig.widgetPosition,
      widgetWelcomeMessage: targetConfig.widgetWelcomeMessage,
      widgetPlaceholder: targetConfig.widgetPlaceholder,
      widgetButtonText: targetConfig.widgetButtonText,
      widgetHeaderText: targetConfig.widgetHeaderText,
      widgetSubtitle: targetConfig.widgetSubtitle,
      widgetBrandingEnabled: targetConfig.widgetBrandingEnabled,
      widgetBrandingText: targetConfig.widgetBrandingText,
      widgetMaxHeight: targetConfig.widgetMaxHeight,
      widgetMaxWidth: targetConfig.widgetMaxWidth,
      widgetBorderRadius: targetConfig.widgetBorderRadius,
      widgetShadow: targetConfig.widgetShadow,
      widgetAnimation: targetConfig.widgetAnimation,
      widgetSoundEnabled: targetConfig.widgetSoundEnabled,
      widgetTheme: targetConfig.widgetTheme,
      widgetFloatingButtonText: targetConfig.widgetFloatingButtonText,
      widgetShowFloatingText: targetConfig.widgetShowFloatingText,
    }

    return NextResponse.json(widgetConfig)
  } catch (error) {
    console.error("[WIDGET-API] Error:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

// Permitir CORS para sitios externos
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
