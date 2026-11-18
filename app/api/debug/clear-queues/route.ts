import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { clearAllUserQueues } from "@/lib/user-queue"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Vacía las colas de mensajes en curso.
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
    await clearAllUserQueues()
    return NextResponse.json({ success: true, message: "Colas limpiadas exitosamente" })
  } catch (error) {
    console.error("Error al limpiar colas:", error)
    return NextResponse.json({ success: false, error: "Error al limpiar colas" }, { status: 500 })
  }
}
