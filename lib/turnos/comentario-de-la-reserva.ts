/**
 * Resuelve qué texto va en el `Comentarios` de `set_turno` (26/10/2026).
 *
 * ── Por qué vive acá y no en cada llamador ─────────────────────────────────
 *
 * Hay dos constructores vivos del payload de `set_turno`
 * —lib/api-tools/api-functions.ts y lib/openai-tools.tsx— y entre los dos los
 * usan el portal, el flujo de reagendamiento, el de paciente existente, el de
 * paciente nuevo y la herramienta que la IA llama por su cuenta. Si el
 * comentario lo tuviera que armar cada uno, el próximo flujo que se agregue
 * reservaría sin comentario y nadie se enteraría: es exactamente lo que ya pasó
 * con las estadísticas de turnos, que hubo que parchear tres veces en tres
 * archivos distintos.
 *
 * Por eso esto se llama DENTRO de las dos funciones de reserva. Un flujo nuevo
 * hereda el comportamiento sin hacer nada.
 *
 * ── Las dos fuentes ────────────────────────────────────────────────────────
 *
 * 1. El flujo lo sabe. El portal y el reagendamiento conversacional tienen el
 *    turno viejo en la mano; lo pasan explícito y no hace falta adivinar.
 *
 * 2. El flujo no lo sabe. El paciente apretó "Cancelar" en el recordatorio y
 *    tres mensajes después le pidió otro turno a la IA, que llama
 *    `reservar_turno` sin saber de dónde viene. Ahí se lee la marca de
 *    cancelación pendiente que dejó el webhook.
 *
 * El explícito gana: es información de primera mano, y la marca es por
 * (cliente, teléfono) sin distinguir cuál de dos turnos cancelados se está
 * reemplazando.
 */

import { leerReagendamientoPendiente } from "../appointment-stats"
import {
  comentarioDeReagendamiento,
  type OrigenDelReagendamiento,
  type TurnoCanceladoParaComentario,
} from "./comentario-reagendamiento"

export interface ReagendamientoExplicito {
  turnoCancelado?: TurnoCanceladoParaComentario | null
  /** ISO. Si no se sabe, se omite la fecha de cancelación del texto. */
  canceladoEl?: string | null
  origen?: OrigenDelReagendamiento
}

export async function comentarioParaLaReserva(params: {
  clienteId?: string
  /** Normalizado, como se guardó la marca. */
  telefono?: string
  /** Lo que el flujo ya sabe, cuando lo sabe. */
  explicito?: ReagendamientoExplicito | null
  /** Un comentario propio del llamador, que no se pisa. */
  comentarioDelLlamador?: string
}): Promise<string | undefined> {
  const propio = params.comentarioDelLlamador?.trim()

  let deReagendamiento = ""
  try {
    if (params.explicito) {
      deReagendamiento = comentarioDeReagendamiento(params.explicito)
    } else if (params.clienteId && params.telefono) {
      const marca = await leerReagendamientoPendiente(params.clienteId, params.telefono)
      if (marca) {
        deReagendamiento = comentarioDeReagendamiento({
          turnoCancelado: marca.turnoCancelado,
          canceladoEl: marca.cancelledAt,
          origen: marca.origen,
        })
      }
    }
  } catch (error) {
    // Nunca bloquear una reserva por el comentario. El turno vale más que la
    // trazabilidad del turno.
    console.error("[COMENTARIO-RESERVA] No se pudo resolver el comentario:", error)
  }

  const partes = [deReagendamiento, propio].filter((x): x is string => Boolean(x))
  if (partes.length === 0) return undefined
  return partes.join(" ")
}
