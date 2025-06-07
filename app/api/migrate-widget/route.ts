import { NextResponse } from "next/server"
import { migrateWidgetSettings } from "@/lib/migration"

export async function POST() {
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
