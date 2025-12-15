import { NextResponse } from "next/server"
import { getRecentErrors, getErrorCategories } from "@/lib/monitoring"

export async function GET() {
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
