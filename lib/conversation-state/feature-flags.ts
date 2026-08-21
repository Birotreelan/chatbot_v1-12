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
 * Enumera claves por patrón vía SCAN en vez de KEYS (21/8/2026: se detectó que
 * redis.keys("feature_flags:*") no devolvía la clave de un cliente que SÍ
 * existía y se leía bien con redis.get() directo — caso Instituto Privado de
 * Ojos Dres. Filomena, configId pJ49swKTv_QZIG_7MBcKP. lib/db.tsx ya evita
 * .keys() por el mismo motivo para listar configs; se replica ese patrón acá
 * en vez de depender de una importación cruzada).
 */
async function scanKeysByPattern(redisClient: NonNullable<ReturnType<typeof getRedisClient>>, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"
  do {
    const result = await redisClient.scan(cursor, { match: pattern, count: 100 })
    cursor = typeof result[0] === "number" ? result[0].toString() : result[0]
    allKeys.push(...result[1])
  } while (cursor !== "0")
  return allKeys
}

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
 * Lee lo que hay guardado LITERALMENTE en la clave Redis del cliente, sin
 * fallback a global/DEFAULT_FEATURE_FLAGS. Devuelve `null` si el cliente
 * todavía no tiene ninguna clave propia.
 */
export async function getRawClientFlags(configId: string): Promise<Partial<FeatureFlags> | null> {
  const redis = getRedisClient()
  if (!redis) return null
  const key = `${FEATURE_FLAGS_PREFIX}${configId}`
  const cached = await redis.get(key)
  if (!cached) return null
  return (typeof cached === "string" ? JSON.parse(cached) : cached) as Partial<FeatureFlags>
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

    // 21/8/2026 (caso Instituto Privado de Ojos Dres. Filomena, configId
    // pJ49swKTv_QZIG_7MBcKP): antes esto mezclaba con getClientFeatureFlags,
    // que resuelve con fallback a global/DEFAULT_FEATURE_FLAGS pero SIN
    // aplicar GLOBAL_CODE_FEATURE_FLAG_OVERRIDES — y grababa ese resultado
    // COMPLETO como snapshot fijo del cliente. Resultado: la primera vez que
    // alguien activaba "Atención Humana" desde su propio panel
    // (app/api/support/settings/route.ts), el cliente quedaba congelado con
    // directPatientDetection/directConfirmation/directBookingFlow/etc. TODOS
    // en false (los defaults), excluido para siempre de los overrides que se
    // activan por código para todos los demás clientes. El síntoma: el bot
    // dejaba de mostrar el menú determinístico y derivaba todo a OpenAI.
    // Ahora el merge es solo contra lo que YA estaba guardado explícitamente
    // para este cliente (getRawClientFlags, sin resolver fallback) — el
    // resultado queda como una capa PARCIAL de overrides sobre los flags
    // globales/código, no como un reemplazo total. Ver getEffectiveFeatureFlags
    // más abajo, que aplica primero global+código y recién después superpone
    // esto.
    const existing = (await getRawClientFlags(configId)) ?? {}
    const updated = { ...existing, ...flags }

    const key = `${FEATURE_FLAGS_PREFIX}${configId}`
    // Sin TTL a propósito (6/8/2026): antes tenía setex de 7 días y el flag se
    // desactivaba solo, sin ningún error ni log, cuando vencía la clave en Redis
    // (caso directPatientDetection: funcionaba y de repente dejó de responder
    // con el menú determinístico porque la clave expiró). Los feature flags
    // deben persistir hasta que alguien los cambie explícitamente.
    // Upstash serializa automáticamente, no usar JSON.stringify.
    await redis.set(key, updated as unknown as string)

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

  // Sin TTL a propósito (6/8/2026, mismo motivo que setClientFeatureFlags):
  // los flags globales no deben vencerse solos. Upstash serializa
  // automáticamente, no usar JSON.stringify.
  await redis.set(GLOBAL_FLAGS_KEY, updated as unknown as string)
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
 * `scripts/activate-sprint9.ts` como referencia, o el panel `/api/dashboard/
 * feature-flags`, agregado 18/8/2026 — ver GET/POST en app/api/dashboard/
 * feature-flags/route.ts).
 *
 * GLOBAL_CODE_FEATURE_FLAG_OVERRIDES se aplica a TODOS los clientes SIEMPRE QUE Redis
 * todavía no tenga un valor explícito guardado para ese flag (ver hasExplicitData en
 * applyCodeOverrides, más abajo) — es el comportamiento por defecto hasta que alguien
 * lo guarda desde el panel. Pedido explícito de Nicolás (9/7/2026): que las mejoras
 * que vayamos validando se activen para todos los clientes, no solo el que originó
 * el caso. Pedido explícito de Nicolás (18/8/2026): poder desactivar estos flags
 * desde el panel sin depender de un deploy — por eso un valor guardado en Redis
 * ahora SÍ le gana a esta lista.
 *
 * Para revertir un flag sin usar el panel, alcanza con sacar la entrada de acá
 * (no hace falta Redis) — pero si el panel ya guardó un valor explícito para ese
 * flag en Redis, hay que resetearlo desde ahí (o vía resetGlobalFeatureFlags) para
 * que vuelva a depender de esta lista.
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

  // Activados el 6/8/2026, mismo día y mismo motivo que directPatientDetection:
  // son la familia completa de flags "Sprint 1-18" del sistema determinístico
  // (detección de paciente → paciente existente/nuevo → booking → selección de
  // turno → confirmación/cancelación → DNI → despedidas → consultas
  // informativas → NLU de fallback). Se pasan la posta unos a otros: al activar
  // solo directPatientDetection, el menú inicial funcionaba pero el siguiente
  // paso (ej. "1- Solicitar turno" → initializeExistingPatientFlow) se cortaba
  // en silencio porque directPacienteExistente seguía OFF (mismo bug de fondo:
  // el flag correspondiente vencido por el TTL de setClientFeatureFlags/
  // setGlobalFeatureFlags, ya corregido). Se activa toda la familia junta para
  // no seguir pisando el mismo problema flag por flag en cada paso del flujo.
  //
  // Quedan afuera a propósito (requieren decisión aparte, no son parte de esta
  // cadena determinística): humanSupport / humanSupportOfferToPatient
  // (subsistema de atención humana, depende de agentes configurados por
  // cliente) e intentRouterClinicaOffer (variante no usada de intentRouterFull).
  directConfirmation: true,
  directCancellation: true,
  directTurnSelection: true,
  directDNIExtraction: true,
  antiRepetitionFarewell: true,
  directReagendamiento: true,
  directPacienteNuevo: true,
  directPacienteExistente: true,
  directBookingFlow: true,
  pendingFlowContextualNLU: true,
  directFarewellDetection: true,
  directWrongNumberDetection: true,
  reciprocalFarewellSilence: true,
  directInformationalQuery: true,
  postActionContextHandler: true,
  nluFallbackRouter: true,
  flowInterruptionHandler: true,

  // Activado el 18/8/2026, pedido explícito de Nicolás: pasar el AI Dispatcher
  // a ser decisor primario (en vez de solo el filtro previo a enqueueUserMessage)
  // para TODOS los clientes, como primer paso hacia una versión más
  // conversacional/fluida ("revisión integral para nueva versión", 18/8/2026).
  // Con este flag ON: (a) runPrimaryDispatcherNoFlow decide antes que la
  // cascada de interceptores regex/Sprint 9-18, y (b) runInterjectionInActiveFlow
  // queda habilitado, permitiendo que un mensaje dentro de un flujo de reserva
  // activo (ej: "en realidad quiero cancelar") cambie de intención sin perder
  // el estado, reusando el mismo manifest de 12 tools del dispatcher (ver
  // lib/conversation-state/ai-dispatcher/tool-manifest.ts).
  //
  // Este es un cambio de comportamiento amplio (afecta el routing de CADA
  // mensaje entrante, no un flujo puntual) — si aparece algún patrón de
  // regresión en producción, revertir sacando esta entrada (no hace falta
  // tocar nada más) es más rápido que hacerlo vía Redis global porque no
  // depende de tener acceso directo a producción.
  intentRouterFull: true,
}

