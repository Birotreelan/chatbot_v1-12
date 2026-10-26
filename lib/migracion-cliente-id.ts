/**
 * Mover todo lo que un cliente tiene guardado de un `cliente_id` a otro
 * (26/10/2026).
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * El `cliente_id` lo pone el sistema de la clínica y puede cambiar. Cuando
 * cambia, lo que quedó escrito bajo el id viejo deja de existir para nosotros:
 * `/api/appointment-stats?clienteId=<nuevo>` devuelve ceros, la facturación no
 * encuentra el precio ni el alias, y el panel muestra un cliente que parece no
 * haber hecho nada nunca.
 *
 * ── Se buscan las claves, no se enumeran ───────────────────────────────────
 *
 * La tentación era listar las familias conocidas —`appointment_stats:`,
 * `facturacion:precio_unidad:`, etc.— y mover esas. No sirve: hay claves que
 * nadie recuerda al escribir la lista (`appointment_stats:<id>:response_times:
 * confirmed:2026-10-14`, por ejemplo, una por día), y las que se agreguen
 * después quedarían afuera sin que nadie se entere.
 *
 * Por eso se escanea por el id: `*<viejo>*`. Un UUID no aparece por casualidad
 * en otra clave, así que lo que contiene ese id es del cliente, incluido lo que
 * todavía no existe.
 *
 * ── Fusionar, no pisar ─────────────────────────────────────────────────────
 *
 * El destino puede tener datos: desde que el id cambió, lo nuevo se viene
 * guardando ahí. Entonces:
 *
 *  - los contadores (hashes de estadísticas) se SUMAN campo por campo;
 *  - las listas y los conjuntos se agregan;
 *  - los valores sueltos (precio, alias, CUIT) sólo se copian si el destino
 *    está vacío, y si no, se reportan como conflicto sin tocar nada. Un precio
 *    cargado a mano para el id nuevo es más confiable que uno viejo, y
 *    pisarlo cambiaría una factura sin que nadie lo pida.
 *
 * ── Primero se mira, después se escribe ────────────────────────────────────
 *
 * `ensayo: true` recorre todo y devuelve exactamente lo que haría, sin
 * escribir una sola clave. Es el modo por omisión: una migración de datos de
 * producción que se ejecuta sola por un parámetro que falta es la clase de
 * cosa que se lamenta una vez.
 *
 * ── Lo viejo no se borra ───────────────────────────────────────────────────
 *
 * Copiar y dejar el original es reversible; mover no. Si algo sale mal, el id
 * viejo sigue teniendo sus datos y se puede volver a intentar. El borrado es
 * un segundo paso explícito (`borrarElViejo`), para cuando ya se verificó que
 * el nuevo quedó bien.
 */

import { getRedisClient } from "./redis"

/**
 * La marca de que este par ya se migró.
 *
 * ── Por qué hace falta ─────────────────────────────────────────────────────
 *
 * Los contadores se suman. Ejecutar la migración dos veces no es inofensivo:
 * duplica las estadísticas del cliente, y el resultado no se distingue de un
 * mes muy bueno. Salió en la simulación —40 confirmados pasaron a 83 en la
 * segunda corrida— y es exactamente la clase de error que se descubre tarde,
 * cuando alguien compara con la facturación.
 *
 * Así que la segunda vez no corre, salvo que se pida a propósito con
 * `forzar`. Sin TTL: la protección no tiene por qué caducar.
 */
const MARCA_PREFIJO = "migracion:cliente:"

export interface ClaveMigrada {
  origen: string
  destino: string
  tipo: string
  /** Cuántos campos/elementos se copiaron. */
  elementos: number
  /** Qué se hizo: copiada entera, fusionada con lo que había, o nada. */
  accion: "copiada" | "fusionada" | "conflicto" | "sin-datos" | "error"
  detalle?: string
}

export interface ResultadoDeLaMigracion {
  viejo: string
  nuevo: string
  ensayo: boolean
  /** Cuándo se ejecutó antes, si ya se había ejecutado. */
  yaEjecutada?: string
  /** Se frenó por eso: no se tocó nada. */
  frenada?: boolean
  clavesEncontradas: number
  claves: ClaveMigrada[]
  /** Las que no se tocaron porque el destino ya tenía otro valor. */
  conflictos: number
  errores: number
}

