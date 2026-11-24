/**
 * ¿Esta clínica puede contestar una consulta que no es un turno? (24/11/2026)
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * El menú ofrece "Realizar otra consulta". Alicia la eligió y recibió:
 *
 *     «Este canal de WhatsApp es exclusivo para la gestión de turnos médicos.»
 *
 * Teresa hizo lo mismo y recibió lo mismo. Un menú que ofrece algo y al
 * elegirlo contesta que eso no se puede es peor que un menú sin esa opción:
 * el paciente hizo un paso de más para llegar al mismo lugar, y nosotros
 * pagamos los dos mensajes.
 *
 * ── Qué decide, y qué no ──────────────────────────────────────────────────
 *
 * La opción se contesta con `lib/clinic-info/answer.ts`, que responde
 * EXCLUSIVAMENTE con lo que la clínica cargó en su base institucional. Si no
 * cargó nada, no hay pregunta que pueda contestarse: el final es siempre la
 * derivación. Eso es lo que esta función detecta.
 *
 * No decide si una pregunta concreta se puede contestar. Una clínica CON datos
 * cargados puede recibir una pregunta que no esté cubierta y derivar, y ahí la
 * opción estaba bien ofrecida: a veces sirve.
 *
 * ── Por qué no se saca la opción ──────────────────────────────────────────
 *
 * Porque el paciente que no viene por un turno necesita una salida, y hoy esa
 * opción ES la salida: el mensaje de derivación le da el teléfono. Sacarla lo
 * deja sin a dónde tocar. Lo que se cambia es la etiqueta, para que prometa lo
 * que efectivamente va a pasar. Ver lib/conversation-state/etiquetas-menu.ts.
 */

import { getClinicInfo } from "@/lib/db"
import { formatClinicInfoForLLM } from "./context"

/**
 * Caché corta, el mismo criterio que las otras compuertas del proyecto.
 *
 * La base institucional la carga una persona desde el panel, así que cambia
 * una vez cada varios meses. Treinta segundos es conservador y alcanza para
 * que un menú no pague una lectura por envío.
 */
const CACHE_MS = 30_000
const cache = new Map<string, { valor: boolean; hasta: number }>()

export async function clinicaRespondeConsultas(clienteId?: string | null): Promise<boolean> {
  if (!clienteId) return false

  const enCache = cache.get(clienteId)
  if (enCache && enCache.hasta > Date.now()) return enCache.valor

  let valor = false
  try {
    const info = await getClinicInfo(clienteId)
    const bloque = formatClinicInfoForLLM(info)
    /**
     * Se pregunta por el bloque y no por los campos uno por uno a propósito:
     * es exactamente el texto que `answerFromClinicInfo` le pasa al modelo, y
     * son sus dos centinelas de "acá no hay nada". Mirar los campos sería
     * contestar la misma pregunta por segunda vez, con otro criterio, y
     * quedarse vieja la próxima vez que se agregue un campo.
     */
    valor =
      !bloque.startsWith("INFORMACIÓN DE LA CLÍNICA: no cargada") &&
      !bloque.startsWith("INFORMACIÓN DE LA CLÍNICA: cargada pero sin datos")
  } catch (error) {
    /**
     * Ante un fallo se asume que SÍ responde, o sea que el menú queda como
     * estaba. Equivocarse para este lado deja la contradicción que ya existía;
     * para el otro, le cambiaría el menú a una clínica que sí tiene su base
     * cargada por un problema de infraestructura nuestro.
     */
    console.warn("[CLINIC-INFO] No se pudo saber si la clínica responde consultas:", error)
    valor = true
  }

  cache.set(clienteId, { valor, hasta: Date.now() + CACHE_MS })
  return valor
}
