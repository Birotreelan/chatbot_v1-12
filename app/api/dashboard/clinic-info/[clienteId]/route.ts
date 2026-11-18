import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getClinicInfo, saveClinicInfo } from "@/lib/db"
import { logger } from "@/lib/logger"

interface RouteParams {
  params: {
    clienteId: string
  }
}

/**
 * Info institucional guardada de una clínica (base de conocimiento para la
 * IA). Hermana de /api/dashboard/configs/[id], pero es un dominio separado
 * (ver lib/types.ts ClinicInfo) — se guarda con su propia clave por
 * cliente_id en vez de vivir dentro de WhatsAppConfig.
 */
/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Escribe la información institucional con la que el bot le contesta a los pacientes.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const info = await getClinicInfo(params.clienteId)
    return NextResponse.json({ success: true, info })
  } catch (error) {
    logger.error("API", "Error al obtener información de clínica", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const updates = await request.json()

    if (!params.clienteId) {
      return NextResponse.json({ success: false, error: "cliente_id requerido" }, { status: 400 })
    }

    // El guardado desde el dashboard (manual o después de revisar un import)
    // siempre queda marcado como "manual" — el estado "import" es sólo el
    // draft transitorio que vive en el job, nunca lo que queda persistido.
    const info = await saveClinicInfo(params.clienteId, { ...updates, updatedBy: "manual" })
    return NextResponse.json({ success: true, info })
  } catch (error) {
    logger.error("API", "Error al guardar información de clínica", error)
    return NextResponse.json({ success: false, error: "Error interno del servidor" }, { status: 500 })
  }
}
