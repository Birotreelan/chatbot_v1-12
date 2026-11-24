/**
 * Las restricciones del cliente, aplicadas en el portal (24/11/2026).
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Daponte Ojos tiene `permitirNuevoTurno: false` y
 * `permitirReagendamiento: false`. Una paciente con dos fichas en el mismo
 * teléfono pidió un turno, mandó su DNI, recibió el menú completo —ese bug se
 * arregló aparte, en el saludo— eligió "Solicitar turno médico", le llegó el
 * enlace del portal y reservó. Dos minutos después pasó lo mismo con la
 * segunda paciente del teléfono.
 *
 * ── Lo que esto cierra, que es lo de fondo ────────────────────────────────
 *
 * `permitirNuevoTurno` está pasado a mano por los flujos de WhatsApp: aparece
 * en más de ochenta lugares entre whatsapp.tsx, los flujos de paciente nuevo y
 * existente y los templates. En el portal NO aparecía ni una vez. O sea que la
 * restricción no era una restricción del cliente: era una restricción de un
 * canal, y el portal —que es el canal al que el bot deriva justamente para
 * reservar— la ignoraba entera.
 *
 * Arreglar el saludo tapa el camino por el que entró esta paciente. Esto tapa
 * todos los demás: un enlace emitido ayer y todavía en el chat, uno de un
 * recordatorio, uno que alguien reenvió. Un flag que se chequea sólo donde se
 * emite el enlace no es un permiso, es una sugerencia.
 *
 * ── Cómo se traduce la intención del enlace a un permiso ──────────────────
 *
 * El enlace sabe para qué se emitió, pero lo que importa es lo que el paciente
 * TERMINA haciendo, y no es lo mismo:
 *
 *  - un enlace de `cancelar` en el que el paciente elige "cambiarlo de
 *    horario" termina en una reserva, y eso es un reagendamiento;
 *  - un enlace de `nuevo_turno` emitido para alguien que ya tiene turno sigue
 *    siendo un turno nuevo.
 *
 * Así que la pregunta se arma con las dos cosas: la gestión que se está por
 * hacer y si el enlace reemplaza un turno previo. `reemplazaElTurnoPrevio`
 * (lib/portal/vigencia.ts) ya contesta la segunda y es la misma función que
 * usa el portal para decidir si cancela el anterior: no se reimplementa acá,
 * porque dos respuestas a la misma pregunta es exactamente cómo nació este
 * bug.
 */

import { getWhatsAppConfigById } from "@/lib/db"
import { telefonoParaMensajes } from "@/lib/utils/escalation-contact"
import { reemplazaElTurnoPrevio, type IntencionDelPortal } from "./vigencia"

export type GestionDelPortal = "reservar" | "cancelar"

export interface Veredicto {
  permitido: boolean
  /** Qué switch lo prohíbe. Para el log; al paciente no se le dice. */
  flag?: "permitirNuevoTurno" | "permitirReagendamiento" | "permitirCancelacion"
  /**
   * El teléfono de la clínica, para el mensaje.
   *
   * Viaja en el veredicto porque la config ya se leyó acá y el token no lo
   * trae: pedirle al llamador que la lea otra vez sería una segunda lectura
   * para un dato que tenemos en la mano.
   */
  telefonoDeLaClinica?: string
}

/**
 * ¿Puede el portal hacer esta gestión para este cliente?
 *
 * Ante cualquier falla devuelve `permitido: true`, o sea que la gestión sigue.
 * Es el criterio incómodo de siempre y conviene dejarlo escrito: equivocarse
 * para este lado reserva un turno que el cliente no quería —se corrige a mano,
 * y es lo que pasaba hasta hoy—; para el otro lado, un problema de
 * infraestructura nuestro le deja a una clínica el portal cerrado sin que nadie
 * lo haya pedido, y el paciente no tiene a dónde ir.
 */
export async function portalPuede(
  configId: string | undefined | null,
  params: { intencion: IntencionDelPortal; gestion: GestionDelPortal },
): Promise<Veredicto> {
  if (!configId) return { permitido: true }

  try {
    const config = await getWhatsAppConfigById(configId)
    return veredictoDeLaConfig(config, params)
  } catch (error) {
    console.warn("[PORTAL] No se pudieron leer los permisos del cliente:", error)
    return { permitido: true }
  }
}

/**
 * Lo mismo, con la configuración ya en la mano.
 *
 * Existe porque hay dos clases de llamador y cada uno tiene una cosa distinta:
 * la ruta que gestiona tiene el token —de ahí sale el `configId`— y el embudo
 * que emite los enlaces (derivar-al-portal.ts) ya recibió la config entera. Que
 * ése vuelva a leerla sería una lectura de más en el camino caliente del
 * webhook, por un dato que tiene al lado.
 */
export function veredictoDeLaConfig(
  config: any,
  params: { intencion: IntencionDelPortal; gestion: GestionDelPortal },
): Veredicto {
  if (!config) return { permitido: true }

  // El mismo criterio que el resto de los mensajes: si el cliente apagó el
  // switch de mostrar el teléfono, acá tampoco se muestra.
  const telefonoDeLaClinica = telefonoParaMensajes(config as any)

  if (params.gestion === "cancelar") {
    return config.permitirCancelacion === false
      ? { permitido: false, flag: "permitirCancelacion", telefonoDeLaClinica }
      : { permitido: true, telefonoDeLaClinica }
  }

  // Una reserva que reemplaza un turno es un reagendamiento; la que no, un
  // turno nuevo.
  if (reemplazaElTurnoPrevio(params.intencion)) {
    return config.permitirReagendamiento === false
      ? { permitido: false, flag: "permitirReagendamiento", telefonoDeLaClinica }
      : { permitido: true, telefonoDeLaClinica }
  }

  return config.permitirNuevoTurno === false
    ? { permitido: false, flag: "permitirNuevoTurno", telefonoDeLaClinica }
    : { permitido: true, telefonoDeLaClinica }
}

/**
 * Lo que ve el paciente.
 *
 * No menciona ningún switch ni dice "no está permitido": para él no es una
 * restricción administrativa, es que esto se hace por otro lado. Y no se lo
 * deja sin salida — el teléfono de la clínica va en el mensaje cuando lo
 * tenemos.
 */
export function mensajeDeGestionNoDisponible(
  gestion: GestionDelPortal,
  telefonoDeLaClinica?: string | null,
): string {
  const que =
    gestion === "cancelar"
      ? "Las cancelaciones de esta clínica se hacen directamente con ella"
      : "Los turnos de esta clínica se dan directamente con ella"
  const telefono = (telefonoDeLaClinica || "").trim()
  return telefono
    ? `${que}. Comunicate al ${telefono} y te lo resuelven.`
    : `${que}. Comunicate con la clínica y te lo resuelven.`
}
