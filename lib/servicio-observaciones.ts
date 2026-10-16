/**
 * La observación que se escribe sobre un cliente en la pestaña Servicio
 * (16/10/2026).
 *
 * Texto libre, uno por cliente, igual en todos los meses — la misma forma que
 * el alias de Facturación (lib/facturacion-alias.ts), y por eso sigue su mismo
 * patrón.
 *
 * ── Que no varíe por mes es una decisión, no un olvido ─────────────────────
 *
 * La tabla tiene un selector de período arriba, así que lo natural sería
 * esperar que la nota cambie al cambiar de mes. No lo hace: lo que se escriba
 * acá va a seguir viéndose en noviembre y en diciembre. Se eligió así
 * explícitamente; si algún día hace falta una nota por período, la clave pasa a
 * ser `clienteId:mes` y hay que decidir qué hacer con las que ya están
 * guardadas sin mes.
 *
 * ── Por qué una clave propia y no la de Facturación ────────────────────────
 *
 * `facturacion:alias:` y esto son dos campos distintos de dos pestañas que ya
 * empezaron a separarse —Servicio no muestra ni Alias ni CUIT—. Compartir el
 * almacenamiento ataría de nuevo lo que se está desatando, y además son de
 * quienes no son los mismos: el alias lo edita un Agente de Facturación y esto
 * sólo un super_admin.
 */

import { Redis } from "@upstash/redis"
import { OBSERVACION_MAX } from "./servicio-observacion-texto"

const OBSERVACION_PREFIX = "servicio:observacion:"

// Se reexporta para que el endpoint lo tome de acá y no tenga que saber que
// existe el archivo de al lado. El valor vive en servicio-observacion-texto.ts,
// que es el que puede importar un componente de cliente.
export { OBSERVACION_MAX }

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[servicio-observaciones] Error creando Redis client:", error)
    return null
  }
}

export async function setObservacion(clienteId: string, observacion: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  const limpio = observacion.trim().slice(0, OBSERVACION_MAX)

  // Vacío borra la clave en vez de guardar un string vacío: así el mapa que
  // lee la tabla no se llena de entradas que no dicen nada. Mismo criterio que
  // `setAlias`.
  if (!limpio) {
    await redis.del(`${OBSERVACION_PREFIX}${clienteId}`)
    return
  }

  await redis.set(`${OBSERVACION_PREFIX}${clienteId}`, limpio)
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const allKeys: string[] = []
  let cursor = "0"
  do {
    const result = await redis.scan(cursor, { match: pattern, count: 100 })
    // `String(...)` y no el ternario con `typeof === "number"` que hay en
    // facturacion-alias.ts: en esta versión del cliente `scan` devuelve el
    // cursor como string, así que esa rama es código muerto y el typecheck la
    // marca (lib/facturacion-alias.ts:60 arrastra ese error desde entonces).
    cursor = String(result[0])
    allKeys.push(...result[1])
  } while (cursor !== "0")
  return allKeys
}

/**
 * Todas las observaciones guardadas.
 *
 * Se escanean las claves en vez de pedirlas por una lista de clientes conocida,
 * por lo mismo que `getAllAliases`: los clientes de "sin IA" no existen en
 * WhatsAppConfig y quedarían afuera.
 */
export async function getAllObservaciones(): Promise<Record<string, string>> {
  const redis = getRedisClient()
  if (!redis) return {}

  const keys = await scanKeys(redis, `${OBSERVACION_PREFIX}*`)
  if (keys.length === 0) return {}

  const valores = await Promise.all(keys.map((key) => redis.get<string>(key)))

  const resultado: Record<string, string> = {}
  keys.forEach((key, idx) => {
    const value = valores[idx]
    if (!value) return
    resultado[key.slice(OBSERVACION_PREFIX.length)] = value
  })
  return resultado
}
