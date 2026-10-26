/**
 * El recorrido del portal, en los logs (26/10/2026).
 *
 * ── Qué faltaba ────────────────────────────────────────────────────────────
 *
 * La página del portal tenía dos `console.warn` y nada más. Del lado de
 * WhatsApp cada paso deja una línea con teléfono y cliente; del lado del
 * portal, entre "Enlace enviado" y "Buscando turnos" no había nada: ni qué
 * paso se decidió, ni con qué filtros, ni con qué identidad, ni qué se
 * resolvió. El rastro de una conversación se cortaba justo cuando el paciente
 * saltaba del chat al navegador, que es donde ahora pasa la mitad de las
 * cosas.
 *
 * ── Por qué el mismo formato y no uno nuevo ────────────────────────────────
 *
 * Porque la forma de buscar es por teléfono. Un formato propio obligaría a
 * aprender dos maneras de leer el mismo recorrido, y a acordarse de las dos
 * cada vez. Es `createConversationLogger`, el de siempre, con otro prefijo:
 *
 *   [PORTAL-FLOW:elegir_horario] (2026-10-26T13:15:35.293Z) 3413121395@faf82cd7-… → …
 *
 * El `configId` y no el `clienteId`, también por eso: es con lo que escriben
 * las líneas de WhatsApp, y mezclar los dos identificadores en la misma
 * columna rompe el filtro.
 *
 * ── Qué NO va acá ──────────────────────────────────────────────────────────
 *
 * Los hitos. Son otra cosa: alimentan el monitor de conversaciones, que lee un
 * agente para saber si el paciente llegó al turno o se perdió. Un log no
 * reemplaza al monitor ni el monitor al log.
 */

import { createConversationLogger, type ConversationLogger } from "../conversation-state/logger"
import type { ContextoDelPortal } from "./token"

/** Un identificador corto del enlace, para hilar los pasos de una misma visita. */
export function enlaceCorto(token?: string): string {
  if (!token) return "sin-token"
  return token.slice(0, 8)
}

/**
 * El logger de un paso del portal.
 *
 * `paso` es el mismo nombre que usa `decidirPaso`: así la línea del log y el
 * nombre del paso en el código se dicen igual, y buscar uno encuentra el otro.
 */
export function registroDelPortal(
  contexto: Pick<ContextoDelPortal, "phone" | "configId">,
  paso: string,
): ConversationLogger {
  return createConversationLogger(contexto.phone, contexto.configId, paso, "PORTAL-FLOW")
}

/**
 * Los datos de la visita que importan para entender un paso, en una sola línea.
 *
 * El DNI va truncado —alcanza para saber si se mandó y cuál, sin dejar el
 * documento entero en los logs de Vercel— y los campos ausentes se escriben
 * como "(no)" en vez de desaparecer: un campo que falta en la línea no se
 * distingue de uno que nunca existió.
 */
export function datosDeLaVisita(params: {
  token?: string
  contexto: Pick<ContextoDelPortal, "intencion" | "origen" | "pacienteDNI" | "obraSocialId" | "sedeId" | "demo">
  identidad?: { dni?: string; tieneFicha?: boolean; obraSocialId?: string } | null
  filtros?: { sedeId?: string; profesionalId?: string; especialidadId?: string; sinFiltro?: boolean }
  formato?: string
}): Record<string, unknown> {
  const { contexto, identidad, filtros } = params
  const dni = identidad?.dni || contexto.pacienteDNI
  const obraSocial = identidad?.obraSocialId || contexto.obraSocialId

  return {
    enlace: enlaceCorto(params.token),
    intencion: contexto.intencion,
    origenDelEnlace: contexto.origen,
    formato: params.formato || "pantallas",
    ...(contexto.demo ? { demo: true } : {}),
    dni: dni ? String(dni).slice(0, 3) + "****" : "(no)",
    tieneFicha: identidad?.tieneFicha ?? "(no se resolvió)",
    obraSocialId: obraSocial || "(no)",
    sedeId: filtros?.sedeId || contexto.sedeId || "(no)",
    profesionalId: filtros?.profesionalId || "(no)",
    especialidadId: filtros?.especialidadId || "(no)",
    ...(filtros?.sinFiltro ? { sinFiltro: true } : {}),
  }
}
