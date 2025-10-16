import { NextResponse } from "next/server"
import { getWhatsAppConfig, getAllWhatsAppConfigs, updateWhatsAppConfig } from "@/lib/db"
import { checkWhatsAppHealth } from "@/lib/whatsapp-api"

export async function POST(request: Request) {
  try {
    const { configId } = await request.json()

    console.log("[v0] 🔍 Check Health Request:")
    console.log("[v0] Config ID:", configId || "ALL")
    // </CHANGE>

    if (configId) {
      // Check health for a specific config
      const config = await getWhatsAppConfig(configId)
      if (!config) {
        console.error("[v0] ❌ Configuración no encontrada:", configId)
        return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
      }

      console.log("[v0] 📋 Config encontrada:")
      console.log("[v0] - Display Name:", config.displayName)
      console.log("[v0] - Phone Number ID:", config.phoneNumberId)
      console.log("[v0] - Has Access Token:", !!config.accessToken)
      console.log("[v0] - Active:", config.active)

      if (!config.phoneNumberId) {
        console.error("[v0] ❌ Config sin phoneNumberId")
        return NextResponse.json({ error: "Configuración sin Phone Number ID" }, { status: 400 })
      }

      if (!config.accessToken) {
        console.error("[v0] ❌ Config sin accessToken")
        return NextResponse.json({ error: "Configuración sin Access Token" }, { status: 400 })
      }
      // </CHANGE>

      try {
        console.log("[v0] 🚀 Iniciando verificación de health status...")
        const healthData = await checkWhatsAppHealth(config.phoneNumberId, config.accessToken)
        console.log("[v0] ✅ Health check completado exitosamente")
        // </CHANGE>

        // Update config with health status
        await updateWhatsAppConfig(configId, {
          healthStatus: healthData.status,
          lastHealthCheck: new Date().toISOString(),
          healthCheckError:
            healthData.errors && healthData.errors.length > 0 ? JSON.stringify(healthData.errors) : undefined,
        })

        console.log("[v0] 💾 Config actualizada con health status:", healthData.status)
        // </CHANGE>

        return NextResponse.json({
          success: true,
          configId,
          healthStatus: healthData.status,
          canSendMessage: healthData.canSendMessage,
          errors: healthData.errors,
        })
      } catch (healthError) {
        console.error("[v0] ❌ Error en health check para config:", configId)
        console.error("[v0] Error:", healthError)

        const errorMessage = healthError instanceof Error ? healthError.message : "Error desconocido"

        // Update config with error
        await updateWhatsAppConfig(configId, {
          healthStatus: "BLOCKED",
          lastHealthCheck: new Date().toISOString(),
          healthCheckError: errorMessage,
        })

        return NextResponse.json(
          {
            success: false,
            error: "Error al verificar health status",
            details: errorMessage,
            configId,
          },
          { status: 500 },
        )
        // </CHANGE>
      }
    } else {
      // Check health for all configs
      const configs = await getAllWhatsAppConfigs()
      console.log("[v0] 📊 Verificando health status para", configs.length, "configuraciones")
      // </CHANGE>
      const results = []

      for (const config of configs) {
        if (!config.active) {
          console.log("[v0] ⏭️ Saltando config inactiva:", config.displayName)
          // </CHANGE>
          continue
        }

        if (!config.phoneNumberId || !config.accessToken) {
          console.warn("[v0] ⚠️ Config sin datos completos:", config.displayName)
          results.push({
            configId: config.id,
            displayName: config.displayName,
            error: "Configuración incompleta (falta phoneNumberId o accessToken)",
          })
          continue
        }

        console.log("[v0] 🔄 Verificando:", config.displayName)
        // </CHANGE>

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
          console.log("[v0] ✅", config.displayName, "- Status:", healthData.status)
          // </CHANGE>
        } catch (error) {
          console.error(`[PROXYLISTENER] Error checking health for config ${config.id}:`, error)
          console.error("[v0] ❌", config.displayName, "- Error:", error instanceof Error ? error.message : error)

          const errorMessage = error instanceof Error ? error.message : "Error desconocido"

          // Update config with error
          await updateWhatsAppConfig(config.id, {
            healthStatus: "BLOCKED",
            lastHealthCheck: new Date().toISOString(),
            healthCheckError: errorMessage,
          })
          // </CHANGE>

          results.push({
            configId: config.id,
            displayName: config.displayName,
            error: errorMessage,
          })
        }
      }

      console.log("[v0] 📈 Resumen de verificación:")
      console.log("[v0] - Total configs:", configs.length)
      console.log("[v0] - Verificadas:", results.length)
      console.log("[v0] - Con errores:", results.filter((r) => r.error).length)
      // </CHANGE>

      return NextResponse.json({
        success: true,
        results,
      })
    }
  } catch (error) {
    console.error("[API] Error al verificar health status:", error)
    console.error("[v0] ❌ Error general en check-health route:", error)
    return NextResponse.json(
      {
        error: "Error al verificar health status",
        details: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
    // </CHANGE>
  }
}
