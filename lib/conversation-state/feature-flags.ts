/**
 * Sistema de feature flags para activación gradual de funcionalidades
 * Permite rollback inmediato sin deploy si algo falla
 */

import { getRedisClient } from "@/lib/redis"
import { DEFAULT_FEATURE_FLAGS, FeatureFlags } from "./types"

const FEATURE_FLAGS_PREFIX = "feature_flags:"

// Caché en memoria con TTL de 5 segundos para evitar múltiples roundtrips a Redis
// por mensaje (getEffectiveFeatureFlags se llama ~15 veces por mensaje en whatsapp.tsx)
const flagsCache = new Map<string, { flags: FeatureFlags; expiresAt: number }>()
const FLAGS_CACHE_TTL_MS = 5000

/**
 * Obtener feature flags para un cliente específico
 * Si no existen flags específicos, busca flags GLOBALES
 * Si tampoco hay globales, usa los defaults (todos OFF para máxima seguridad)
 */
export async function getClientFeatureFlags(configId: string): Promise<FeatureFlags> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.warn(`[FEATURE-FLAGS] Redis no disponible para ${configId}, usando defaults`)
      return DEFAULT_FEATURE_FLAGS
    }

    const key = `${FEATURE_FLAGS_PREFIX}${configId}`
    const cached = await redis.get(key)

    if (cached) {
      // Upstash REST client auto-deserializa JSON — si ya es objeto, no hacer JSON.parse
      return (typeof cached === "string" ? JSON.parse(cached) : cached) as FeatureFlags
    }

    // No hay flags específicos - buscar flags GLOBALES
    const globalKey = `${FEATURE_FLAGS_PREFIX}__global__`
    const globalCached = await redis.get(globalKey)
    
    if (globalCached) {
      return (typeof globalCached === "string" ? JSON.parse(globalCached) : globalCached) as FeatureFlags
    }

    return DEFAULT_FEATURE_FLAGS
  } catch (error) {
    console.error(`[FEATURE-FLAGS] Error obteniendo flags para ${configId}:`, error)
    return DEFAULT_FEATURE_FLAGS
  }
}

/**
 * Establecer feature flags para un cliente
 * Se usa desde el dashboard/API para activar/desactivar features
 */
export async function setClientFeatureFlags(
  configId: string,
  flags: Partial<FeatureFlags>
): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.warn(`[FEATURE-FLAGS] Redis no disponible para guardar flags de ${configId}`)
      return
    }

    // Obtener flags actuales y mergear con nuevos
    const current = await getClientFeatureFlags(configId)
    const updated = { ...current, ...flags }

    const key = `${FEATURE_FLAGS_PREFIX}${configId}`
    // TTL de 7 días - Upstash serializa automáticamente, no usar JSON.stringify
    await redis.setex(key, 7 * 24 * 60 * 60, updated as unknown as string)

    console.info(`[FEATURE-FLAGS] ✓ Flags actualizados para ${configId}`, {
      updated,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error(`[FEATURE-FLAGS] Error guardando flags para ${configId}:`, error)
    throw error
  }
}

/**
 * Resetear a defaults (útil para rollback rápido)
 */
export async function resetClientFeatureFlags(configId: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.warn(`[FEATURE-FLAGS] Redis no disponible para resetear flags de ${configId}`)
      return
    }

    const key = `${FEATURE_FLAGS_PREFIX}${configId}`
    await redis.del(key)

    console.warn(`[FEATURE-FLAGS] ⚠️ Flags reseteados a defaults para ${configId}`)
  } catch (error) {
    console.error(`[FEATURE-FLAGS] Error reseteando flags para ${configId}:`, error)
    throw error
  }
}

/**
 * Helper: Chequear si una feature específica está activa
 */
export async function isFeatureEnabled(
  configId: string,
  featureName: keyof FeatureFlags
): Promise<boolean> {
  const flags = await getClientFeatureFlags(configId)
  return flags[featureName] === true
}

/**
 * Helper: Activar una feature específica (para testing gradual)
 */
export async function enableFeature(
  configId: string,
  featureName: keyof FeatureFlags
): Promise<void> {
  await setClientFeatureFlags(configId, { [featureName]: true })
}

/**
 * Helper: Desactivar una feature específica (para rollback rápido)
 */
export async function disableFeature(
  configId: string,
  featureName: keyof FeatureFlags
): Promise<void> {
  await setClientFeatureFlags(configId, { [featureName]: false })
}

/**
 * Clave global para flags que aplican a TODOS los clientes por defecto
 */
const GLOBAL_FLAGS_KEY = `${FEATURE_FLAGS_PREFIX}__global__`

/**
 * Obtener flags globales (aplican a todos los clientes que no tienen flags específicos)
 */
export async function getGlobalFeatureFlags(): Promise<FeatureFlags> {
  try {
    const redis = getRedisClient()
    if (!redis) return DEFAULT_FEATURE_FLAGS

    const cached = await redis.get(GLOBAL_FLAGS_KEY)
    if (cached) {
      return (typeof cached === "string" ? JSON.parse(cached) : cached) as FeatureFlags
    }
    return DEFAULT_FEATURE_FLAGS
  } catch (err) {
    console.error("[FEATURE-FLAGS] Error obteniendo flags globales:", err)
    return DEFAULT_FEATURE_FLAGS
  }
}

