import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest, requireAuthForApi } from "@/lib/auth"
import {
  getAllGlobalTemplates,
  createGlobalTemplate,
  globalTemplateExistsByName,
} from "@/lib/db"
import type { GlobalTemplate } from "@/lib/types"

// GET - Obtener todas las plantillas globales
/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Escribe las plantillas globales que usan todos los clientes.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET() {
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    console.log("[GLOBAL-TEMPLATES] Obteniendo todas las plantillas globales")
    
    const templates = await getAllGlobalTemplates()
    
    console.log(`[GLOBAL-TEMPLATES] Encontradas ${templates.length} plantillas globales`)
    
    return NextResponse.json({
      success: true,
      templates,
      count: templates.length,
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES] Error:", error)
    return NextResponse.json(
      {
        error: "Error al obtener plantillas globales",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// POST - Crear una nueva plantilla global (o guardar una existente como global)
export async function POST(req: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(req as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const body = await req.json()
    const { 
      name, 
      displayName,
      description,
      language, 
      category, 
      components,
      sourceConfigId,
    } = body

    console.log(`[GLOBAL-TEMPLATES] Creando plantilla global: ${name}`)

    // Validaciones
    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 })
    }

    if (!language) {
      return NextResponse.json({ error: "El idioma es requerido" }, { status: 400 })
    }

    if (!category) {
      return NextResponse.json({ error: "La categoria es requerida" }, { status: 400 })
    }

    if (!components || !Array.isArray(components) || components.length === 0) {
      return NextResponse.json({ error: "Los componentes son requeridos" }, { status: 400 })
    }

    // Verificar si ya existe una plantilla con el mismo nombre
    const exists = await globalTemplateExistsByName(name)
    if (exists) {
      return NextResponse.json(
        { error: `Ya existe una plantilla global con el nombre "${name}"` },
        { status: 409 },
      )
    }

    // Crear la plantilla global
    const template = await createGlobalTemplate({
      name,
      displayName: displayName || name,
      description,
      language,
      category,
      components,
      sourceConfigId,
    })

    console.log(`[GLOBAL-TEMPLATES] Plantilla global creada: ${template.id}`)

    return NextResponse.json({
      success: true,
      template,
      message: `Plantilla global "${displayName || name}" creada exitosamente`,
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES] Error:", error)
    return NextResponse.json(
      {
        error: "Error al crear plantilla global",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
