/**
 * El mensaje que el paciente escribe en el chat, visto desde la clínica
 * (5/11/2026).
 *
 * ── Qué resuelve ───────────────────────────────────────────────────────────
 *
 * Que "del lado de la clínica queda exactamente igual" sea cierto. El agente
 * no tiene que aprender nada nuevo: el mensaje del chat aparece en la misma
 * lista, en la misma burbuja y en el mismo lugar del hilo que si hubiera
 * llegado por WhatsApp.
 *
 * Para eso se escribe en los DOS lugares donde el panel mira, igual que hace
 * el webhook con un mensaje de WhatsApp:
 *
 *   · `saveSupportMessage` → el hilo de la sesión de atención
 *   · `saveConversationMessage` → el historial de la conversación, que es lo
 *     que lee el monitor y lo que sobrevive cuando la sesión se cierra
 *
 * Con el MISMO id en los dos. El panel combina los dos historiales y deduplica
 * por id; dos ids distintos duplican la burbuja. Está documentado en
 * app/api/support/media/route.ts y es un error fácil de repetir.
 *
 * ── Si no hay sesión abierta, se abre ──────────────────────────────────────
 *
 * Pasa en el caso que más importa del pedido: el paciente vuelve dos meses
 * después, abre el enlace que todavía tiene y escribe. No hay sesión, porque
 * la anterior se cerró.
 *
 * Alguien que escribe en este chat está pidiendo una persona sin ambigüedad
 * —acá no hay bot que lo atienda— así que se crea la sesión. Dejar su mensaje
 * guardado sin que aparezca en ninguna cola sería la peor versión: él ve su
 * mensaje enviado y del otro lado no hay nadie mirando.
 *
 * El lock es el mismo patrón que `registrarArchivoEntrante`, y por el mismo
 * motivo: dos mensajes seguidos del paciente llegan a dos invocaciones a la
 * vez y sin lock crean dos sesiones para la misma persona. Ahí está la nota
 * larga sobre por qué se espera el lock en vez de rendirse.
 */

import { nanoid } from "nanoid"
import {
  createSupportSession,
  getActiveSessionByPhone,
  saveSupportMessage,
} from "../human-support"
import { saveConversationMessage } from "../conversations"
import { getRedisClient } from "../redis"
import { getWhatsAppConfigById } from "../db"
import type { HumanSupportMessage, HumanSupportSession } from "../types"
import type { MensajeDeAtencion } from "./conversacion"

/** El motivo con el que aparece en la cola del panel. */
export const MOTIVO_CHAT = "Escribió por el chat de atención"

/**
 * Se asegura de que haya una sesión para este paciente, y la devuelve.
 *
 * `null` sólo si no se pudo ni leer ni crear: ahí el llamador igual guardó el
 * mensaje en la conversación durable, así que no se pierde.
 */
async function asegurarSesion(params: {
  configId: string
  clienteId: string
  telefono: string
}): Promise<HumanSupportSession | null> {
  const existente = await getActiveSessionByPhone(params.configId, params.telefono)
  if (existente && (existente.status === "pending" || existente.status === "in_progress")) {
    return existente
  }

  const redis = getRedisClient()
  if (!redis) return null

  const lockKey = `atencion:lock:sesion:${params.configId}:${params.telefono}`

  // Se espera el lock en vez de rendirse en el primer intento: el que pierde
  // la carrera tiene que ver la sesión que creó el otro, no concluir que no
  // hay ninguna. Ver la nota de `registrarArchivoEntrante`.
  let tomado: unknown = null
  for (let intento = 0; intento < 4 && !tomado; intento++) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 250))
    // `nx` en minúscula: el cliente de Upstash hace `"nx" in opts`, así que
    // con `NX` la opción se ignora en silencio y el lock no bloquea nada.
    tomado = await redis.set(lockKey, Date.now().toString(), { nx: true, ex: 15 })
  }

  if (!tomado) {
    // Otro la está creando. Se vuelve a leer: en el peor caso devuelve null y
    // el mensaje queda sólo en la conversación durable.
    return await getActiveSessionByPhone(params.configId, params.telefono)
  }

  try {
    const otraVez = await getActiveSessionByPhone(params.configId, params.telefono)
    if (otraVez && (otraVez.status === "pending" || otraVez.status === "in_progress")) {
      return otraVez
    }

    const config = await getWhatsAppConfigById(params.configId).catch(() => null)
    const session = await createSupportSession({
      phoneNumber: params.telefono,
      configId: params.configId,
      tenantId: params.clienteId || "unknown",
      // Sin hilo de OpenAI: este mensaje no pasó por el asistente. Vacío es lo
      // que ya reciben las derivaciones que tampoco lo pueden resolver.
      threadId: "",
      assistantId: config?.whatsappAssistantId || "",
      displayName: config?.displayName || params.configId,
      reason: MOTIVO_CHAT,
      priority: "medium",
      summary:
        "El paciente escribió en el chat de atención. No pasó por el asistente: ese chat no tiene bot.",
    })
    console.log(`[ATENCION] Sesión creada desde el chat: ${session.id}`)
    return session
  } catch (error) {
    console.error("[ATENCION] No se pudo crear la sesión desde el chat:", error)
    return null
  } finally {
    await redis.del(lockKey).catch(() => {})
  }
}

/**
 * Registra en el panel un mensaje que el paciente escribió en el chat.
 *
 * Devuelve la sesión, por si el llamador quiere saber si se abrió una nueva.
 */
export async function registrarMensajeDelPaciente(params: {
  configId: string
  clienteId: string
  telefono: string
  mensaje: MensajeDeAtencion
}): Promise<HumanSupportSession | null> {
  const { configId, clienteId, telefono, mensaje } = params

  const sesion = await asegurarSesion({ configId, clienteId, telefono })

  // El texto que ve el agente. Un mensaje que es sólo un archivo llega con
  // `texto` vacío, y una burbuja vacía en el panel se lee como un error: se le
  // pone el nombre del archivo, que es lo que hace el camino de WhatsApp.
  const contenido = mensaje.texto || (mensaje.media ? `📎 ${mensaje.media.nombreArchivo}` : "")

  if (sesion) {
    const deSoporte: HumanSupportMessage = {
      id: mensaje.id,
      sessionId: sesion.id,
      role: "user",
      content: contenido,
      timestamp: mensaje.enviadoEl,
      media: mensaje.media,
    }
    await saveSupportMessage(deSoporte).catch((error) =>
      console.error("[ATENCION] No se pudo guardar en el hilo de soporte:", error),
    )
  }

  await saveConversationMessage({
    // Mismo id que el de soporte: el panel deduplica por id.
    id: mensaje.id,
    role: "user",
    content: contenido,
    timestamp: mensaje.enviadoEl,
    phoneNumber: telefono,
    configId,
    media: mensaje.media,
  }).catch((error) =>
    console.error("[ATENCION] No se pudo guardar en el historial de la conversación:", error),
  )

  return sesion
}

/**
 * Un id para un mensaje nuevo.
 *
 * Expuesto acá para que el que lo crea y el que lo registra usen el mismo, que
 * es la condición de la deduplicación del panel.
 */
export function nuevoIdDeMensaje(): string {
  return nanoid()
}
