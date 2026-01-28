import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfigById } from "@/lib/db"

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const wabaId = searchParams.get("wabaId")
    const configId = searchParams.get("configId")
    const templateName = searchParams.get("name")
    const hsm_id = searchParams.get("hsm_id") // Template ID alternativo

    if (!wabaId) {
      return NextResponse.json({ error: "WABA ID is required" }, { status: 400 })
    }

    if (!templateName && !hsm_id) {
      return NextResponse.json({ error: "Template name or hsm_id is required" }, { status: 400 })
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
        console.warn("[TEMPLATE-DELETE] No se pudo obtener access token de la configuración, usando el de environment")
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

    console.log(`[TEMPLATE-DELETE] Eliminando plantilla "${templateName || hsm_id}" para WABA ID: ${wabaId}`)

    // Construir URL con parámetros
    const deleteUrl = new URL(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`)
    if (templateName) {
      deleteUrl.searchParams.append("name", templateName)
    }
    if (hsm_id) {
      deleteUrl.searchParams.append("hsm_id", hsm_id)
    }

    // Llamada a la API de WhatsApp Business para eliminar la plantilla
    const response = await fetch(deleteUrl.toString(), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    })

    const data = await response.json()

    if (!response.ok) {
      console.error(`[TEMPLATE-DELETE] Error de WhatsApp API:`, data)

      let errorMessage = "Error al eliminar la plantilla"
      
      if (data.error) {
        if (data.error.error_user_msg) {
          errorMessage = data.error.error_user_msg
        } else if (data.error.message) {
          errorMessage = data.error.message
        }
        
        if (data.error.code === 100 && data.error.error_subcode === 2388078) {
          errorMessage = "No se encontró una plantilla con ese nombre"
        }
        
        if (data.error.code === 190) {
          errorMessage = "Token de acceso inválido o expirado"
        }
      }

      return NextResponse.json(
        {
          error: errorMessage,
          details: data,
        },
        { status: response.status },
      )
    }

    console.log(`[TEMPLATE-DELETE] Plantilla eliminada exitosamente:`, data)

    return NextResponse.json({
      success: data.success === true,
      message: `Plantilla "${templateName || hsm_id}" eliminada exitosamente`,
    })
  } catch (error) {
    console.error("[TEMPLATE-DELETE] Error:", error)
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
