import { NextResponse } from "next/server"
import { getAllWhatsAppConfigs } from "@/lib/db"

/**
 * Lista liviana de clínicas para el selector de la página de demo del widget
 * (app/demo). A diferencia de /api/dashboard/configs (que devuelve el objeto
 * de configuración completo, incluyendo accessToken/verifyToken/proxy), acá
 * sólo se exponen los campos necesarios para elegir a qué clínica apuntar el
 * widget de prueba.
 */
export async function GET() {
  try {
    const configs = await getAllWhatsAppConfigs()

    const clinics = configs
      .filter((config) => !!config.cliente_id)
      .map((config) => ({
        cliente_id: config.cliente_id as string,
        displayName: config.displayName || config.alias || (config.cliente_id as string),
        widgetEnabled: config.widgetEnabled !== false,
        active: config.active !== false,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))

    return NextResponse.json(clinics)
  } catch (error) {
    console.error("[API-WIDGET-CLINICS] Error al listar clínicas:", error)
    return NextResponse.json([], { status: 500 })
  }
}
