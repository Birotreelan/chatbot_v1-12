import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getWhatsAppConfigById } from "@/lib/db"

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Lee y escribe las plantillas de WhatsApp de una clínica en Meta.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET(req: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(req as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const { searchParams } = new URL(req.url)
    const wabaId = searchParams.get("wabaId")
    const configId = searchParams.get("configId")

    if (!wabaId) {
      return NextResponse.json({ error: "WABA ID is required" }, { status: 400 })
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
        console.warn("No se pudo obtener access token de la configuración, usando el de environment")
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

    console.log(`[TEMPLATES-API] Obteniendo plantillas para WABA ID: ${wabaId}`)

    // Llamada real a la API de WhatsApp Business
    const response = await fetch(`https://graph.facebook.com/v18.0/${wabaId}/message_templates`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error(`[TEMPLATES-API] Error de WhatsApp API:`, errorData)

      // Manejar errores específicos de la API de WhatsApp
      if (response.status === 401) {
        return NextResponse.json(
          {
            error: "Token de acceso inválido o expirado",
            details: errorData,
          },
          { status: 401 },
        )
      } else if (response.status === 403) {
        return NextResponse.json(
          {
            error: "Sin permisos para acceder a este WABA ID",
            details: errorData,
          },
          { status: 403 },
        )
      } else if (response.status === 404) {
        return NextResponse.json(
          {
            error: "WABA ID no encontrado",
            details: errorData,
          },
          { status: 404 },
        )
      }

      return NextResponse.json(
        {
          error: `Error de WhatsApp API: ${response.status}`,
          details: errorData,
        },
        { status: response.status },
      )
    }

    const data = await response.json()
    console.log(`[TEMPLATES-API] Plantillas obtenidas exitosamente:`, data.data?.length || 0)

    return NextResponse.json({
      success: true,
      templates: data.data || [],
      wabaId,
      paging: data.paging,
    })
  } catch (error) {
    console.error("[TEMPLATES-API] Error:", error)
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(req as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const body = await req.json()
    const { templateName, templateData } = body

    if (!templateName) {
      return NextResponse.json({ error: "Template name is required" }, { status: 400 })
    }

    // Basic template validation (expand as needed)
    switch (templateName) {
      case "welcome_message":
        if (!templateData || !templateData.userName) {
          return NextResponse.json({ error: "userName is required for welcome_message template" }, { status: 400 })
        }
        break
      case "order_confirmation":
        if (!templateData || !templateData.orderId || !templateData.totalAmount) {
          return NextResponse.json(
            { error: "orderId and totalAmount are required for order_confirmation template" },
            { status: 400 },
          )
        }
        break
      default:
        return NextResponse.json({ error: "Template no reconocido" }, { status: 400 })
    }

    // Simulate sending the WhatsApp message (replace with actual WhatsApp API call)
    console.log(`Sending WhatsApp message using template: ${templateName}`)
    console.log("Template Data:", templateData)

    return NextResponse.json({ message: "WhatsApp message sent successfully" }, { status: 200 })
  } catch (error) {
    console.error("Error processing request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