/**
 * hasExplicitData=true significa que YA hay un valor guardado explícitamente en Redis
 * (client-specific o global, vía setClientFeatureFlags/setGlobalFeatureFlags — típicamente
 * desde el panel /api/dashboard/feature-flags). En ese caso Redis es la fuente de verdad
 * y NO se pisa con GLOBAL_CODE_FEATURE_FLAG_OVERRIDES, aunque el flag esté en ese objeto.
 * Si Redis todavía no tiene nada explícito, los code overrides siguen actuando como
 * comportamiento por defecto (mismo mecanismo de siempre, sin cambios).
 * Nicolás pidió (18/8/2026) poder desactivar estos flags desde el dashboard sin pasar
 * por un deploy — antes GLOBAL_CODE_FEATURE_FLAG_OVERRIDES ganaba SIEMPRE, así que un
 * toggle guardado en Redis quedaba sin efecto para los flags listados ahí.
 */
function applyCodeOverrides(_configId: string, flags: FeatureFlags, hasExplicitData: boolean): FeatureFlags {
  if (hasExplicitData) return flags
  return { ...flags, ...GLOBAL_CODE_FEATURE_FLAG_OVERRIDES }
}

/**
 * Invalida la caché en memoria de flags efectivos. Se llama después de guardar
 * cambios desde el panel de feature flags para que tomen efecto de inmediato,
 * en vez de esperar hasta 5s (FLAGS_CACHE_TTL_MS) a que expire sola.
 */
