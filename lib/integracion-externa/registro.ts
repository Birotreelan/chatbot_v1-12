/**
 * Qué nos mandó el sistema de la clínica, y cómo (5/10/2026).
 *
 * ── Qué guarda ─────────────────────────────────────────────────────────────
 *
 * Dos cosas por cliente y por tipo:
 *
 *  1. Un resumen (hash): cuántos llegaron bien, cuántos mal, y cuándo fue el
 *     último de cada clase. Ocupa lo mismo con diez mensajes que con diez mil.
 *  2. Los últimos incidentes (lista corta): cada caso incompleto con su fecha,
 *     a qué teléfono iba, con qué nombre de plantilla y tipo_mensaje vino, qué
 *     campos faltaban y el payload entero.
 *
 * El historial se agregó porque el resumen solo no alcanza para reclamar. Ver
 * "incompleto" en la pantalla y no poder decir QUÉ venía mal deja el reporte al
 * sistema externo en "algo les falla", que no se puede accionar del otro lado.
 * Con cinco casos concretos —fecha, teléfono, campo faltante y JSON— el reclamo
 * se contesta solo.
 *
 * Cinco y no todos: alcanzan para ver si es sistemático o aislado, y la lista
 * no crece con el tráfico. El que necesite más tiene los logs.
 *
 * ── Por qué no reusa lib/diagnostics.ts ────────────────────────────────────
 *
 * Aquello cuenta eventos por día para medir tendencias del motor
 * conversacional, y sus claves vencen a los 30 días. Acá hace falta lo
 * contrario: que "la última cancelación llegó hace dos meses" se siga viendo.
 * Un contador que se borra solo nunca puede decir "esto no llega hace mucho",
 * que es justamente la respuesta que buscamos.
 *
 * ── Nada de esto puede romper un envío ─────────────────────────────────────
 *
 * Es observación. Todo va en try/catch y un fallo se traga con un warning: que
 * no se registre un incidente no puede impedir que el recordatorio salga.
 */

import { getRedisClient } from "../redis"
import { camposFaltantes, claveDelEnvio, tipoEsperado } from "./catalogo"

const PREFIJO = "integracion:"

/** Cuánto del payload se guarda. Entero si entra; es lo que se reporta. */
const MAXIMO_DE_MUESTRA = 4000

/** Cuántos incidentes se conservan por tipo. */
const MAXIMO_DE_INCIDENTES = 5

/**
 * Cuántas llegadas se recuerdan para aprender cada cuánto llega cada plantilla.
 *
 * Con 30 marcas de tiempo alcanza para una mediana estable y la lista pesa
 * poco. Son sólo números: no se guarda nada del paciente.
 */
const MAXIMO_DE_LLEGADAS = 30

export interface IncidenteDeIntegracion {
  cuando: string
  /** Campos requeridos que no vinieron. Vacío si el tipo no se reconoce. */
  faltantes: string[]
  /** `Body.template.name`, tal cual vino. */
  plantilla?: string
  /** `Chatbot_Data.tipo_mensaje`, tal cual vino. */
  tipoMensaje?: string
  /** A qué teléfono iba, para poder rastrearlo del otro lado. */
  telefono?: string
  /** El payload recibido. */
  payload?: string
  /** El tipo no está en el catálogo. */
  desconocido?: boolean
}

export interface ObservacionDeTipo {
  tipo: string
  completos: number
  incompletos: number
  ultimoCompleto?: string
  ultimoIncompleto?: string
  incidentes: IncidenteDeIntegracion[]
  /** Marcas de tiempo de las últimas llegadas, de la más nueva a la más vieja. */
  llegadas: number[]
  desconocido?: boolean
}

function clave(clienteId: string, tipo: string): string {
  return `${PREFIJO}${clienteId}:${tipo}`
}

function claveDeIncidentes(clienteId: string, tipo: string): string {
  return `${PREFIJO}${clienteId}:${tipo}:incidentes`
}

function claveDeLlegadas(clienteId: string, tipo: string): string {
  return `${PREFIJO}${clienteId}:${tipo}:llegadas`
}

function claveDelIndice(clienteId: string): string {
  return `${PREFIJO}${clienteId}:tipos`
}

/**
 * Upstash deserializa solo lo que parece JSON.
 *
 * Esto costó un bug: `faltantes` se guardaba con `JSON.stringify` y volvía ya
 * convertido en array, así que el `JSON.parse` de la lectura tiraba y el
 * `catch` devolvía `undefined`. La pantalla mostraba "llega incompleto" sin
 * decir qué faltaba —el diagnóstico sin el diagnóstico—. Hay que aceptar las
 * dos formas, siempre.
 */
function comoLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(String)
  if (typeof valor === "string") {
    try {
      const v = JSON.parse(valor)
      return Array.isArray(v) ? v.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function comoTexto(valor: unknown): string | undefined {
  if (valor === null || valor === undefined) return undefined
  if (typeof valor === "string") return valor || undefined
  try {
    return JSON.stringify(valor)
  } catch {
    return undefined
  }
}

function recortar(datos: any): string {
  try {
    const texto = typeof datos === "string" ? datos : JSON.stringify(datos, null, 2)
    if (!texto) return ""
    return texto.length > MAXIMO_DE_MUESTRA ? `${texto.slice(0, MAXIMO_DE_MUESTRA)}\n… (recortado)` : texto
  } catch {
    return ""
  }
}

/**
 * Anota un mensaje entrante del sistema externo.
 *
 * Se registra incluso lo que no reconocemos: un nombre desconocido es
 * información valiosa —un error de tipeo del otro lado hace que el tablero
 * muestre "falta X" sin explicar por qué—, y sólo se puede ver si queda
 * anotado tal cual vino.
 */
export async function registrarEntrante(params: {
  clienteId: string
  /** `Body.template.name`, cuando el envío es una plantilla. */
  nombreDePlantilla?: string | null
  /** `Chatbot_Data.tipo_mensaje`. */
  tipoMensaje?: string | null
  /** El teléfono al que iba, para poder rastrear el caso del otro lado. */
  telefono?: string | null
  /** `WhatsAppConfig.nombresDePlantilla`, si esta clínica usa nombres propios. */
  nombresPropios?: Record<string, string>
  chatbotData?: any
}): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !params.clienteId) return

  // La clave canónica resuelve el caso de un mismo evento con dos nombres: la
  // plantilla `cancelar_turno_solicitado` y el `tipo_mensaje`
  // `turno_cancelado_clinica` caen en la misma fila. Ver `claveDelEnvio`.
  const tipo = claveDelEnvio(params, params.nombresPropios || {})

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
      await redis.hset(k, { ultimoIncompleto: ahora, desconocido: conocido ? "0" : "1" })

      const incidente: IncidenteDeIntegracion = {
        cuando: ahora,
        faltantes,
        plantilla: (params.nombreDePlantilla || "").trim() || undefined,
        tipoMensaje: (params.tipoMensaje || "").trim() || undefined,
        telefono: (params.telefono || "").trim() || undefined,
        payload: recortar(params.chatbotData),
        desconocido: !conocido,
      }

      const ki = claveDeIncidentes(params.clienteId, tipo)
      await redis.lpush(ki, JSON.stringify(incidente))
      await redis.ltrim(ki, 0, MAXIMO_DE_INCIDENTES - 1)
    }

    // ── La cadencia (5/10/2026) ─────────────────────────────────────────
    //
    // Se anota TODA llegada, completa o no: lo que mide esto es si el sistema
    // externo sigue mandando, y un payload incompleto demuestra que sigue
    // mandando igual que uno bueno. Mezclarlo con la validación daría
    // "dejó de llegar" para algo que llega todo el tiempo y llega mal.
    const kl = claveDeLlegadas(params.clienteId, tipo)
    await redis.lpush(kl, Date.now())
    await redis.ltrim(kl, 0, MAXIMO_DE_LLEGADAS - 1)

    await redis.sadd(claveDelIndice(params.clienteId), tipo)
  } catch (error) {
    console.warn("[INTEGRACION] No se pudo registrar el entrante:", error)
  }
}

/** Todo lo observado para un cliente, indexado por tipo. */
export async function observaciones(clienteId: string): Promise<Record<string, ObservacionDeTipo>> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return {}

  try {
    const tipos = (await redis.smembers(claveDelIndice(clienteId))) || []
    if (tipos.length === 0) return {}

    const [resumenes, incidentes, llegadas] = await Promise.all([
      Promise.all(tipos.map((t) => redis.hgetall<Record<string, unknown>>(clave(clienteId, t)))),
      Promise.all(tipos.map((t) => redis.lrange<unknown>(claveDeIncidentes(clienteId, t), 0, -1))),
      Promise.all(tipos.map((t) => redis.lrange<unknown>(claveDeLlegadas(clienteId, t), 0, -1))),
    ])

    const salida: Record<string, ObservacionDeTipo> = {}
    tipos.forEach((tipo, i) => {
      const h = resumenes[i]
      if (!h) return

      salida[tipo] = {
        tipo,
        completos: Number(h.completos || 0),
        incompletos: Number(h.incompletos || 0),
        ultimoCompleto: comoTexto(h.ultimoCompleto),
        ultimoIncompleto: comoTexto(h.ultimoIncompleto),
        desconocido: comoTexto(h.desconocido) === "1",
        incidentes: (incidentes[i] || [])
          .map((crudo) => leerIncidente(crudo))
          .filter((x): x is IncidenteDeIntegracion => x !== null),
        llegadas: (llegadas[i] || [])
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n) && n > 0),
      }
    })

    return salida
  } catch (error) {
    console.warn("[INTEGRACION] No se pudieron leer las observaciones:", error)
    return {}
  }
}

function leerIncidente(crudo: unknown): IncidenteDeIntegracion | null {
  // Igual que arriba: Upstash puede devolverlo ya convertido en objeto.
  const obj = typeof crudo === "string" ? seguroParse(crudo) : (crudo as any)
  if (!obj || typeof obj !== "object") return null

  return {
    cuando: String(obj.cuando || ""),
    faltantes: comoLista(obj.faltantes),
    plantilla: obj.plantilla || undefined,
    tipoMensaje: obj.tipoMensaje || undefined,
    telefono: obj.telefono || undefined,
    payload: comoTexto(obj.payload),
    desconocido: Boolean(obj.desconocido),
  }
}

function seguroParse(texto: string): any {
  try {
    return JSON.parse(texto)
  } catch {
    return null
  }
}

/** Borra lo observado de un cliente, para volver a medir desde cero. */
export async function olvidarObservaciones(clienteId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis || !clienteId) return

  try {
    const tipos = (await redis.smembers(claveDelIndice(clienteId))) || []
    await Promise.all(
      tipos.flatMap((t) => [
        redis.del(clave(clienteId, t)),
        redis.del(claveDeIncidentes(clienteId, t)),
        redis.del(claveDeLlegadas(clienteId, t)),
      ]),
    )
    await redis.del(claveDelIndice(clienteId))
  } catch (error) {
    console.warn("[INTEGRACION] No se pudo limpiar:", error)
  }
}
