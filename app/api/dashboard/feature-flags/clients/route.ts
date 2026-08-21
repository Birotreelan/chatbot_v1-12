import { type NextRequest, NextResponse } from "next/server"
import {
  listClientsWithRawFlags,
  pruneClientFeatureFlags,
  resetClientFeatureFlags,
  clearFeatureFlagsCache,
} from "@/lib/conversation-state/feature-flags"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@/lib/conversation-state/types"

/**
 * Auditoría y limpieza de overrides de feature flags POR CLIENTE (21/8/2026,
 * caso Instituto Privado de Ojos Dres. Filomena, configId
 * pJ49swKTv_QZIG_7MBcKP).
 *
 * Antes, cualquier llamado a setClientFeatureFlags (ej. activar "Atención
 * Humana" desde el panel propio del cliente en app/api/support/settings/
 * route.ts) grababa un snapshot COMPLETO de flags resueltos en ese momento
 * — congelando al cliente para siempre en esos valores, excluido de
 * cualquier mejora activada después por código (GLOBAL_CODE_FEATURE_FLAG_
 * OVERRIDES). Eso ya se corrigió en setClientFeatureFlags/
 * getEffectiveFeatureFlags (lib/conversation-state/feature-flags.ts) para
 * que los overrides de cliente sean parciales, pero los snapshots viejos ya
 * guardados en Redis siguen ahí — esta ruta permite verlos y "recortarlos"
 * a solo las claves que el cliente realmente controla (humanSupport /
 * humanSupportOfferToPatient) sin perder ese toggle.
 *
 * GET  → lista clientes con override propio en Redis, con su nombre y las
 *        claves que tienen guardadas (para detectar snapshots viejos con
 *        muchas claves de más).
 * POST → { configId, action: "prune", keysToKeep: string[] } recorta el
 *        override del cliente a esas claves. { configId, action: "reset" }
 *        borra el override completo (el cliente pasa a heredar global+código).
 */

const ALL_FLAG_KEYS = Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>

export async function GET() {
  try {
    const [rawList, configs] = await Promise.all([listClientsWithRawFlags(), getAllWhatsAppConfigs()])

    const nameById = new Map(configs.map((c) => [c.id, c.displayName || c.alias || c.id]))

    const clients = rawList.map(({ configId, rawFlags }) => ({
      configId,
      displayName: nameById.get(configId) || configId,
      rawFlags,
      keyCount: Object.keys(rawFlags).length,
    }))

    return NextResponse.json({ clients, availableKeys: ALL_FLAG_KEYS })
  } catch (error) {
    console.error("[API feature-flags/clients] Error listando overrides por cliente:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { configId, action } = body as { configId?: string; action?: string }

    if (!configId || typeof configId !== "string") {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    if (action === "reset") {
      await resetClientFeatureFlags(configId)
      clearFeatureFlagsCache()
      return NextResponse.json({ success: true, rawFlags: {} })
    }

    if (action === "prune") {
      const keysToKeep = body?.keysToKeep
      if (!Array.isArray(keysToKeep) || !keysToKeep.every((k) => ALL_FLAG_KEYS.includes(k))) {
        return NextResponse.json({ error: "keysToKeep inválido" }, { status: 400 })
      }
      const pruned = await pruneClientFeatureFlags(configId, keysToKeep as Array<keyof FeatureFlags>)
      clearFeatureFlagsCache()
      return NextResponse.json({ success: true, rawFlags: pruned })
    }

    return NextResponse.json({ error: `Acción no válida: ${action}` }, { status: 400 })
  } catch (error) {
    console.error("[API feature-flags/clients] Error procesando acción:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
