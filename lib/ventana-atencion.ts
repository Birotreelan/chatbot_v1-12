/**
 * Ventana de atención al cliente de 24 horas (15/9/2026).
 *
 * WhatsApp solo permite mandar mensajes libres — texto, imágenes, documentos —
 * dentro de las 24 horas posteriores al último mensaje del paciente. Pasado ese
 * plazo, lo único que se puede enviar es una plantilla aprobada por Meta.
 *
 * Hasta ahora el panel no lo contemplaba: el agente escribía, WhatsApp
 * rechazaba con el error 131047 y el agente veía un volcado de JSON. Con
 * archivos el problema se agrava, porque el agente sube algo, espera, y se
 * entera de que no llegó.
 *
 * ── Una aclaración sobre "no sé" ───────────────────────────────────────────
 *
 * Este módulo distingue tres estados, no dos: abierta, cerrada y DESCONOCIDA.
 * La diferencia importa. Si no tenemos registro del último mensaje del paciente
 * —porque la conversación es vieja, porque Redis expiró, porque el registro se
 * incorporó después de que esa conversación empezara— eso no significa que la
 * ventana esté cerrada. Significa que no sabemos.
 *
 * Tratar "no tengo el dato" como "está cerrada" bloquearía envíos legítimos, y
 * es exactamente el error que ya nos costó varias conversaciones en el bot
 * (timeout de red interpretado como "el paciente no existe"). Ante la duda,
 * dejamos intentar: WhatsApp es la autoridad y su respuesta se traduce a un
 * mensaje claro.
 */

import { getRedisClient } from "./redis"
import { getConversationMessages } from "./conversations"

const VENTANA_PREFIX = "ventana_atencion:"

/** 24 horas exactas, que es lo que define WhatsApp. */
const DURACION_VENTANA_MS = 24 * 60 * 60 * 1000

/**
 * Guardamos el registro 48 horas: más que la ventana, para poder decir "se
 * cerró hace 3 horas" en vez de perder el dato justo cuando deja de servir.
 */
const VENTANA_TTL_SEGUNDOS = 48 * 60 * 60

/** Cuántos mensajes del historial miramos al reconstruir el dato. */
const MENSAJES_A_REVISAR = 30

export type EstadoVentana = "abierta" | "cerrada" | "desconocida"

export interface VentanaAtencion {
  estado: EstadoVentana
  /** ISO del último mensaje del paciente, si lo conocemos. */
  ultimoMensajeDelPaciente?: string
  /** ISO del momento en que se cierra (o se cerró) la ventana. */
  cierraEn?: string
  /** Minutos que faltan para que se cierre. Solo cuando está abierta. */
  minutosRestantes?: number
}

function claveVentana(configId: string, phoneNumber: string): string {
  return `${VENTANA_PREFIX}${configId}:${phoneNumber}`
}

/**
 * Registra que el paciente escribió. Se llama desde el webhook, con cada
 * mensaje entrante, sea texto, audio, botón o archivo.
 *
 * Nunca lanza: si falla, el panel cae al estado "desconocida" y el envío se
 * sigue intentando. Un fallo acá no tiene que impedir que se atienda a nadie.
 */
export async function registrarMensajeEntrante(
  configId: string,
  phoneNumber: string,
  timestamp?: string | number,
): Promise<void> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return

    const momento = normalizarMomento(timestamp)
    const clave = claveVentana(configId, phoneNumber)
    await redisClient.set(clave, momento, { ex: VENTANA_TTL_SEGUNDOS })
  } catch (error) {
    console.error("[VENTANA] No se pudo registrar el mensaje entrante:", error)
  }
}

/**
 * Devuelve el estado de la ventana para una conversación.
 *
 * Si no hay registro directo, reconstruye el dato buscando el último mensaje
 * del paciente en el historial. Esto cubre las conversaciones que ya estaban en
 * curso cuando se incorporó el registro, que si no quedarían todas en
 * "desconocida" el primer día.
 */
export async function estadoVentana(
  configId: string,
  phoneNumber: string,
): Promise<VentanaAtencion> {
  const registrado = await leerRegistro(configId, phoneNumber)
  if (registrado) return calcularDesde(registrado)

  const reconstruido = await ultimoMensajeDelPacienteEnHistorial(configId, phoneNumber)
  if (reconstruido) return calcularDesde(reconstruido)

  return { estado: "desconocida" }
}

/**
 * Cálculo puro, separado para poder testearlo sin Redis.
 * Exportado por eso mismo.
 */
export function calcularDesde(ultimoMensajeIso: string, ahora: number = Date.now()): VentanaAtencion {
  const momento = new Date(ultimoMensajeIso).getTime()
  if (Number.isNaN(momento)) return { estado: "desconocida" }

  const cierre = momento + DURACION_VENTANA_MS
  const cierraEn = new Date(cierre).toISOString()

  if (ahora >= cierre) {
    return { estado: "cerrada", ultimoMensajeDelPaciente: ultimoMensajeIso, cierraEn }
  }

  return {
    estado: "abierta",
    ultimoMensajeDelPaciente: ultimoMensajeIso,
    cierraEn,
    minutosRestantes: Math.max(0, Math.floor((cierre - ahora) / 60000)),
  }
}

/** "queda 1 h 20 min" / "se cerró" — texto corto para el encabezado del panel. */
export function describirVentana(ventana: VentanaAtencion): string {
  if (ventana.estado === "cerrada") {
    return "La ventana de 24 h está cerrada: hasta que el paciente escriba, WhatsApp no permite enviarle mensajes."
  }
  if (ventana.estado === "desconocida") {
    return "No hay registro del último mensaje del paciente, así que no se puede saber si la ventana de 24 h sigue abierta."
  }

  const minutos = ventana.minutosRestantes ?? 0
  if (minutos < 60) return `Quedan ${minutos} min de la ventana de 24 h.`

  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return resto === 0
    ? `Quedan ${horas} h de la ventana de 24 h.`
    : `Quedan ${horas} h ${resto} min de la ventana de 24 h.`
}

// ─── Internos ───────────────────────────────────────────────────────────────

async function leerRegistro(configId: string, phoneNumber: string): Promise<string | null> {
  try {
    const redisClient = getRedisClient()
    if (!redisClient) return null
    const valor = await redisClient.get(claveVentana(configId, phoneNumber))
    if (!valor) return null
    return typeof valor === "string" ? valor : String(valor)
  } catch (error) {
    console.error("[VENTANA] Error leyendo el registro:", error)
    return null
  }
}

async function ultimoMensajeDelPacienteEnHistorial(
  configId: string,
  phoneNumber: string,
): Promise<string | null> {
  try {
    const { messages } = await getConversationMessages(configId, phoneNumber, MENSAJES_A_REVISAR, 0)
    // El historial viene en orden cronológico: recorremos desde el final.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i].timestamp
    }
    return null
  } catch (error) {
    console.error("[VENTANA] Error reconstruyendo desde el historial:", error)
    return null
  }
}

function normalizarMomento(timestamp?: string | number): string {
  if (timestamp === undefined || timestamp === null) return new Date().toISOString()

  // WhatsApp manda el timestamp del webhook en segundos, como string.
  if (typeof timestamp === "number" || /^\d+$/.test(String(timestamp))) {
    const numero = Number(timestamp)
    const ms = numero < 1e12 ? numero * 1000 : numero
    const fecha = new Date(ms)
    if (!Number.isNaN(fecha.getTime())) return fecha.toISOString()
  }

  const fecha = new Date(timestamp)
  return Number.isNaN(fecha.getTime()) ? new Date().toISOString() : fecha.toISOString()
}