export function clearFeatureFlagsCache(): void {
  flagsCache.clear()
}

/**
 * Obtener flags para un cliente: parte de los flags globales (con los overrides
 * de código aplicados, salvo que ya haya un valor global explícito guardado) y
 * les superpone, si existen, los overrides PARCIALES propios del cliente (ej.
 * "Atención Humana" activada desde su panel). El override de cliente solo pisa
 * las claves que tiene explícitamente guardadas — no reemplaza el resto.
 *
 * 21/8/2026: antes, si el cliente tenía CUALQUIER dato propio en Redis, se
 * usaba ese objeto completo y se saltaban los overrides de código enteros
 * (no solo para las claves que el cliente había tocado). Ver nota extensa en
 * setClientFeatureFlags sobre el caso real que esto rompió.
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
    if (!redis) return applyCodeOverrides(configId, DEFAULT_FEATURE_FLAGS, false)

    // Base: flags globales (explícitos si existen, si no defaults), con los
    // overrides de código aplicados salvo que el global ya tenga un valor
    // explícito guardado — mismo criterio de siempre, pero ahora evaluado
    // SOLO contra el global, no contra el cliente.
    const globalCached = await redis.get(GLOBAL_FLAGS_KEY)
    let base: FeatureFlags
    let hasExplicitGlobalData: boolean
    if (globalCached) {
      base = (typeof globalCached === "string" ? JSON.parse(globalCached) : globalCached) as FeatureFlags
      hasExplicitGlobalData = true
    } else {
      base = DEFAULT_FEATURE_FLAGS
      hasExplicitGlobalData = false
    }
    base = applyCodeOverrides(configId, base, hasExplicitGlobalData)

    // Encima: override parcial del cliente, si existe — solo pisa sus propias claves.
    const clientCached = await redis.get(`${FEATURE_FLAGS_PREFIX}${configId}`)
    let flags = base
    if (clientCached) {
      const clientOverrides = (typeof clientCached === "string" ? JSON.parse(clientCached) : clientCached) as Partial<FeatureFlags>
      flags = { ...base, ...clientOverrides }
    }

    flagsCache.set(configId, { flags, expiresAt: now + FLAGS_CACHE_TTL_MS })
    return flags
  } catch (err) {
    console.error(`[FEATURE-FLAGS] Error obteniendo flags efectivos para ${configId}:`, err)
    return applyCodeOverrides(configId, DEFAULT_FEATURE_FLAGS, false)
  }
}

/**
 * Estado efectivo de los flags GLOBALES (sin considerar overrides client-specific),
 * pensado para el panel de administración: qué valor está realmente activo hoy y si
 * ese valor viene de Redis (editable desde el panel) o de GLOBAL_CODE_FEATURE_FLAG_OVERRIDES
 * (todavía no migrado a Redis — el panel puede "adoptarlo" guardándolo tal cual).
 */
