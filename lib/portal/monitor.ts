/**
 * Lo que el monitor de conversaciones ve del portal (1/10/2026).
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * El portal saca al paciente de WhatsApp, y desde el panel eso es un silencio.
 * Ya teníamos las dos puntas —"se envió el enlace" y el texto de lo que quedó—
 * pero el final llegaba redactado para el paciente: "Pedimos tu turno para el
 * miércoles 30 de septiembre a las 08:00". Correcto para él, inservible para
 * quien recorre cien conversaciones buscando cuántas terminaron en turno.
 *
 * Acá viven las dos cosas que arreglan eso:
 *
 *  1. `etiquetaDelDesenlace`, que antepone una línea en mayúscula al texto del
 *     paciente. El texto NO se reemplaza: el agente que abre la conversación
 *     tiene que poder leer exactamente lo que la persona leyó.
 *
 *  2. `TEXTO_DEL_HITO`, los momentos del recorrido que valen una línea. Hoy
 *     son dos y conviene que sigan siendo pocos: una línea por pantalla
 *     convertiría el monitor en un log y dejaría de servir para lo que el
 *     despliegue necesita, que es ver de un vistazo quién llegó y quién no.
 *
 * ── Por qué una sola función escribe ───────────────────────────────────────
 *
 * Las tres rutas del portal repetían el mismo bloque de `saveConversationMessage`
 * con el mismo prefijo escrito a mano. Un prefijo distinto en una de ellas y el
 * panel deja de reconocer la línea como del portal.
 */

import { nanoid } from "nanoid"

import { saveConversationMessage } from "../conversations"

/** El prefijo por el que el panel reconoce estas líneas. */
const PREFIJO = "[Portal]"

export type HitoDelPortal = "abierto" | "sin_horarios"

/**
 * El texto de cada hito, en sus dos versiones.
 *
 * La de prueba existe porque el generador de enlaces del dashboard escribe en
 * una conversación real: sin la aclaración, una prueba interna se lee igual
 * que un paciente de verdad.
 */
export const TEXTO_DEL_HITO: Record<HitoDelPortal, { real: string; demo: string }> = {
  abierto: {
    real: "El paciente abrió el enlace.",
    demo: "Se abrió el enlace de PRUEBA.",
  },
  sin_horarios: {
    // La causa de abandono más probable, y hasta hoy la más invisible: la
    // conversación de alguien a quien la agenda no le ofreció nada se veía
    // idéntica a la de alguien que se aburrió. Son dos problemas distintos y
    // sólo uno se arregla con la interfaz.
    real: "El paciente llegó a la agenda y no había horarios para ofrecerle.",
    demo: "El enlace de PRUEBA llegó a la agenda sin horarios disponibles.",
  },
}

export type TipoDeDesenlace = "reserva" | "cambio" | "cancelacion" | "confirmacion"

const ETIQUETA: Record<TipoDeDesenlace, string> = {
  reserva: "TURNO AGENDADO",
  cambio: "TURNO REAGENDADO",
  cancelacion: "TURNO CANCELADO",
  confirmacion: "ASISTENCIA CONFIRMADA",
}

/**
 * La línea de desenlace que encabeza el registro.
 *
 * En mayúscula y al principio porque se lee en diagonal: la pregunta que
 * contesta —"¿terminó en turno?"— se hace sobre muchas conversaciones a la vez,
 * no sobre una.
 *
 * `pendiente` no es un detalle: un turno con `confirmacion_humana` todavía
 * puede no existir. Decir "AGENDADO" a secas haría contar como ganado algo que
 * la clínica todavía no aprobó.
 */
export function etiquetaDelDesenlace(params: {
  tipo: TipoDeDesenlace
  cuando?: string
  profesional?: string
  pendiente?: boolean
  /** La cancelación del turno previo falló: quedaron dos turnos vivos. */
  avisoCancelacion?: boolean
}): string {
  const partes = [ETIQUETA[params.tipo]]

  const detalle = [params.cuando, params.profesional ? `con ${params.profesional}` : ""]
    .filter(Boolean)
    .join(", ")

  let linea = detalle ? `${partes[0]} — ${detalle}` : partes[0]

  if (params.pendiente) linea += ". Pendiente de aprobación de la clínica"
  if (params.avisoCancelacion) linea += ". ATENCIÓN: no se pudo cancelar el turno anterior"

  return `${linea}.`
}

/**
 * Escribe una línea del portal en la conversación.
 *
 * Nunca lanza. Todo esto es observación: si Redis o la base fallan, el paciente
 * no tiene que enterarse y la gestión que acaba de hacer no se deshace porque
 * no hayamos podido anotarla.
 */
export async function anotarEnElMonitor(params: {
  configId: string
  phoneNumber: string
  texto: string
}): Promise<void> {
  try {
    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: `${PREFIJO} ${params.texto}`,
      timestamp: new Date().toISOString(),
      phoneNumber: params.phoneNumber,
      configId: params.configId,
      messageType: "portal",
    })
  } catch (error) {
    console.error("[PORTAL] No se pudo registrar en la conversación:", error)
  }
}
