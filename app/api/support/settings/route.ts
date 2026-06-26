import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getClientFeatureFlags, setClientFeatureFlags } from "@/lib/conversation-state/feature-flags"

export const dynamic = "force-dynamic"

// Only these two flags can be managed by clinic agents (not super-admin only)
const ALLOWED_FLAGS = ["humanSupport", "humanSupportOfferToPatient"] as const
type AllowedFlag = (typeof ALLOWED_FLAGS)[number]

// GET: returns humanSupport settings for all configs of this tenant
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const configs = await getWhatsAppConfigsByTenant(session.tenantId)
    if (!configs.length) {
      return NextResponse.json({ success: true, settings: [] })
    }

    const settings = await Promise.all(
      configs.map(async (config) => {
        const flags = await getClientFeatureFlags(config.id)
        return {
          configId: config.id,
          configName: config.displayName || config.alias || config.id,
          humanSupport: flags.humanSupport ?? false,
          humanSupportOfferToPatient: flags.humanSupportOfferToPatient ?? false,
        }
      })
    )

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[API Support Settings GET] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// POST: update humanSupport flags for a specific configId
// Body: { configId: string, flag: "humanSupport" | "humanSupportOfferToPatient", value: boolean }
export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const body = await request.json()
    const { configId, flag, value } = body as { configId: string; flag: string; value: boolean }

    if (!configId || !flag || typeof value !== "boolean") {
      return NextResponse.json({ success: false, error: "Parámetros inválidos" }, { status: 400 })
    }

    // Only allow the two human-support flags
    if (!ALLOWED_FLAGS.includes(flag as AllowedFlag)) {
      return NextResponse.json({ success: false, error: "Flag no permitido" }, { status: 403 })
    }

    // Verify this config belongs to the agent's tenant
    const configs = await getWhatsAppConfigsByTenant(session.tenantId)
    const config = configs.find((c) => c.id === configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada o no autorizada" }, { status: 403 })
    }

    await setClientFeatureFlags(configId, { [flag]: value })

    const updated = await getClientFeatureFlags(configId)
    return NextResponse.json({
      success: true,
      humanSupport: updated.humanSupport ?? false,
      humanSupportOfferToPatient: updated.humanSupportOfferToPatient ?? false,
    })
  } catch (error: any) {
    console.error("[API Support Settings POST] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
