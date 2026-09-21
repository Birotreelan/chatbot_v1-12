/**
 * Flow de reagendamiento desde el recordatorio (21/9/2026).
 *
 * ── Por qué no tiene endpoint ──────────────────────────────────────────────
 *
 * Un Flow puede pedirle datos a un servidor nuestro (`data_exchange`). Este no
 * lo hace, y es una decisión, no una limitación.
 *
 * Meta exige que ese endpoint responda en menos de 1 segundo, y si la latencia
 * se degrada pasa el Flow a *Throttled*: 10 mensajes por hora. Para una clínica
 * mandando recordatorios eso es un incidente, no una molestia. El proxy de la
 * clínica tarda ~4 segundos.
 *
 * Además, de la guía de health monitoring, textual: *"Flow health and monitoring
 * is only applicable to Flows that use data from your endpoint."* Un Flow sin
 * endpoint no tiene métricas que degradar — no se puede throttlear ni bloquear,
 * y tampoco necesita el par de claves RSA ni el endpoint cifrado.
 *
 * El costo de esa decisión: los turnos disponibles hay que mandarlos YA
 * resueltos, dentro del mensaje (`flow_action_data`). Eso se arma en nuestro
 * servidor al enviar el recordatorio, donde los 4 segundos del proxy no le
 * molestan a nadie.
 *
 * ── Y por qué es una sola pantalla ─────────────────────────────────────────
 *
 * Porque elegir la opción YA es la confirmación: el paciente selecciona un
 * horario y toca un botón que dice "Confirmar cambio". Una segunda pantalla de
 * resumen agrega un toque más sin agregar información — y cada toque de más se
 * paga en pacientes que abandonan a mitad de camino.
 *
 * ── La reserva no pasa acá ─────────────────────────────────────────────────
 *
 * Al tocar "Confirmar cambio" el Flow se cierra y manda un `nfm_reply` al
 * webhook. La reserva real contra el proxy pasa ahí, donde hay 300 segundos.
 * Por eso el texto del Flow NO dice "tu turno quedó reagendado": en ese momento
 * todavía no lo está. Decirlo sería fabricar a escala el caso de Norma — la
 * paciente que creyó haber reagendado y se quedó sin turno.
 */

/** Id de la opción que elige el paciente cuando ninguno de los horarios le sirve. */
export const OPCION_NINGUNO = "ninguno"

/** Pantalla de entrada. El template la nombra en `navigate_screen`. */
export const PANTALLA_ELEGIR = "ELEGIR_TURNO"

export interface TurnoOfrecido {
  /** Lo que vuelve en el `nfm_reply`. Conviene que identifique el turno sin ambigüedad. */
  id: string
  /** Máximo 30 caracteres (límite de RadioButtonsGroup). Ej: "Jue 25/09 · 08:25". */
  title: string
  /** Máximo 300. Ej: "Dra. Traverso — Sede Callao". */
  description?: string
}

/**
 * Tope de opciones que admite un RadioButtonsGroup. Mandar más hace que Meta
 * rechace el mensaje entero, así que se recorta antes de enviar.
 */
export const MAX_TURNOS_OFRECIDOS = 20

/**
 * Versión de Flow JSON.
 *
 * Meta congela y da de baja versiones viejas, y el publish rechaza una vencida.
 * Está acá arriba y como constante para poder cambiarla en un solo lugar cuando
 * eso pase; la lista vigente está en el changelog de Flows.
 */
export const VERSION_FLOW_JSON = "6.1"

/**
 * El Flow JSON que se publica una sola vez por WABA.
 *
 * No lleva `routing_model` a propósito: la documentación dice que se genera
 * solo cuando el Flow no usa endpoint, y declararlo de más es una fuente de
 * errores de validación.
 */
export function construirFlowJson(version: string = VERSION_FLOW_JSON) {
  return {
    version,
    screens: [
      {
        id: PANTALLA_ELEGIR,
        title: "Reagendar turno",
        // Única pantalla y, por lo tanto, terminal. Meta exige un Footer acá.
        terminal: true,
        data: {
          turno_actual: {
            type: "string",
            __example__: "jueves 25/09 a las 08:25 con TRAVERSO ALVARADO ARIANNA ANDREA",
          },
          turnos_disponibles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
              },
            },
            __example__: [
              { id: "3755380|2026-09-26|08:25", title: "Vie 26/09 · 08:25", description: "Dra. Traverso — Callao" },
              { id: OPCION_NINGUNO, title: "Ninguno me sirve", description: "Te contacta alguien del equipo" },
            ],
          },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "TextBody",
              text: "Vas a cancelar tu turno del ${data.turno_actual}.",
            },
            {
              type: "TextSubheading",
              text: "Elegí el nuevo horario",
            },
            {
              type: "RadioButtonsGroup",
              name: "turno_nuevo",
              label: "Horarios disponibles",
              required: true,
              "data-source": "${data.turnos_disponibles}",
            },
            {
              type: "Footer",
              label: "Confirmar cambio",
              "on-click-action": {
                name: "complete",
                // Sólo lo que eligió el paciente. La doc pide mantener el
                // payload al mínimo; el resto del contexto lo recuperamos del
                // flow_token cuando llega el nfm_reply.
                payload: {
                  turno_nuevo: "${form.turno_nuevo}",
                },
              },
            },
          ],
        },
      },
    ],
  }
}

/**
 * Arma los datos que viajan DENTRO del mensaje, para la primera pantalla.
 *
 * Va en `flow_action_data` del botón del template. Como el Flow no tiene
 * endpoint, esto es lo único que el paciente va a ver: si un horario no está
 * acá, no existe para él.
 */
export function construirDatosDeLaPantalla(params: {
  turnoActual: string
  turnosDisponibles: TurnoOfrecido[]
  /** Texto de la opción de escape. Si es null, no se ofrece. */
  etiquetaNinguno?: string | null
}): { turno_actual: string; turnos_disponibles: TurnoOfrecido[] } {
  const etiqueta = params.etiquetaNinguno === null ? null : params.etiquetaNinguno || "Ninguno me sirve"

  // Se reserva un lugar para la opción de escape ANTES de recortar. Si el tope
  // se aplicara después, un día con muchos turnos libres dejaría al paciente
  // sin salida: 20 horarios que no le sirven y ninguna forma de decirlo.
  const tope = etiqueta ? MAX_TURNOS_OFRECIDOS - 1 : MAX_TURNOS_OFRECIDOS

  const turnos = params.turnosDisponibles.slice(0, tope).map((t) => ({
    id: t.id,
    title: acotar(t.title, 30),
    ...(t.description ? { description: acotar(t.description, 300) } : {}),
  }))

  if (etiqueta) {
    turnos.push({
      id: OPCION_NINGUNO,
      title: acotar(etiqueta, 30),
      description: "Te contacta alguien del equipo",
    })
  }

  return {
    turno_actual: params.turnoActual,
    turnos_disponibles: turnos,
  }
}

/**
 * Recorta respetando el límite del componente.
 *
 * Pasarse no trunca: Meta rechaza el mensaje completo, así que el paciente no
 * recibe nada. Preferimos un título con puntos suspensivos antes que eso.
 */
function acotar(texto: string, maximo: number): string {
  const limpio = (texto || "").trim()
  if (limpio.length <= maximo) return limpio
  return limpio.slice(0, maximo - 1).trimEnd() + "…"
}
