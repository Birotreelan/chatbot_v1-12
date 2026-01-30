import { type NextRequest, NextResponse } from "next/server"
import { getGlobalTemplate, getWhatsAppConfig } from "@/lib/db"

// POST - Importar plantillas globales a un cliente (crear en WhatsApp Business API)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { templateIds, wabaId, configId } = body

    if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
      return NextResponse.json(
        { error: "Se requiere al menos un ID de plantilla" },
        { status: 400 },
      )
    }

    if (!wabaId) {
      return NextResponse.json(
        { error: "WABA ID es requerido" },
        { status: 400 },
      )
    }

    console.log(`[GLOBAL-TEMPLATES-IMPORT] Importando ${templateIds.length} plantillas al WABA: ${wabaId}`)

    // Obtener access token
    let accessToken = process.env.WHATSAPP_TOKEN

    if (configId) {
      try {
        const config = await getWhatsAppConfig(configId)
        if (config?.accessToken) {
          accessToken = config.accessToken
        }
      } catch (error) {
        console.warn("[GLOBAL-TEMPLATES-IMPORT] No se pudo obtener access token de la configuración")
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Access token no configurado" },
        { status: 400 },
      )
    }

    const results: {
      templateId: string
      name: string
      success: boolean
      error?: string
      whatsappTemplateId?: string
    }[] = []

    // Procesar cada plantilla
    for (const templateId of templateIds) {
      const template = await getGlobalTemplate(templateId)

      if (!template) {
        results.push({
          templateId,
          name: "Desconocido",
          success: false,
          error: "Plantilla global no encontrada",
        })
        continue
      }

      console.log(`[GLOBAL-TEMPLATES-IMPORT] Creando plantilla "${template.name}" en WhatsApp`)

      try {
        // Construir el payload para la API de Meta
        const payload = {
          name: template.name,
          language: template.language,
          category: template.category,
          components: template.components,
        }

        // Llamada a la API de WhatsApp Business
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        )

        const data = await response.json()

        if (!response.ok) {
          let errorMessage = "Error al crear la plantilla"
          
          if (data.error) {
            if (data.error.error_user_msg) {
              errorMessage = data.error.error_user_msg
            } else if (data.error.message) {
              errorMessage = data.error.message
            }
            
            // Errores comunes
            if (data.error.code === 100 && data.error.error_subcode === 2388094) {
              errorMessage = "Ya existe una plantilla con este nombre"
            }
          }

          results.push({
            templateId,
            name: template.displayName || template.name,
            success: false,
            error: errorMessage,
          })
        } else {
          results.push({
            templateId,
            name: template.displayName || template.name,
            success: true,
            whatsappTemplateId: data.id,
          })
          console.log(`[GLOBAL-TEMPLATES-IMPORT] Plantilla "${template.name}" creada exitosamente`)
        }
      } catch (error) {
        results.push({
          templateId,
          name: template.displayName || template.name,
          success: false,
          error: error instanceof Error ? error.message : "Error desconocido",
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length

    console.log(`[GLOBAL-TEMPLATES-IMPORT] Resultado: ${successCount} exitosas, ${failCount} fallidas`)

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: templateIds.length,
        successful: successCount,
        failed: failCount,
      },
      message: `Se importaron ${successCount} de ${templateIds.length} plantillas`,
    })
  } catch (error) {
    console.error("[GLOBAL-TEMPLATES-IMPORT] Error:", error)
    return NextResponse.json(
      {
        error: "Error al importar plantillas",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
