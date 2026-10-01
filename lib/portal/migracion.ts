/**
 * Prender el portal en un cliente que ya está en producción (1/10/2026).
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * El switch `clientePortalWeb` cambia el motor para todo el mundo a la vez,
 * incluida la gente que en ese momento está a mitad de una conversación con el
 * chatbot. Pedido de Nicolás: los que ya tenían un flujo abierto tienen que
 * poder terminarlo donde lo empezaron.
 *
 * ── Lo que NO hacía falta arreglar ─────────────────────────────────────────
 *
 * Casi todo, y conviene dejarlo escrito para no agregar guardas de más. Las
 * entradas al portal son de dos tipos: el bloque que intercepta los botones
 * del recordatorio, que sólo mira mensajes `button`/`button_reply`, y las
 * acciones que devuelve el handler de detección, que sólo existen cuando el
 * paciente está parado en el menú.
 *
 * Un flujo abierto avanza mandando TEXTO —un DNI, el número de un turno de la
 * lista, un nombre— y ese texto no toca ninguna de las dos: lo agarran los
 * interceptores que en lib/whatsapp.tsx vienen después. O sea que el que está
 * en la mitad y sigue escribiendo, termina en el chat sin que hagamos nada.
 *
 * Lo que sí cambia de rama es el toque deliberado: responder el menú, tocar un
 * botón del recordatorio de ayer, elegir "cancelar y sacar otro". Eso es lo que
 * cubre esta compuerta.
 *
 * ── Por qué se retira sola ─────────────────────────────────────────────────
 *
 * Una compuerta permanente —"un flujo abierto siempre gana sobre el enlace"—
 * convierte en regla de producto lo que es una necesidad de migración: un
 * paciente con un estado de detección de 24 h no vería el portal nunca.
 *
 * El plazo no es arbitrario: 24 h es el TTL más largo de los estados de flujo
 * (detección, alta de paciente nuevo y flow state; booking vive 3 h y
 * reagendamiento y paciente existente 2 h). Pasado ese plazo no puede quedar
 * vivo ningún flujo anterior al switch, así que la compuerta deja de evaluarse
 * —ni siquiera lee Redis— y el portal queda al 100%. Nadie tiene que acordarse
 * de apagarla, que es la clase de tarea que no se hace.
 */

import { resolveActiveFlow } from "../conversation-state/active-flow"

/**
 * El TTL más largo de los estados de flujo conversacional.
 *
 * Si alguno de esos TTL se alarga, este número tiene que acompañarlo: sería una
 * ventana que se cierra antes de que el último flujo haya muerto.
 */
const VENTANA_MS = 24 * 60 * 60 * 1000

/**
 * ¿Estamos dentro de la ventana de migración de este cliente?
 *
 * Sin fecha, no. Un cliente que ya tenía el portal prendido desde antes de que
 * existiera este campo no está migrando: lleva días así y no hay ningún flujo
 * conversacional viejo que proteger.
 */
export function enVentanaDeMigracion(
  config: { clientePortalWebDesde?: string } | null | undefined,
  ahora: Date = new Date(),
): boolean {
  const desde = config?.clientePortalWebDesde
  if (!desde) return false

  const encendido = Date.parse(desde)
  if (Number.isNaN(encendido)) return false

  const transcurrido = ahora.getTime() - encendido

  // Negativo = la fecha está en el futuro. Pasa con un reloj mal puesto o con
  // una configuración importada a mano. Se trata como fuera de ventana: el
  // error de dejar pasar el enlace dura un mensaje; el de retener el portal
  // "hasta que llegue esa fecha" podría durar meses sin que nadie lo note.
  return transcurrido >= 0 && transcurrido < VENTANA_MS
}

/**
 * ¿Este paciente tiene que seguir en el chat porque ya venía en uno?
 *
 * Se consulta `hasStepFlow` y no `hasRealFlow`: son los flujos POR PASOS
 * —reserva, reagendamiento, alta— que tienen estado a medio llenar y que
 * interrumpir significa perder lo que el paciente ya tipeó. La detección queda
 * afuera a propósito: estar "en detección" es estar mirando el menú, que es
 * exactamente el momento en que queremos que el portal se lleve la gestión.
 *
 * Nunca lanza, y ante la duda deja pasar al portal: el error de mandar un
 * enlace de más es un mensaje; el de no mandarlo nunca es un cliente migrado
 * que sigue trabajando con el motor viejo sin que nadie se entere.
 */
export async function sigueEnElChatPorMigracion(params: {
  config: { clientePortalWeb?: boolean; clientePortalWebDesde?: string; id?: string }
  userPhoneNumber: string
}): Promise<boolean> {
  if (!enVentanaDeMigracion(params.config)) return false
  if (!params.config?.id) return false

  try {
    const flujos = await resolveActiveFlow(params.userPhoneNumber, params.config.id)
    return flujos.hasStepFlow === true
  } catch (error) {
    console.warn("[PORTAL] No se pudo mirar el flujo activo; se deriva igual:", error)
    return false
  }
}
