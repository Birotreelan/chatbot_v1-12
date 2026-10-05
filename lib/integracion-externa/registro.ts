/**
 * Qué nos mandó el sistema de la clínica, y cómo (5/10/2026).
 *
 * ── Qué guarda ─────────────────────────────────────────────────────────────
 *
 * Por cliente y por `tipo_mensaje`, un único hash con:
 *   - cuántos llegaron completos y cuántos incompletos
 *   - cuándo fue el último de cada clase
 *   - qué campos faltaban la última vez, y una muestra recortada del payload
 *
 * Un hash por tipo y no una lista de eventos: el tablero pregunta "¿esto llega
 * y llega bien?", no "mostrame los últimos mil". Una lista crecería con el
 * tráfico —el volumen de recordatorios es alto— y habría que podarla; esto
 * ocupa lo mismo con diez mensajes que con diez mil.
 *
 * ── Por qué no reusa lib/diagnostics.ts ────────────────────────────────────
 *
 * Aquello cuenta eventos por día para medir tendencias del motor
 * conversacional, y sus claves vencen a los 30 días. Acá hace falta lo
 * contrario: que "la última vez que llegó una cancelación fue hace dos meses"
 * se siga viendo. Un contador que se borra solo nunca puede decir "esto no
 * llega hace mucho", que es justamente la respuesta que buscamos.
 *
 * ── Nada de esto puede romper un envío ─────────────────────────────────────
 *
 * Es observación. Todo va en try/catch y un fallo se traga con un warning: que
 * no se registre una muestra no puede impedir que el recordatorio salga.
 */

import { getRedisClient } from "../redis"
import { camposFaltantes, tipoEsperado } from "./catalogo"

const PREFIJO = "integracion:"

/** Cuánto del payload se guarda como muestra. */
const MAXIMO_DE_MUESTRA = 1500

export interface ObservacionDeTipo {
  tipo: string
  completos: number
  incompletos: number
  ultimoCompleto?: string
  ultimoIncompleto?: string
  /** Los que faltaban la última vez que llegó incompleto. */
  faltantes?: string[]
  /** Payload recortado del último incompleto, para poder mirarlo. */
  muestra?: string
  /** El tipo no está en el catálogo: llegó algo que no esperábamos. */
  desconocido?: boolean
}

function clave(clienteId: string, tipo: string): string {
  return `${PREFIJO}${clienteId}:${tipo}`
}

function claveDelIndice(clienteId: string): string {
  return `${PREFIJO}${clienteId}:tipos`
}

/**
 * Anota un mensaje entrante del sistema externo.
 *
 * Se llama con el `tipo_mensaje` crudo, incluso si no lo conocemos: un tipo
 * desconocido es información valiosa —un error de tipeo del otro lado hace que
 * el tablero muestre "falta X" sin explicar por qué—, y sólo se puede ver si
 * se registra.
 */
export async function registrarEntrante(params: {
  clienteId: string
  tipo?: string | null
  chatbotData?: any
}): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !params.clienteId) return

  const tipo = (params.tipo || "").trim() || "(sin tipo_mensaje)"

  try {
    const conocido = Boolean(tipoEsperado(tipo))
    const faltantes = conocido ? camposFaltantes(tipo, params.chatbotData) : []
    const completo = conocido && faltantes.length === 0
    const ahora = new Date().toISOString()

    const k = clave(params.clienteId, tipo)

    if (completo) {
      await redis.hincrby(k, "completos", 1)
      await redis.hset(k, { ultimoCompleto: ahora })
    } else {
      await redis.hincrby(k, "incompletos", 1)
      await redis.hset(k, {
        ultimoIncompleto: ahora,
        faltantes: JSON.stringify(faltantes),
        // Sólo del incompleto: del que llegó bien no hay nada que mirar, y
        // guardar payloads con datos de pacientes que no hacen falta es
        // guardar datos personales porque sí.
        muestra: recortar(params.chatbotData),
        desconocido: conocido ? "0" : "1",
      })
    }

    await redis.sadd(claveDelIndice(params.clienteId), tipo)
  } catch (error) {
    console.warn("[INTEGRACION] No se pudo registrar el entrante:", error)
  }
}

function recortar(datos: any): string {
  try {
    const texto = typeof datos === "string" ? datos : JSON.stringify(datos)
    if (!texto) return ""
    return texto.length > MAXIMO_DE_MUESTRA ? `${texto.slice(0, MAXIMO_DE_MUESTRA)}…` : texto
  } catch {
    return ""
  }
}

/** Todo lo observado para un cliente, indexado por tipo. */
export async function observaciones(clienteId: string): Promise<Record<string, ObservacionDeTipo>> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return {}

  try {
    const tipos = (await redis.smembers(claveDelIndice(clienteId))) || []
    if (tipos.length === 0) return {}

    const crudos = await Promise.all(tipos.map((t) => redis.hgetall<Record<string, string>>(clave(clienteId, t))))

    const salida: Record<string, ObservacionDeTipo> = {}
    tipos.forEach((tipo, i) => {
      const h = crudos[i]
      if (!h) return

      salida[tipo] = {
        tipo,
        completos: Number(h.completos || 0),
        incompletos: Number(h.incompletos || 0),
        ultimoCompleto: h.ultimoCompleto || undefined,
        ultimoIncompleto: h.ultimoIncompleto || undefined,
        faltantes: h.faltantes ? seguroJSON(h.faltantes) : undefined,
        muestra: h.muestra || undefined,
        desconocido: h.desconocido === "1",
      }
    })

    return salida
  } catch (error) {
    console.warn("[INTEGRACION] No se pudieron leer las observaciones:", error)
    return {}
  }
}

function seguroJSON(texto: string): string[] | undefined {
  try {
    const v = JSON.parse(texto)
    return Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

/** Borra lo observado de un cliente, para volver a medir desde cero. */
export async function olvidarObservaciones(clienteId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return

  try {
    const tipos = (await redis.smembers(claveDelIndice(clienteId))) || []
    await Promise.all(tipos.map((t) => redis.del(clave(clienteId, t))))
    await redis.del(claveDelIndice(clienteId))
  } catch (error) {
    console.warn("[INTEGRACION] No se pudo limpiar:", error)
  }
}
