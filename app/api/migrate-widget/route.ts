import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { migrateWidgetSettings } from "@/lib/migration"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Migra la configuración del widget.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function POST() {
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    console.log("[API] Iniciando migración de configuraciones del widget...")

    const result = await migrateWidgetSettings()

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Migración completada exitosamente. ${result.migratedCount} configuraciones actualizadas.`,
        migratedCount: result.migratedCount,
      })
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "Error durante la migración",
          error: result.error,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("[API] Error en migración:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Error interno del servidor",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export const dynamic = "force-dynamic"
