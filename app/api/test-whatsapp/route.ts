import { NextResponse } from "next/server"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"

export async function POST(req: Request) {
  try {
    const { phoneNumberId, to, message } = await req.json()

    if (!phoneNumberId || !to || !message) {
      return NextResponse.json({ success: false, error: "Se requieren phoneNumberId, to y message" }, { status: 400 })
    }

    console.log(`[TEST-WHATSAPP] Buscando configuración para phoneNumberId: ${phoneNumberId}`)
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)

    if (!config) {
      return NextResponse.json(
        { success: false, error: `No se encontró configuración para phoneNumberId: ${phoneNumberId}` },
        { status: 404 },
      )
    }

    console.log(`[TEST-WHATSAPP] Enviando mensaje de prueba a ${to}: ${message}`)
    const result = await sendWhatsAppMessage(phoneNumberId, config.accessToken, to, message)

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error("[TEST-WHATSAPP] Error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
