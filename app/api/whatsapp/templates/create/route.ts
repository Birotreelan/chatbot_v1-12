import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfigById } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { wabaId, configId, template } = body

    if (!wabaId) {
      return NextResponse.json({ error: "WABA ID is required" }, { status: 400 })
    }

    if (!template) {
      return NextResponse.json({ error: "Template data is required" }, { status: 400 })
    }

    // Validar campos requeridos de la plantilla
    if (!template.name) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 })
    }

    if (!template.language) {
      return NextResponse.json({ error: "Template language is required" }, { status: 400 })
    }

    if (!template.category) {
      return NextResponse.json({ error: "Template category is required" }, { status: 400 })
    }

    if (!template.components || !Array.isArray(template.components)) {
      return NextResponse.json({ error: "Template components are required" }, { status: 400 })
    }

    // Validar que tenga al menos un BODY
    const hasBody = template.components.some((c: { type: string }) => c.type === "BODY")
    if (!hasBody) {
      return NextResponse.json({ error: "Template must have a BODY component" }, { status: 400 })
    }

    // Obtener el access token de la configuración
    let accessToken = process.env.WHATSAPP_TOKEN

    if (configId) {
      try {
        const config = await getWhatsAppConfigById(configId)
        if (config?.accessToken) {
          accessToken = config.accessToken
        }
      } catch (error) {
        console.warn("[TEMPLATE-CREATE] No se pudo obtener access token de la configuración, usando el de environment")
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Access token no configurado. Configure WHATSAPP_TOKEN en las variables de entorno o en la configuración.",
        },
        { status: 400 },
      )
    }

    console.log(`[TEMPLATE-CREATE] Creando plantilla "${template.name}" para WABA ID: ${wabaId}`)
    console.log(`[TEMPLATE-CREATE] Datos:`, JSON.stringify(template, null, 2))

    // Construir el payload para la API de Meta
    const payload = {
      name: template.name,
      language: template.language,
      category: template.category,
      components: template.components,
    }

    // Llamada a la API de WhatsApp Business para crear la plantilla
    const response = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error(`[TEMPLATE-CREATE] Error de WhatsApp API:`, data)

      // Extraer mensaje de error más específico
      let errorMessage = "Error al crear la plantilla"
      
      if (data.error) {
        if (data.error.error_user_msg) {
          errorMessage = data.error.error_user_msg
        } else if (data.error.message) {
          errorMessage = data.error.message
        }
        
        // Errores comunes
        if (data.error.code === 100) {
          if (data.error.error_subcode === 2388094) {
            errorMessage = "Ya existe una plantilla con este nombre en este idioma"
          } else if (data.error.error_subcode === 2388032) {
            errorMessage = "El nombre de la plantilla es inválido. Use solo letras minúsculas, números y guiones bajos."
          }
        }
        
        if (data.error.code === 190) {
          errorMessage = "Token de acceso inválido o expirado"
        }
        
        if (data.error.code === 10) {
          errorMessage = "No tienes permisos para crear plantillas en esta cuenta"
        }
      }

      return NextResponse.json(
        {
          error: errorMessage,
          details: data,
          code: data.error?.code,
          subcode: data.error?.error_subcode,
        },
        { status: response.status },
      )
    }

    console.log(`[TEMPLATE-CREATE] Plantilla creada exitosamente:`, data)

    return NextResponse.json({
      success: true,
      template: {
        id: data.id,
        name: template.name,
        language: template.language,
        category: template.category,
        status: data.status || "PENDING",
      },
      message: `Plantilla "${template.name}" creada exitosamente. Estado: ${data.status || "PENDING"}`,
    })
  } catch (error) {
    console.error("[TEMPLATE-CREATE] Error:", error)
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
