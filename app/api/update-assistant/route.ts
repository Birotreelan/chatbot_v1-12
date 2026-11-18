import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { configureAssistant } from "@/lib/assistant-config"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Reescribe las instrucciones del asistente de OpenAI.
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
    // Actualizar el asistente con las nuevas instrucciones
    const assistantId = await configureAssistant()

    return NextResponse.json({
      success: true,
      message: "Asistente actualizado correctamente",
      assistantId,
    })
  } catch (error) {
    console.error("Error al actualizar el asistente:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al actualizar el asistente",
      },
      { status: 500 },
    )
  }
}
