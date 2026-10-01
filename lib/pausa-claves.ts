/**
 * Claves de API para que el cliente pause sus propios envíos (1/10/2026).
 *
 * ── Por qué una clave por cliente y no un secreto compartido ───────────────
 *
 * Porque lo que esta clave permite hacer es dejar muda a una clínica médica por
 * tiempo indefinido. Un único secreto en una variable de entorno, repartido
 * entre todos los clientes, significa que una filtración en cualquiera de ellos
 * deja a TODOS a merced de quien la tenga. Con una clave por cliente, el daño
 * de una filtración se termina en ese cliente y se corta rotándole la clave.
 *
 * ── Se guarda el hash, no la clave ─────────────────────────────────────────
 *
 * La clave en claro se muestra UNA vez, cuando se emite, y después no existe
 * más de nuestro lado. Si se pierde, se emite otra; no hay forma de
 * recuperarla, y eso es una propiedad y no una molestia: nuestra base deja de
 * ser un lugar donde robar credenciales ajenas.
 *
 * El índice va del hash al cliente para que verificar sea una sola lectura y no
 * un recorrido por todas las claves.
 */

import { createHash, randomBytes } from "crypto"

import { getRedisClient } from "./redis"

const CLAVE_A_CONFIG = "pausa:clave:"
const CONFIG_A_DATOS = "pausa:clave_de:"

/** Prefijo visible, para que en el dashboard se distinga una clave de otra. */
const PREFIJO_VISIBLE = "trl_"

function hash(clave: string): string {
  return createHash("sha256").update(clave).digest("hex")
}

export interface DatosDeLaClave {
  /** Los primeros caracteres, para identificarla sin poder usarla. */
  muestra: string
  creadaEl: string
  creadaPor?: string
}

/**
 * Emite una clave nueva para el cliente y revoca la anterior.
 *
 * Revocar al emitir es deliberado: dos claves vivas para el mismo cliente
 * significan que rotarla por sospecha de filtración no sirve de nada, porque la
 * vieja sigue andando.
 */
export async function emitirClave(
  configId: string,
  creadaPor?: string,
): Promise<{ clave: string; datos: DatosDeLaClave } | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const anterior = await redis.get<string>(`${CONFIG_A_DATOS}${configId}:hash`)
  if (anterior) await redis.del(`${CLAVE_A_CONFIG}${anterior}`)

  const clave = PREFIJO_VISIBLE + randomBytes(24).toString("base64url")
  const h = hash(clave)

  const datos: DatosDeLaClave = {
    muestra: `${clave.slice(0, 10)}…`,
    creadaEl: new Date().toISOString(),
    creadaPor,
  }

  await redis.set(`${CLAVE_A_CONFIG}${h}`, configId)
  await redis.set(`${CONFIG_A_DATOS}${configId}`, JSON.stringify(datos))
  await redis.set(`${CONFIG_A_DATOS}${configId}:hash`, h)

  console.log(`[PAUSA_CLAVES] Clave emitida para ${configId}${creadaPor ? ` por ${creadaPor}` : ""}`)
  return { clave, datos }
}

/** El `configId` al que pertenece la clave, o `null` si no vale. */
export async function configDeLaClave(clave?: string | null): Promise<string | null> {
  if (!clave || typeof clave !== "string") return null

  const redis = getRedisClient()
  if (!redis) return null

  try {
    const configId = await redis.get<string>(`${CLAVE_A_CONFIG}${hash(clave)}`)
    return configId || null
  } catch (error) {
    console.warn("[PAUSA_CLAVES] Error verificando la clave:", error)
    return null
  }
}

/** Para mostrar en el dashboard si el cliente ya tiene clave y de cuándo es. */
export async function datosDeLaClave(configId: string): Promise<DatosDeLaClave | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const crudo = await redis.get(`${CONFIG_A_DATOS}${configId}`)
    if (!crudo) return null
    return typeof crudo === "string" ? JSON.parse(crudo) : (crudo as DatosDeLaClave)
  } catch {
    return null
  }
}

export async function revocarClave(configId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return

  const h = await redis.get<string>(`${CONFIG_A_DATOS}${configId}:hash`)
  if (h) await redis.del(`${CLAVE_A_CONFIG}${h}`)
  await redis.del(`${CONFIG_A_DATOS}${configId}`)
  await redis.del(`${CONFIG_A_DATOS}${configId}:hash`)
  console.log(`[PAUSA_CLAVES] Clave revocada para ${configId}`)
}
