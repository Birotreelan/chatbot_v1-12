/**
 * El mensaje que abre el Flow (22/9/2026).
 *
 * ── Por qué el Flow va en un mensaje aparte ────────────────────────────────
 *
 * La primera idea era colgar el Flow de un botón del recordatorio. La plantilla
 * que se aprobó no lo hace: sus tres botones son quick reply, y "Reprogramar
 * turno" simplemente nos avisa que el paciente quiere reprogramar. El Flow sale
 * después, por acá.
 *
 * Cuesta un mensaje facturable más. A cambio resuelve el problema que tenía la
 * otra forma, y que era el que bloqueaba todo:
 *
 * Con el Flow colgado del template, los turnos disponibles tenían que viajar
 * DENTRO del recordatorio — o sea buscarlos para los 500 pacientes del día, a
 * las nueve de la mañana, contra un proxy que tarda 4 segundos. Acá se buscan
 * sólo para el que tocó el botón, que es una fracción chica, y en el webhook,
 * donde hay 300 segundos y el paciente ya está identificado.
 *
 * Y como los datos se arman en el momento, no quedan viejos: con la otra forma,
 * un paciente que abría el recordatorio al día siguiente veía horarios que ya
 * se habían ocupado.
 *
 * ── El Flow sigue sin endpoint ─────────────────────────────────────────────
 *
 * `flow_action: "navigate"` con los datos en `flow_action_payload.data`. No hay
 * data_exchange, así que no hay endpoint que pueda quedar lento y throttlear el
 * Flow. Ver flow-reagendar.ts.
 */

import { PANTALLA_ELEGIR } from "./flow-reagendar"

/** Texto del botón que abre el Flow. Tope de WhatsApp: 30 caracteres, sin emoji. */
export const CTA_REAGENDAR = "Ver horarios disponibles"

export interface MensajeFlow {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to: string
  type: "interactive"
  interactive: Record<string, any>
}

/**
 * Arma el payload del mensaje interactivo de tipo `flow`.
 *
 * Puro y separado del envío para poder testear lo que importa —que el token
 * viaje, que los datos lleguen a la pantalla correcta, que no se cuele un
 * data_exchange— sin tocar la red.
 */
export function construirMensajeFlow(params: {
  to: string
  flowId: string
  flowToken: string
  cuerpo: string
  /** Lo que ve la primera pantalla. Ver construirDatosDeLaPantalla. */
  datosDeLaPantalla: unknown
  encabezado?: string
  pie?: string
  cta?: string
  /**
   * `draft` permite probar el Flow en un teléfono propio antes de publicarlo.
   * En producción va `published`, que es el valor por defecto de Meta.
   */
  modo?: "draft" | "published"
}): MensajeFlow {
  const interactive: Record<string, any> = {
    type: "flow",
    body: { text: params.cuerpo },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_id: params.flowId,
        // Identifica esta conversación cuando vuelva el nfm_reply. La
        // documentación lo compara con un id de sesión web: no puede ser
        // adivinable ni reutilizable.
        flow_token: params.flowToken,
        flow_cta: acotar(params.cta || CTA_REAGENDAR, 30),
        // `navigate` y no `data_exchange`: al abrirse, el Flow NO llama a
        // ningún endpoint nuestro. Los datos ya van acá abajo.
        flow_action: "navigate",
        flow_action_payload: {
          screen: PANTALLA_ELEGIR,
          data: params.datosDeLaPantalla,
        },
        ...(params.modo ? { mode: params.modo } : {}),
      },
    },
  }

  if (params.encabezado) {
    interactive.header = { type: "text", text: acotar(params.encabezado, 60) }
  }
  if (params.pie) {
    interactive.footer = { text: acotar(params.pie, 60) }
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: "interactive",
    interactive,
  }
}

/**
 * Recorta respetando los límites de WhatsApp.
 *
 * Pasarse no trunca: rechaza el mensaje entero y el paciente no recibe nada.
 */
function acotar(texto: string, maximo: number): string {
  const limpio = (texto || "").trim()
  if (limpio.length <= maximo) return limpio
  return limpio.slice(0, maximo - 1).trimEnd() + "…"
}

/**
 * Envía el mensaje. El armado está arriba, en `construirMensajeFlow`.
 *
 * Errores comunes de este endpoint: el Flow todavía en borrador cuando se
 * manda `published`, o la ventana de 24 h cerrada. Se loguea la respuesta cruda
 * porque son dos causas muy distintas con el mismo síntoma.
 */
export async function enviarMensajeFlow(
  phoneNumberId: string,
  accessToken: string,
  mensaje: MensajeFlow,
): Promise<any> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const respuesta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensaje),
  })

  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    console.error("[FLOWS] ❌ Error enviando el mensaje de Flow:", JSON.stringify(datos))
    throw new Error(`WhatsApp Flow API error: ${JSON.stringify(datos)}`)
  }

  console.log(`[FLOWS] ✅ Flow enviado a ${mensaje.to}`)
  return datos
}