/** Todas las claves que contienen ese id, sin importar la familia. */
export async function clavesDelCliente(clienteId: string): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return []

  const claves: string[] = []
  let cursor = "0"
  do {
    const resultado = await redis.scan(cursor, { match: `*${clienteId}*`, count: 200 })
    cursor = String(resultado[0])
    claves.push(...(resultado[1] as string[]))
  } while (cursor !== "0")

  // La marca de "esto ya se migró" lleva el id adentro y la escribimos
  // nosotros: es contabilidad de la migración, no un dato del cliente. Sin
  // esta línea se copiaría a sí misma y además cambiaría el total de claves
  // entre una corrida y la siguiente.
  return [...new Set(claves)].filter((k) => !k.startsWith(MARCA_PREFIJO))
}

/** Suma dos valores que deberían ser números; si alguno no lo es, gana el destino. */
function sumar(destino: unknown, origen: unknown): string | null {
  const a = Number(destino)
  const b = Number(origen)
  if (Number.isFinite(a) && Number.isFinite(b)) return String(a + b)
  return null
}

export async function migrarClienteId(params: {
  viejo: string
  nuevo: string
  /** Por omisión true: no escribe nada, sólo cuenta qué haría. */
  ensayo?: boolean
  /** Repetir una migración ya hecha. Duplica los contadores: ver MARCA_PREFIJO. */
  forzar?: boolean
}): Promise<ResultadoDeLaMigracion> {
  const { viejo, nuevo } = params
  const ensayo = params.ensayo !== false

  const resultado: ResultadoDeLaMigracion = {
    viejo,
    nuevo,
    ensayo,
    clavesEncontradas: 0,
    claves: [],
    conflictos: 0,
    errores: 0,
  }

  const redis = getRedisClient()
  if (!redis) {
    resultado.errores = 1
    return resultado
  }
  if (!viejo || !nuevo || viejo === nuevo) {
    resultado.errores = 1
    return resultado
  }

  // ¿Ya se hizo? El ensayo igual se deja correr: mirar no rompe nada, y
  // después de migrar es justo cuando uno quiere volver a mirar.
  const marca = await redis.get(`${MARCA_PREFIJO}${viejo}:${nuevo}`)
  if (marca) {
    resultado.yaEjecutada = typeof marca === "string" ? marca : JSON.stringify(marca)
    if (!ensayo && !params.forzar) {
      resultado.frenada = true
      console.warn(
        `[MIGRACION] ${viejo} → ${nuevo} ya se ejecutó el ${resultado.yaEjecutada}. ` +
          `Repetirla duplicaría los contadores; usar forzar: true si de verdad hace falta.`,
      )
      return resultado
    }
  }

  const claves = await clavesDelCliente(viejo)
  resultado.clavesEncontradas = claves.length

  for (const origen of claves) {
    // El id puede aparecer más de una vez en la misma clave (no pasa hoy, pero
    // reemplazar todas las apariciones es lo correcto y no cuesta nada).
    const destino = origen.split(viejo).join(nuevo)
    const fila: ClaveMigrada = { origen, destino, tipo: "?", elementos: 0, accion: "sin-datos" }

    try {
      const tipo = String(await redis.type(origen))
      fila.tipo = tipo

      if (tipo === "hash") {
        const datos = (await redis.hgetall(origen)) as Record<string, unknown> | null
        const campos = datos ? Object.entries(datos) : []
        fila.elementos = campos.length
        if (campos.length === 0) {
          resultado.claves.push(fila)
          continue
        }

        const actual = ((await redis.hgetall(destino)) || {}) as Record<string, unknown>
        const hayDestino = Object.keys(actual).length > 0
        fila.accion = hayDestino ? "fusionada" : "copiada"

        const aEscribir: Record<string, string> = {}
        for (const [campo, valor] of campos) {
          if (!(campo in actual)) {
            aEscribir[campo] = String(valor)
            continue
          }
          // `lastUpdated` y cualquier otro campo que no sea un número: se
          // conserva el del destino, que es el más reciente.
          const suma = sumar(actual[campo], valor)
          if (suma !== null) aEscribir[campo] = suma
        }

        if (!ensayo && Object.keys(aEscribir).length > 0) {
          await redis.hset(destino, aEscribir)
        }
      } else if (tipo === "string") {
        const valor = await redis.get(origen)
        if (valor === null || valor === undefined) {
          resultado.claves.push(fila)
          continue
        }
        fila.elementos = 1

        const actual = await redis.get(destino)
        if (actual !== null && actual !== undefined) {
          fila.accion = "conflicto"
          fila.detalle = "el destino ya tiene un valor; no se tocó"
          resultado.conflictos++
        } else {
          fila.accion = "copiada"
          if (!ensayo) {
            // El TTL se respeta: un `pending_reschedule` que vence en dos horas
            // no puede volverse eterno al migrarlo.
            const ttl = Number(await redis.ttl(origen))
            const aGuardar = typeof valor === "string" ? valor : JSON.stringify(valor)
            if (ttl > 0) await redis.set(destino, aGuardar, { ex: ttl })
            else await redis.set(destino, aGuardar)
          }
        }
      } else if (tipo === "list") {
        const valores = (await redis.lrange(origen, 0, -1)) as unknown[]
        fila.elementos = valores.length
        if (valores.length === 0) {
          resultado.claves.push(fila)
          continue
        }
        const actual = (await redis.lrange(destino, 0, -1)) as unknown[]
        fila.accion = actual.length > 0 ? "fusionada" : "copiada"
        if (!ensayo) {
          await redis.rpush(destino, ...(valores.map((v) => String(v)) as [string, ...string[]]))
          // Mismo tope que usa appointment-stats al escribirlas.
          await redis.ltrim(destino, 0, 999)
        }
      } else if (tipo === "set") {
        const valores = (await redis.smembers(origen)) as unknown[]
        fila.elementos = valores.length
        if (valores.length === 0) {
          resultado.claves.push(fila)
          continue
        }
        const actual = (await redis.smembers(destino)) as unknown[]
        fila.accion = actual.length > 0 ? "fusionada" : "copiada"
        if (!ensayo) {
          await redis.sadd(destino, ...(valores.map((v) => String(v)) as [string, ...string[]]))
        }
      } else if (tipo === "none") {
        fila.detalle = "la clave desapareció entre el escaneo y la copia"
      } else {
        // zset u otro tipo que hoy no usamos. No se inventa una conversión:
        // se reporta para que alguien lo mire.
        fila.accion = "error"
        fila.detalle = `tipo no contemplado: ${tipo}`
        resultado.errores++
      }
    } catch (error) {
      fila.accion = "error"
      fila.detalle = error instanceof Error ? error.message : String(error)
      resultado.errores++
    }

    resultado.claves.push(fila)
  }

  if (!ensayo) {
    await redis.set(`${MARCA_PREFIJO}${viejo}:${nuevo}`, new Date().toISOString())
  }

  console.log(
    `[MIGRACION] ${ensayo ? "ENSAYO" : "EJECUTADA"} ${viejo} → ${nuevo}: ` +
      `${resultado.clavesEncontradas} claves, ${resultado.conflictos} conflictos, ${resultado.errores} errores`,
  )

  return resultado
}

/**
 * Borra las claves del id viejo. Segundo paso, explícito y aparte.
 *
 * No se hace junto con la copia a propósito: mientras el viejo exista, un error
 * en la migración se arregla volviendo a copiar. Una vez borrado, no.
 */
export async function borrarElViejo(params: {
  viejo: string
  ensayo?: boolean
}): Promise<{ claves: string[]; borradas: number; ensayo: boolean }> {
  const ensayo = params.ensayo !== false
  const claves = await clavesDelCliente(params.viejo)

  const redis = getRedisClient()
  if (!redis || ensayo) return { claves, borradas: 0, ensayo }

  let borradas = 0
  for (const clave of claves) {
    try {
      await redis.del(clave)
      borradas++
    } catch (error) {
      console.error(`[MIGRACION] No se pudo borrar ${clave}:`, error)
    }
  }

  console.log(`[MIGRACION] Borradas ${borradas} claves de ${params.viejo}`)
  return { claves, borradas, ensayo }
}