/**
 * Establecer flags globales (aplican a todos los clientes que no tienen flags específicos)
 */
export async function setGlobalFeatureFlags(flags: Partial<FeatureFlags>): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const current = await getGlobalFeatureFlags()
  const updated = { ...current, ...flags }

  // Upstash serializa automáticamente, no usar JSON.stringify
  await redis.setex(GLOBAL_FLAGS_KEY, 30 * 24 * 60 * 60, updated as unknown as string)
}

/**
 * Resetear flags globales a defaults
 */
export async function resetGlobalFeatureFlags(): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  await redis.del(GLOBAL_FLAGS_KEY)
  console.warn(`[FEATURE-FLAGS] ⚠️ Flags GLOBALES reseteados a defaults`)
}

/**
 * Overrides de flags fijados por código, para activar funcionalidades ya validadas
 * mientras no se dispone de acceso directo a Redis de producción para setearlas
 * vía `setClientFeatureFlags`/`setGlobalFeatureFlags` (el camino normal: script
 * `scripts/activate-sprint9.ts` como referencia, o `/dashboard/feature-flags`).
 *
 * GLOBAL_CODE_FEATURE_FLAG_OVERRIDES se aplica a TODOS los clientes, SIEMPRE, por
 * encima de cualquier valor guardado en Redis (client-specific o global) — es el
 * mecanismo de mayor prioridad. Pedido explícito de Nicolás (9/7/2026): que las
 * mejoras que vayamos validando se activen para todos los clientes, no solo el que
 * originó el caso.
 *
 * Para revertir un flag alcanza con sacar la entrada de acá (no hace falta Redis).
 * Cuando en algún momento se recupere acceso a Redis de producción, lo prolijo es
 * migrar estas entradas a `setGlobalFeatureFlags` y vaciar este objeto.
 */
const GLOBAL_CODE_FEATURE_FLAG_OVERRIDES: Partial<FeatureFlags> = {
  // Activado el 9/7/2026 tras confirmar que "Siiii gracias" y respuestas similares
  // por texto libre no confirmaban el turno dentro de la ventana de recordatorio
  // (caso Susana / caso "Siiii gracias", tel. 1123517624). Válido para todos los
  // clientes, no solo Vision Salud / Salud Ocular.
  directConfirmCancelDetection: true,

  // Activado el 6/8/2026 a pedido explícito de Nicolás: "es algo que veníamos
  // usando, debería estar activa". Con este flag OFF, el AI Dispatcher delegaba
  // el saludo inicial ("hola" en frío, sin recordatorio activo) al asistente de
  // OpenAI, que responde de forma libre sin el menú numerado con botones
  // (1- Solicitar turno / 2- Turno para familiar / 3- Otra consulta) que arma
  // initializePatientDetection en lib/conversation-state/patient-detection/
  // patient-flow-integration.ts. Con el flag ON, ese flujo determinístico
  // vuelve a ser el que responde, en vez de OpenAI.
  directPatientDetection: true,
}

function applyCodeOverrides(_configId: string, flags: FeatureFlags): FeatureFlags {
  return { ...flags, ...GLOBAL_CODE_FEATURE_FLAG_OVERRIDES }
}

/**
 * Obtener flags para un cliente: primero busca flags específicos,
 * si no tiene, usa los flags globales (que pueden diferir de los defaults)
 */
export async function getEffectiveFeatureFlags(configId: string): Promise<FeatureFlags> {
  // Devolver de caché si aún es válido
  const now = Date.now()
  const cached = flagsCache.get(configId)
  if (cached && cached.expiresAt > now) {
    return cached.flags
  }

  try {
    const redis = getRedisClient()
    if (!redis) return applyCodeOverrides(configId, DEFAULT_FEATURE_FLAGS)

    const clientKey = `${FEATURE_FLAGS_PREFIX}${configId}`
    const clientData = await redis.get(clientKey)

    // Si tiene flags específicos, úsalos
    let flags: FeatureFlags
    if (clientData) {
      flags = (typeof clientData === "string" ? JSON.parse(clientData) : clientData) as FeatureFlags
    } else {
      // Si no, usar flags globales
      flags = await getGlobalFeatureFlags()
    }

    flags = applyCodeOverrides(configId, flags)

    flagsCache.set(configId, { flags, expiresAt: now + FLAGS_CACHE_TTL_MS })
    return flags
  } catch (err) {
    console.error(`[FEATURE-FLAGS] Error obteniendo flags efectivos para ${configId}:`, err)
    return applyCodeOverrides(configId, DEFAULT_FEATURE_FLAGS)
  }
}

/**
 * Listar todos los clientes con feature flags personalizados
 * Útil para dashboard de monitoreo
 */
export async function listClientsWithCustomFlags(): Promise<
  Array<{ configId: string; flags: FeatureFlags }>
> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.warn(`[FEATURE-FLAGS] Redis no disponible para listar clientes`)
      return []
    }

    const keys = await redis.keys(`${FEATURE_FLAGS_PREFIX}*`)
    const results: Array<{ configId: string; flags: FeatureFlags }> = []

    for (const key of keys) {
      const configId = key.replace(FEATURE_FLAGS_PREFIX, "")
      const flags = await getClientFeatureFlags(configId)
      results.push({ configId, flags })
    }

    return results
  } catch (error) {
    console.error(`[FEATURE-FLAGS] Error listando clientes:`, error)
    return []
  }
}
