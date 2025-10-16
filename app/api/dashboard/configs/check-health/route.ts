import { NextResponse } from "next/server"
import { getWhatsAppConfig, getAllWhatsAppConfigs, updateWhatsAppConfig } from "@/lib/db"
import { checkWhatsAppHealth } from "@/lib/whatsapp-api"

export async function POST(request: Request) {
  try {
    const { configId } = await request.json()

    if (configId) {
      // Check health for a specific config
      const config = await getWhatsAppConfig(configId)
      if (!config) {
        return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
      }

      const healthData = await checkWhatsAppHealth(config.phoneNumberId, config.accessToken)

      // Update config with health status
      await updateWhatsAppConfig(configId, {
        healthStatus: healthData.status,
        lastHealthCheck: new Date().toISOString(),
        healthCheckError:
          healthData.errors && healthData.errors.length > 0 ? JSON.stringify(healthData.errors) : undefined,
      })

      return NextResponse.json({
        success: true,
        configId,
        healthStatus: healthData.status,
        canSendMessage: healthData.canSendMessage,
        errors: healthData.errors,
      })
    } else {
      // Check health for all configs
      const configs = await getAllWhatsAppConfigs()
      const results = []

      for (const config of configs) {
        if (!config.active) continue

        try {
          const healthData = await checkWhatsAppHealth(config.phoneNumberId, config.accessToken)

          await updateWhatsAppConfig(config.id, {
            healthStatus: healthData.status,
            lastHealthCheck: new Date().toISOString(),
            healthCheckError:
              healthData.errors && healthData.errors.length > 0 ? JSON.stringify(healthData.errors) : undefined,
          })

          results.push({
            configId: config.id,
            displayName: config.displayName,
            healthStatus: healthData.status,
            canSendMessage: healthData.canSendMessage,
            errors: healthData.errors,
          })
        } catch (error) {
          console.error(`Error checking health for config ${config.id}:`, error)
          results.push({
            configId: config.id,
            displayName: config.displayName,
            error: error instanceof Error ? error.message : "Error desconocido",
          })
        }
      }

      return NextResponse.json({
        success: true,
        results,
      })
    }
  } catch (error) {
    console.error("[API] Error al verificar health status:", error)
    return NextResponse.json({ error: "Error al verificar health status" }, { status: 500 })
  }
}
