import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { updateWhatsAppConfig } from "@/lib/db"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Modificaba cualquier configuración, incluidos el accessToken y la URL del proxy.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST(request: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    console.log(`[API UPDATE] Iniciando actualización de configuración`)

    const { id, ...updates } = await request.json()
    console.log(`[API UPDATE] ID: ${id}, Datos:`, updates)

    if (!id) {
      console.error(`[API UPDATE] ID de configuración no proporcionado`)
      return NextResponse.json({ error: "ID de configuración requerido" }, { status: 400 })
    }

    const updatedConfig = await updateWhatsAppConfig(id, updates)

    if (!updatedConfig) {
      console.error(`[API UPDATE] Configuración ${id} no encontrada`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[API UPDATE] Configuración ${id} actualizada exitosamente`)
    return NextResponse.json(updatedConfig)
  } catch (error) {
    console.error(`[API UPDATE] Error al actualizar configuración:`, error)

    const errorMessage = error instanceof Error ? error.message : "Error desconocido"

    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