export async function getEffectiveGlobalFeatureFlags(): Promise<{
  flags: FeatureFlags
  hasExplicitData: boolean
  codeOverriddenKeys: Array<keyof FeatureFlags>
}> {
  const globalStored = await getGlobalFeatureFlags()
  const redis = getRedisClient()
  let hasExplicitData = false
  if (redis) {
    const raw = await redis.get(GLOBAL_FLAGS_KEY)
    hasExplicitData = !!raw
  }
  const flags = applyCodeOverrides("__global__", globalStored, hasExplicitData)
  const codeOverriddenKeys = hasExplicitData
    ? []
    : (Object.keys(GLOBAL_CODE_FEATURE_FLAG_OVERRIDES) as Array<keyof FeatureFlags>)
  return { flags, hasExplicitData, codeOverriddenKeys }
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

    const keys = await scanKeysByPattern(redis, `${FEATURE_FLAGS_PREFIX}*`)
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

/**
 * Listar clientes que tienen una clave propia en Redis (excluye __global__),
 * con lo que hay guardado LITERALMENTE ahí (sin resolver fallback). Pensado
 * para auditar, desde el panel, qué clientes tienen overrides propios y
 * detectar snapshots viejos "congelados" con muchas claves de más (ver nota
 * en setClientFeatureFlags) — a diferencia de listClientsWithCustomFlags,
 * que devuelve el resultado ya resuelto y no distingue cuántas claves son
 * realmente overrides propios del cliente.
 */
export async function listClientsWithRawFlags(): Promise<
  Array<{ configId: string; rawFlags: Partial<FeatureFlags> }>
> {
  try {
    const redis = getRedisClient()
    if (!redis) return []

    const keys = await scanKeysByPattern(redis, `${FEATURE_FLAGS_PREFIX}*`)
    const results: Array<{ configId: string; rawFlags: Partial<FeatureFlags> }> = []

    for (const key of keys) {
      const configId = key.replace(FEATURE_FLAGS_PREFIX, "")
      if (configId === "__global__") continue
      const raw = await getRawClientFlags(configId)
      if (raw) results.push({ configId, rawFlags: raw })
    }

    return results
  } catch (error) {
    console.error(`[FEATURE-FLAGS] Error listando flags crudos de clientes:`, error)
    return []
  }
}

/**
 * Recorta el override guardado de un cliente a solo las claves indicadas,
 * eliminando el resto (si no queda ninguna, borra la clave directamente).
 * Pensado para limpiar snapshots viejos "congelados" sin perder los toggles
 * que el cliente sí controla activamente hoy (ej. humanSupport desde su
 * propio panel de Atención). Caso real: Instituto Privado de Ojos Dres.
 * Filomena (configId pJ49swKTv_QZIG_7MBcKP), ver nota en setClientFeatureFlags.
 */
export async function pruneClientFeatureFlags(
  configId: string,
  keysToKeep: Array<keyof FeatureFlags>
): Promise<Partial<FeatureFlags>> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no disponible")

  const raw = (await getRawClientFlags(configId)) ?? {}
  const pruned: Partial<FeatureFlags> = {}
  for (const k of keysToKeep) {
    if (k in raw) pruned[k] = raw[k]
  }

  const key = `${FEATURE_FLAGS_PREFIX}${configId}`
  if (Object.keys(pruned).length === 0) {
    await redis.del(key)
  } else {
    await redis.set(key, pruned as unknown as string)
  }

  console.warn(`[FEATURE-FLAGS] ✂️ Flags de ${configId} recortados`, { pruned })
  return pruned
}
