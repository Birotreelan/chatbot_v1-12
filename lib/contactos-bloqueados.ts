/**
 * Contactos bloqueados (19/10/2026).
 *
 * ── Qué significa "bloquear" acá ───────────────────────────────────────────
 *
 * NO es el bloqueo de WhatsApp. No podemos impedir que Meta nos entregue el
 * mensaje: el webhook lo va a recibir igual. Lo que hacemos es descartarlo sin
 * responder, y no mandarle nada a ese número.
 *
 * Eso sí elimina el costo, porque lo que se paga son los mensajes SALIENTES.
 * Un entrante que no contestamos no cuesta nada.
 *
 * ── Corta en los dos sentidos ──────────────────────────────────────────────
 *
 * Entrante: no se responde, no arranca ningún flujo, no se deriva a un humano
 * y no se notifica a nadie. El mensaje sí se guarda en el historial —la clínica
 * tiene que poder ver qué siguió mandando antes de decidir desbloquear—.
 *
 * Saliente: tampoco salen recordatorios ni plantillas. Decidido así con Nicolás
 * el 19/10/2026. Si sólo cortara lo entrante, un contacto "silenciado" seguiría
 * recibiendo recordatorios que además se pagan, y la clínica creería que lo
 * silenció.
 *
 * ── Es por clínica, no global ──────────────────────────────────────────────
 *
 * La clave lleva el `configId`. El mismo teléfono puede ser un paciente normal
 * en una clínica y un problema en otra, y cada panel sólo ve lo suyo. Un
 * bloqueo global lo decidiría una clínica para todas las demás.
 *
 * ── El teléfono se normaliza SIEMPRE ───────────────────────────────────────
 *
 * El webhook trae "5493413121395" y el panel muestra "3413121395". Si se
 * guardara con una forma y se consultara con la otra, el bloqueo se vería
 * aplicado en el panel y no frenaría ni un mensaje. Por eso las dos puntas
 * pasan por `normalizePhoneNumber` acá adentro, y no en los llamadores.
 */

import { getRedisClient } from "@/lib/redis"
import { normalizePhoneNumber } from "@/lib/utils"

const PREFIJO = "contacto:bloqueado:"

export interface ContactoBloqueado {
  /** Normalizado, como se guarda. */
  phoneNumber: string
  /** ISO. */
  bloqueadoEl: string
  /** Quién lo bloqueó, para que el desbloqueo no sea una decisión anónima. */
  bloqueadoPor?: string
  /** Texto libre opcional del agente. */
  motivo?: string
}

function clave(configId: string, phoneNumber: string): string {
  return `${PREFIJO}${configId}:${normalizePhoneNumber(phoneNumber)}`
}

/**
 * ¿Este contacto está bloqueado para esta clínica?
 *
 * Ante cualquier problema devuelve `false`. Es deliberado: si Redis no
 * responde, el costo de equivocarse hacia "no bloqueado" es que un contacto
 * molesto reciba una respuesta más; hacia "bloqueado" sería dejar sin atención
 * a TODOS los pacientes de la clínica mientras dure la falla.
 */
export async function estaBloqueado(configId: string, phoneNumber: string): Promise<boolean> {
  if (!configId || !phoneNumber) return false

  try {
    const redis = getRedisClient()
    if (!redis) return false
    const valor = await redis.get(clave(configId, phoneNumber))
    return valor !== null && valor !== undefined
  } catch (error) {
    console.error("[BLOQUEO] No se pudo consultar el estado, se asume no bloqueado:", error)
    return false
  }
}

/** Los datos del bloqueo, para mostrarlos en el panel. `null` si no está. */
export async function leerBloqueo(
  configId: string,
  phoneNumber: string,
): Promise<ContactoBloqueado | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null
    const crudo = await redis.get(clave(configId, phoneNumber))
    if (!crudo) return null
    // Upstash deserializa solo lo que parece JSON, así que puede venir de las
    // dos formas.
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as unknown)
    return datos as ContactoBloqueado
  } catch (error) {
    console.error("[BLOQUEO] No se pudo leer el bloqueo:", error)
    return null
  }
}

