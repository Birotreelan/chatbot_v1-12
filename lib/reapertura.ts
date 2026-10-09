/**
 * Estado de las invitaciones a reabrir la ventana de 24 h (9/10/2026).
 *
 * El texto de la plantilla, su validación y sus constantes viven en
 * reapertura-texto.ts, sin dependencias de servidor, porque el panel los
 * necesita en el navegador. Acá queda lo que requiere Redis: a quién se le
 * mandó una invitación, cuándo, y si la contestó.
 *
 * Se reexporta todo para que los llamadores del servidor importen de un solo
 * lugar y no tengan que saber de la división.
 */

import { getRedisClient } from "./redis"

export * from "./reapertura-texto"

// ─── Estado: a quién se le mandó y cuándo ───────────────────────────────────

const PREFIJO = "reapertura:"

/**
 * Cuánto hay que esperar antes de volver a invitar al mismo paciente.
 *
 * 24 h, que es lo mismo que dura la ventana. La razón no es técnica: una
 * invitación que el paciente no contestó ya costó plata y no sirvió, y repetirla
 * a los diez minutos no lo va a convencer — va a hacer que bloquee el número, y
 * los bloqueos bajan la calificación de calidad de la línea de toda la clínica.
 */
const ESPERA_ENTRE_INVITACIONES_MS = 24 * 60 * 60 * 1000

/** Se guarda 7 días: sirve para explicar "ya se le escribió el lunes". */
const TTL_SEGUNDOS = 7 * 24 * 60 * 60

export interface Invitacion {
  /** ISO del envío. */
  enviadaEl: string
  motivo: string
  /** Quién la mandó, para poder reconstruir qué se estuvo enviando. */
  agente: string
  /** ISO de la respuesta del paciente, si llegó. */
  respondidaEl?: string
}

function clave(configId: string, telefono: string): string {
  return `${PREFIJO}${configId}:${telefono}`
}

export async function leerInvitacion(
  configId: string,
  telefono: string,
): Promise<Invitacion | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const crudo = await redis.get(clave(configId, telefono))
    if (!crudo) return null
    // Upstash deserializa solo lo que parece JSON, así que puede venir de las
    // dos formas. Ya nos costó un diagnóstico entero no contemplarlo.
    const datos = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)
    return datos && typeof datos === "object" ? (datos as Invitacion) : null
  } catch (error) {
    console.warn("[REAPERTURA] No se pudo leer la invitación:", error)
    return null
  }
}

export async function registrarInvitacion(
  configId: string,
  telefono: string,
  datos: Invitacion,
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(clave(configId, telefono), JSON.stringify(datos), { ex: TTL_SEGUNDOS })
  } catch (error) {
    console.warn("[REAPERTURA] No se pudo registrar la invitación:", error)
  }
}

/**
 * Marca que el paciente aceptó. Lo llama el webhook al recibir el payload.
 *
 * Sirve para dos cosas: que el panel pueda decir "aceptó hace 3 minutos" en vez
 * de sólo habilitar el input, y para poder medir la tasa de respuesta. Sin esa
 * medición no hay forma de saber si la función sirve o si estamos pagando
 * plantillas que nadie contesta.
 */
export async function registrarRespuesta(configId: string, telefono: string): Promise<void> {
  const previa = await leerInvitacion(configId, telefono)
  if (!previa || previa.respondidaEl) return
  await registrarInvitacion(configId, telefono, {
    ...previa,
    respondidaEl: new Date().toISOString(),
  })
}

export type PuedeInvitar =
  | { puede: true; previa?: Invitacion }
  | { puede: false; motivo: string; previa: Invitacion }

/**
 * ¿Se le puede mandar una invitación a este paciente ahora?
 *
 * Una invitación ya respondida no bloquea: si el paciente aceptó, conversó y la
 * ventana volvió a cerrarse, invitarlo de nuevo es legítimo. Lo que se frena es
 * repetir una invitación que todavía nadie contestó.
 */
export async function puedeInvitar(configId: string, telefono: string): Promise<PuedeInvitar> {
  return decidirSiPuedeInvitar(await leerInvitacion(configId, telefono))
}

/**
 * La decisión, sin Redis. Separada para poder probarla: lo que hay que
 * verificar acá son los bordes del tiempo, y montar Redis para eso no prueba
 * nada que no se pueda probar pasando una fecha.
 *
 * Una fecha ilegible deja pasar. Es el mismo criterio que el módulo de la
 * ventana de 24 h: un dato que no se puede leer no es un dato que diga "no".
 */
export function decidirSiPuedeInvitar(
  previa: Invitacion | null,
  ahora: number = Date.now(),
): PuedeInvitar {
  if (!previa) return { puede: true }
  if (previa.respondidaEl) return { puede: true, previa }

  const enviada = Date.parse(previa.enviadaEl)
  if (Number.isNaN(enviada)) return { puede: true, previa }

  const transcurrido = ahora - enviada
  if (transcurrido >= ESPERA_ENTRE_INVITACIONES_MS) return { puede: true, previa }

  const horas = Math.ceil((ESPERA_ENTRE_INVITACIONES_MS - transcurrido) / (60 * 60 * 1000))
  return {
    puede: false,
    previa,
    motivo:
      `Ya se le envió una invitación y el paciente todavía no respondió. ` +
      `Se puede volver a intentar en ${horas} h. Repetirla ahora cuesta otro mensaje y ` +
      `aumenta la chance de que bloquee el número de la clínica.`,
  }
}
