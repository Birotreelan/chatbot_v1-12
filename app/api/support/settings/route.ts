import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigsByTenant } from "@/lib/db"
import { getClientFeatureFlags, setClientFeatureFlags } from "@/lib/conversation-state/feature-flags"
import {
  getHumanSupportSchedule,
  setHumanSupportSchedule,
} from "@/lib/human-support-schedule"
import type { DaySchedule } from "@/lib/types"

export const dynamic = "force-dynamic"

// Only these two flags can be toggled by clinic agents
const ALLOWED_FLAGS = ["humanSupport", "humanSupportOfferToPatient"] as const
type AllowedFlag = (typeof ALLOWED_FLAGS)[number]

// ── GET: all human-support settings for this tenant's configs ─────────────────
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
        const schedule = await getHumanSupportSchedule(config.id)
        return {
          configId: config.id,
          configName: config.displayName || config.alias || config.id,
          timezone: config.timezone || "America/Argentina/Buenos_Aires",
          humanSupport: flags.humanSupport ?? false,
          humanSupportOfferToPatient: flags.humanSupportOfferToPatient ?? false,
          humanSupportSchedule: schedule,
        }
      })
    )

    return NextResponse.json({ success: true, settings })
  } catch (error: any) {
    console.error("[API Support Settings GET] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// ── POST: update a flag or the schedule ───────────────────────────────────────
// Body (flag):     { configId, action: "flag",     flag: AllowedFlag,   value: boolean }
// Body (schedule): { configId, action: "schedule", schedule: DaySchedule[] }
export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const body = await request.json()
    const { configId, action } = body

    if (!configId || !action) {
      return NextResponse.json({ success: false, error: "Parámetros inválidos" }, { status: 400 })
    }

    // Verify this config belongs to the agent's tenant
    const configs = await getWhatsAppConfigsByTenant(session.tenantId)
    const config = configs.find((c) => c.id === configId)
    if (!config) {
      return NextResponse.json(
        { success: false, error: "Configuración no encontrada o no autorizada" },
        { status: 403 }
      )
    }

    // ── flag toggle ──────────────────────────────────────────────────────────
    if (action === "flag") {
      const { flag, value } = body as { flag: string; value: boolean }

      if (!ALLOWED_FLAGS.includes(flag as AllowedFlag)) {
        return NextResponse.json({ success: false, error: "Flag no permitido" }, { status: 403 })
      }
      if (typeof value !== "boolean") {
        return NextResponse.json({ success: false, error: "Valor inválido" }, { status: 400 })
      }

      await setClientFeatureFlags(configId, { [flag]: value })
      const updated = await getClientFeatureFlags(configId)

      return NextResponse.json({
        success: true,
        humanSupport: updated.humanSupport ?? false,
        humanSupportOfferToPatient: updated.humanSupportOfferToPatient ?? false,
      })
    }

    // ── schedule update ──────────────────────────────────────────────────────
    if (action === "schedule") {
      const { schedule } = body as { schedule: DaySchedule[] }

      if (!Array.isArray(schedule)) {
        return NextResponse.json({ success: false, error: "Horario inválido" }, { status: 400 })
      }

      await setHumanSupportSchedule(configId, schedule)
      return NextResponse.json({ success: true, schedule })
    }

    return NextResponse.json({ success: false, error: `Acción no válida: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error("[API Support Settings POST] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
