/**
 * El dólar fijado a mano para un mes de Facturación, cuando el mes todavía no
 * cerró (2/11/2026).
 *
 * ── Por qué sólo para el mes abierto ───────────────────────────────────────
 *
 * Porque un mes cerrado ya tiene su dólar guardado en el cierre, y ése es el
 * lugar donde vive el número de ese mes. Corregirlo se hace ahí
 * (`corregirDolarDelMes`), no acá: si hubiera dos lugares donde está el dólar
 * de septiembre, la tabla y el encabezado podrían decir cosas distintas — que
 * es exactamente el error que este módulo de facturación ya arrastró una vez.
 *
 * Entonces: mes abierto, el valor sale de acá si alguien lo fijó, y si no del
 * dólar del día. Mes cerrado, del cierre. Un solo número por mes, siempre.
 *
 * Es el mismo patrón que lib/servicio-dolar.ts, con su propia clave: son dos
 * pestañas distintas y el que fija una no tiene por qué cambiar la otra.
 */

import { Redis } from "@upstash/redis"

const PREFIJO = "facturacion:dolar:"

function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.error("[facturacion-dolar-mes] Error creando Redis client:", error)
    return null
  }
}

/** El dólar fijado para ese período, o `null` si nadie lo fijó. */
export async function getDolarDelMes(periodo: string): Promise<number | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const valor = await redis.get<number | string>(`${PREFIJO}${periodo}`)
  if (valor === null || valor === undefined) return null
  const num = typeof valor === "string" ? parseFloat(valor) : valor
  return Number.isFinite(num) && num > 0 ? num : null
}

/**
 * Fija el dólar de un período. Con `null` o 0 se borra y se vuelve al del día.
 *
 * Poder volver atrás importa: si alguien carga un valor equivocado, sin esto la
 * única salida sería escribir el "correcto", y el mes quedaría con un número
 * inventado en vez de con el del día.
 */
export async function setDolarDelMes(periodo: string, valor: number | null): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  if (!valor || !Number.isFinite(valor) || valor <= 0) {
    await redis.del(`${PREFIJO}${periodo}`)
    return
  }
  await redis.set(`${PREFIJO}${periodo}`, valor)
}
