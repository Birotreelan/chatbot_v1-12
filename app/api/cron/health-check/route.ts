import { NextResponse } from "next/server"
import { Redis } from "@upstash/redis"
import { incrementMetric, logError } from "@/lib/monitoring"
import { checkWhatsAppHealth } from "@/lib/whatsapp-api"
import type { WhatsAppConfig } from "@/lib/types"

// Función para verificar health status de todas las configuraciones
export async function GET(req: Request) {
  try {
    const redis = Redis.fromEnv()

    // Obtener todas las configuraciones activas
    const configKeys = await redis.keys("whatsapp_config:*")

    let configsChecked = 0
    let configsAvailable = 0
    let configsLimited = 0
    let configsBlocked = 0
    let errors = 0

    for (const key of configKeys) {
      try {
        const configData = await redis.get(key)
        if (!configData) continue

        const config = JSON.parse(configData as string) as WhatsAppConfig

        // Solo verificar configuraciones activas
        if (!config.active) continue

        // Verificar health status
        const healthResult = await checkWhatsAppHealth(config.phoneNumberId, config.accessToken)

        // Actualizar configuración con el nuevo health status
        const updatedConfig: WhatsAppConfig = {
          ...config,
          healthStatus: healthResult.status,
          lastHealthCheck: new Date().toISOString(),
          healthCheckError:
            healthResult.errors && healthResult.errors.length > 0 ? JSON.stringify(healthResult.errors) : undefined,
        }

        await redis.set(key, JSON.stringify(updatedConfig))

        configsChecked++

        // Contar por estado
        switch (healthResult.status) {
          case "AVAILABLE":
            configsAvailable++
            break
          case "LIMITED":
            configsLimited++
            break
          case "BLOCKED":
            configsBlocked++
            break
        }
      } catch (error) {
        errors++
        await logError("health_check_cron", error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Registrar métricas
    await incrementMetric("health_check_configs_checked", configsChecked)
    await incrementMetric("health_check_configs_available", configsAvailable)
    await incrementMetric("health_check_configs_limited", configsLimited)
    await incrementMetric("health_check_configs_blocked", configsBlocked)
    await incrementMetric("health_check_errors", errors)

    return NextResponse.json({
      success: true,
      configsChecked,
      configsAvailable,
      configsLimited,
      configsBlocked,
      errors,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    await logError("health_check_cron", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Configuración para Vercel Cron
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60 // 60 segundos máximo de ejecución
