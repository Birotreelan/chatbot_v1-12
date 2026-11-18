import { type NextRequest, NextResponse } from "next/server"
import { requireAuthFromRequest, requireAuthForApi } from "@/lib/auth"
import {
  getEffectiveGlobalFeatureFlags,
  setGlobalFeatureFlags,
  resetGlobalFeatureFlags,
  clearFeatureFlagsCache,
} from "@/lib/conversation-state/feature-flags"
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from "@/lib/conversation-state/types"

/**
 * Panel de administración de feature flags GLOBALES (18/8/2026, pedido de Nicolás:
 * poder desactivar flags como intentRouterFull sin pasar por un deploy).
 *
 * GET  → devuelve el estado efectivo actual de cada flag global, más cuáles de ellos
 *        siguen viniendo de GLOBAL_CODE_FEATURE_FLAG_OVERRIDES (lib/conversation-state/
 *        feature-flags.ts) porque todavía no se guardaron explícitamente en Redis.
 * POST → guarda un set completo de flags en Redis global. A partir de ahí, Redis es la
 *        fuente de verdad para esos flags y los code overrides dejan de aplicarse
 *        (ver applyCodeOverrides en lib/conversation-state/feature-flags.ts).
 *
 * Sin autenticación propia, mismo criterio que el resto de /api/dashboard/* en este
 * repo (confiado a nivel de red/frontend, no hay chequeo de sesión en estas rutas).
 */

const FLAG_KEYS = Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>

/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Prende y apaga comportamientos del bot para TODOS los clientes.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET() {
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const { flags, hasExplicitData, codeOverriddenKeys } = await getEffectiveGlobalFeatureFlags()
    return NextResponse.json({
      flags,
      hasExplicitData,
      codeOverriddenKeys,
      availableKeys: FLAG_KEYS,
    })
  } catch (error) {
    console.error("[API feature-flags] Error obteniendo flags globales:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


  try {
    const body = await request.json()

    if (body?.reset === true) {
      await resetGlobalFeatureFlags()
      clearFeatureFlagsCache()
      const { flags, hasExplicitData, codeOverriddenKeys } = await getEffectiveGlobalFeatureFlags()
      return NextResponse.json({ flags, hasExplicitData, codeOverriddenKeys, availableKeys: FLAG_KEYS })
    }

    const incoming = body?.flags
    if (!incoming || typeof incoming !== "object") {
      return NextResponse.json({ error: "Body debe incluir { flags: {...} }" }, { status: 400 })
    }

    // Validar que solo vengan claves conocidas de FeatureFlags, con valores booleanos.
    const sanitized: Partial<FeatureFlags> = {}
    for (const key of FLAG_KEYS) {
      if (key in incoming) {
        if (typeof incoming[key] !== "boolean") {
          return NextResponse.json({ error: `El flag "${key}" debe ser boolean` }, { status: 400 })
        }
        sanitized[key] = incoming[key]
      }
    }

    // Se guarda el set COMPLETO recibido (no un parche parcial): el panel siempre debe
    // enviar todos los flags (FLAG_KEYS) con su valor efectivo actual, así Redis queda
    // como una copia completa y coherente, sin depender de qué había antes en Redis vs
    // en los code overrides (ver comentario de applyCodeOverrides).
    await setGlobalFeatureFlags(sanitized)
    clearFeatureFlagsCache()

    const { flags, hasExplicitData, codeOverriddenKeys } = await getEffectiveGlobalFeatureFlags()
    return NextResponse.json({ flags, hasExplicitData, codeOverriddenKeys, availableKeys: FLAG_KEYS })
  } catch (error) {
    console.error("[API feature-flags] Error guardando flags globales:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
