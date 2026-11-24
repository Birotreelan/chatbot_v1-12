/**
 * Qué pasó con una cancelación (24/11/2026).
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Patricia reprogramó un turno. El bot canceló el viejo —correctamente— y dos
 * mensajes después ella tocó "Cancelar" otra vez. El proxy contestó
 * `No se encontraron turnos para el paciente en la fecha especificada`, porque
 * efectivamente ya no había nada que cancelar, y el bot le dijo:
 *
 *     «Hubo un problema al cancelar el turno. Por favor intentá de nuevo en
 *     unos momentos.»
 *
 * Lo intentó tres veces. Ninguna podía funcionar: el turno no iba a volver a
 * la agenda para poder cancelarse de nuevo.
 *
 * ── Por qué «ya no estaba» no es un error ─────────────────────────────────
 *
 * El paciente pidió que ese turno no exista. No existe. Que lo haya cancelado
 * él mismo hace dos mensajes, la clínica por teléfono o nosotros al reprogramar
 * no cambia el resultado que le importa. La cancelación es idempotente y hay
 * que contestarla como lo que es: un cierre positivo.
 *
 * Esto ya estaba resuelto en un lado del sistema y no en el otro: el prompt del
 * asistente tiene la sección "EXCEPCIÓN CRÍTICA — CANCELACIÓN IDEMPOTENTE"
 * desde antes, y el camino determinístico —el que atendió a Patricia— no la
 * tenía. Es la forma habitual de este error en el proyecto: la misma pregunta
 * contestada en dos lugares, y uno de los dos se queda viejo.
 *
 * ── Y por qué un módulo para esto ─────────────────────────────────────────
 *
 * Porque la pregunta "¿salió bien esta cancelación?" se contestaba en cuatro
 * lugares con tres criterios distintos, y dos de los cuatro estaban mal:
 *
 *  - `lib/whatsapp.tsx` (cancelar uno y cancelar todos) miraba
 *    `response.ok && body.success === true`. Correcto, pero sin distinguir
 *    «ya no estaba» de «falló el sistema»: es el caso de Patricia.
 *  - `app/api/portal/decidir` y `app/api/portal/gestionar` miraban
 *    `resultado.exito === false`. `cancelarTurno` devuelve el cuerpo del proxy
 *    tal cual, que trae `success`, no `exito` — así que la comparación nunca
 *    daba true y una cancelación rechazada se reportaba como exitosa. En
 *    `gestionar` eso deja al paciente con DOS turnos y el log que avisa no se
 *    escribe nunca.
 *
 * Una sola función que lea cualquiera de las formas en que el proxy puede
 * contestar, y un solo lugar donde arreglar la próxima.
 */

/** Las tres cosas que pueden haber pasado. No hay una cuarta. */
export type EstadoDeLaCancelacion =
  /** El turno estaba y ya no está. */
  | "cancelado"
  /** No había nada que cancelar en esa fecha. Para el paciente, lo mismo. */
  | "ya_no_estaba"
  /** No sabemos si impactó. Es el único caso donde reintentar sirve. */
  | "falla_tecnica"

/**
 * Lo que puede venir del otro lado.
 *
 * `success` y `exito` conviven a propósito: el proxy contesta `success`, y
 * algunas de nuestras envolturas traducen a `exito`. Leer los dos es más
 * barato que alinearlos y arriesgarse a romper una integración de un cliente.
 */
export interface RespuestaDeCancelacion {
  success?: boolean
  exito?: boolean
  error?: unknown
  mensaje?: string
  cantidad_cancelados?: number
  [clave: string]: unknown
}

/**
 * El texto con el que el proxy explica el rechazo, venga donde venga.
 *
 * `error` llega como string en el camino directo y como objeto con `mensaje`
 * cuando pasa por `clinic-api`. Se juntan los dos y el `mensaje` de arriba,
 * porque la frase que importa aparece en cualquiera de los tres según el
 * cliente.
 */
function textoDelRechazo(body: RespuestaDeCancelacion | null): string {
  if (!body) return ""
  const partes: string[] = []
  if (typeof body.error === "string") partes.push(body.error)
  else if (body.error && typeof body.error === "object") {
    const mensaje = (body.error as { mensaje?: unknown }).mensaje
    if (typeof mensaje === "string") partes.push(mensaje)
  }
  if (typeof body.mensaje === "string") partes.push(body.mensaje)
  return partes.join(" · ").toLowerCase()
}

/**
 * ¿El proxy dijo que no hay turnos en esa fecha?
 *
 * Por subcadena y sin acentos en la frase buscada, igual que
 * `esTurnoNoEncontrado` del camino de confirmación: la redacción del resto del
 * mensaje cambia entre clientes, esa parte no.
 */
function diceQueNoHayTurnos(body: RespuestaDeCancelacion | null): boolean {
  return textoDelRechazo(body).includes("no se encontraron turnos")
}

/**
 * Qué pasó con la cancelación.
 *
 * `httpOk` es el `response.ok` cuando el llamador lo tiene. Se pasa aparte
 * porque un 500 con cuerpo vacío es una falla técnica y hay que poder
 * distinguirlo de un 200 que dice que no.
 *
 * El orden importa: la frase del proxy se mira ANTES del status. Un cliente
 * que contesta "no se encontraron turnos" con un 400 está diciendo lo mismo
 * que el que lo contesta con un 200, y tratarlo como falla técnica es volver a
 * mandar al paciente a reintentar lo imposible.
 */
export function estadoDeLaCancelacion(
  body: RespuestaDeCancelacion | null | undefined,
  opciones?: { httpOk?: boolean },
): EstadoDeLaCancelacion {
  const cuerpo = body ?? null

  if (diceQueNoHayTurnos(cuerpo)) return "ya_no_estaba"

  if (opciones?.httpOk === false) return "falla_tecnica"
  if (!cuerpo) return "falla_tecnica"

  const dijoQueSi = cuerpo.success === true || cuerpo.exito === true
  if (!dijoQueSi) return "falla_tecnica"

  /**
   * Un sí con cero cancelados es un no disfrazado.
   *
   * Mismo criterio que `confirmacionImpacto`: decirle "listo, lo cancelamos" a
   * alguien cuyo turno sigue en la agenda es peor que decirle que hubo un
   * problema, porque no va a venir. Si el proxy del cliente no devuelve el
   * campo, se cae al criterio anterior y no se rompe nada.
   */
  if (typeof cuerpo.cantidad_cancelados === "number" && cuerpo.cantidad_cancelados === 0) {
    return "ya_no_estaba"
  }

  return "cancelado"
}

/**
 * Lo que se le dice al paciente cuando el turno ya no estaba.
 *
 * Afirmativo y cerrado: no hay nada que reintentar ni a quién llamar. Y se
 * nombra la fecha cuando se la tiene, porque el que acaba de reprogramar tiene
 * dos fechas en la cabeza y "tu turno" no le dice cuál.
 */
export function mensajeTurnoYaCancelado(cuando?: string | null): string {
  const fecha = String(cuando || "").trim()
  return fecha
    ? `Tu turno del ${fecha} ya estaba cancelado, así que no tenés nada agendado para esa fecha.`
    : `Ese turno ya estaba cancelado, así que no tenés nada agendado para esa fecha.`
}
