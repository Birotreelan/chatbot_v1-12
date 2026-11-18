import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { sendWhatsAppMessage } from "@/lib/whatsapp-api"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Manda un mensaje de WhatsApp de verdad.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST(req: Request) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(req as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


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