export async function bloquearContacto(params: {
  configId: string
  phoneNumber: string
  bloqueadoPor?: string
  motivo?: string
}): Promise<ContactoBloqueado> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  const registro: ContactoBloqueado = {
    phoneNumber: normalizePhoneNumber(params.phoneNumber),
    bloqueadoEl: new Date().toISOString(),
    ...(params.bloqueadoPor ? { bloqueadoPor: params.bloqueadoPor } : {}),
    ...(params.motivo?.trim() ? { motivo: params.motivo.trim().slice(0, 200) } : {}),
  }

  // Sin TTL: un bloqueo que caduca solo volvería a dejar entrar al contacto sin
  // que nadie lo haya decidido.
  await redis.set(clave(params.configId, params.phoneNumber), JSON.stringify(registro))
  console.info(
    `[BLOQUEO] ${registro.phoneNumber} bloqueado en ${params.configId}` +
      (params.bloqueadoPor ? ` por ${params.bloqueadoPor}` : ""),
  )
  return registro
}

export async function desbloquearContacto(configId: string, phoneNumber: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis no está disponible")

  await redis.del(clave(configId, phoneNumber))
  console.info(`[BLOQUEO] ${normalizePhoneNumber(phoneNumber)} desbloqueado en ${configId}`)
}

/**
 * Los bloqueados de una clínica, para listarlos en el panel.
 *
 * Se escanean las claves con el prefijo del cliente. Un `scan` por apertura del
 * panel es barato comparado con mantener un índice aparte que puede quedar
 * desincronizado del dato real.
 */
export async function listarBloqueados(configId: string): Promise<ContactoBloqueado[]> {
  try {
    const redis = getRedisClient()
    if (!redis) return []

    const claves: string[] = []
    let cursor = "0"
    do {
      const resultado = await redis.scan(cursor, { match: `${PREFIJO}${configId}:*`, count: 100 })
      cursor = String(resultado[0])
      claves.push(...(resultado[1] as string[]))
    } while (cursor !== "0")

    if (claves.length === 0) return []

    const valores = await Promise.all(claves.map((c) => redis.get(c)))
    return valores
      .map((crudo) => {
        if (!crudo) return null
        try {
          return (typeof crudo === "string" ? JSON.parse(crudo) : crudo) as ContactoBloqueado
        } catch {
          return null
        }
      })
      .filter((x): x is ContactoBloqueado => x !== null)
      .sort((a, b) => b.bloqueadoEl.localeCompare(a.bloqueadoEl))
  } catch (error) {
    console.error("[BLOQUEO] No se pudieron listar los bloqueados:", error)
    return []
  }
}

/**
 * La misma pregunta, pero desde el punto por donde salen los mensajes.
 *
 * ── Por qué recibe `phoneNumberId` y no `configId` ────────────────────────
 *
 * Porque la compuerta de salida vive en las cuatro funciones de
 * `lib/whatsapp-api.ts`, que es el único embudo real por donde pasan los más
 * de sesenta llamadores —el bot, los recordatorios, el portal, el panel—. Esas
 * funciones reciben el `phoneNumberId` de la línea, no el id de la config.
 *
 * Es el mismo razonamiento que la compuerta de pausa que ya está ahí: cortar
 * en el webhook habría dejado afuera los recordatorios, que son casi tres
 * cuartas partes del consumo.
 *
 * El mapeo `phone_to_config:` lo escribe lib/db.tsx al guardar cada config. Se
 * lee directo en vez de importar `getWhatsAppConfigByPhoneId` para no meter
 * `lib/db` dentro de `lib/whatsapp-api`, que hoy no depende de él.
 */
export async function bloqueadoParaEnviar(
  phoneNumberId: string | null | undefined,
  destino: string,
): Promise<boolean> {
  if (!phoneNumberId || !destino) return false

  try {
    const redis = getRedisClient()
    if (!redis) return false

    const configId = await redis.get<string>(`phone_to_config:${phoneNumberId}`)
    if (!configId) return false

    return await estaBloqueado(String(configId), destino)
  } catch (error) {
    console.error("[BLOQUEO] No se pudo consultar antes de enviar, se deja pasar:", error)
    return false
  }
}
