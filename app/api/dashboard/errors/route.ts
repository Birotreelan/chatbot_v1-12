import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { getRecentErrors, getErrorCategories } from "@/lib/monitoring"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Los errores registrados, que incluyen teléfonos y texto de mensajes.
 *
 * Se protegen sólo las lecturas críticas —credenciales, conversaciones de
 * pacientes, datos personales y comerciales—. Las estadísticas agregadas
 * quedan abiertas a propósito: no identifican a nadie.
 *
 * La consumen pantallas del dashboard desde el navegador, que mandan la
 * cookie de sesión sola: no hubo que tocar ningún `fetch`.
 */
export async function GET() {
  // Lectura crítica: exige sesión. Ver la nota de arriba.
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

  try {
    // Obtener todas las categorías de errores
    const categories = await getErrorCategories()

    // Obtener errores recientes para cada categoría
    const errorData: Record<string, any[]> = {}

    for (const category of categories) {
      try {
        const errors = await getRecentErrors(category, 20)

        // Asegurarse de que cada error tenga la categoría
        const errorsWithCategory = errors.map((error) => ({
          ...error,
          category,
        }))

        errorData[category] = errorsWithCategory
      } catch (error) {
        console.error(`Error al obtener errores para categoría ${category}:`, error)
        errorData[category] = [
          {
            timestamp: new Date().toISOString(),
            message: `Error al recuperar errores: ${error instanceof Error ? error.message : String(error)}`,
            category,
          },
        ]
      }
    }

    return NextResponse.json(errorData)
  } catch (error) {
    console.error("Error al obtener log de errores:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
