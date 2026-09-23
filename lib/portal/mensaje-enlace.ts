/**
 * El mensaje de WhatsApp que lleva al portal (22/9/2026).
 *
 * ── Tres restricciones del botón CTA que definen el diseño ─────────────────
 *
 * 1. **Sólo un botón por mensaje**, y no se puede combinar con botones de
 *    respuesta rápida. O sea que el mensaje que lleva el enlace no puede
 *    ofrecer además "prefiero hablar con alguien": eso va en el texto.
 *
 * 2. **Tocarlo no genera ningún webhook.** No nos enteramos de que el paciente
 *    abrió el enlace. El único que puede avisarnos es el portal cuando carga,
 *    así que toda la medición del embudo vive del lado del portal.
 *
 * 3. **No renueva la ventana de 24 h**, porque no es un mensaje del usuario.
 *    En la práctica alcanza —el paciente abre el enlace a los segundos de
 *    recibirlo, y la ventana sigue abierta por el mensaje que disparó esta
 *    respuesta— pero condiciona cualquier aviso posterior.
 */

export const LIMITE_TEXTO_BOTON = 20
export const LIMITE_ENCABEZADO = 60
export const LIMITE_PIE = 60

export interface MensajeConEnlace {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to: string
  type: "interactive"
  interactive: Record<string, any>
}

/**
 * Arma el payload. Separado del envío para poder testear lo que importa —que
 * la URL viaje entera, que los textos entren en los límites— sin tocar la red.
 */
export function construirMensajeConEnlace(params: {
  to: string
  cuerpo: string
  url: string
  textoDelBoton?: string
  encabezado?: string
  pie?: string
}): MensajeConEnlace {
  const interactive: Record<string, any> = {
    type: "cta_url",
    body: { text: params.cuerpo },
    action: {
      name: "cta_url",
      parameters: {
        display_text: acotar(params.textoDelBoton || "Gestionar mi turno", LIMITE_TEXTO_BOTON),
        // La URL NO se acorta nunca. Si no entrara, el enlace dejaría de
        // funcionar y el paciente vería un botón que lo lleva a un error.
        url: params.url,
      },
    },
  }

  if (params.encabezado) {
    interactive.header = { type: "text", text: acotar(params.encabezado, LIMITE_ENCABEZADO) }
  }
  if (params.pie) {
    interactive.footer = { text: acotar(params.pie, LIMITE_PIE) }
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.to,
    type: "interactive",
    interactive,
  }
}

function acotar(texto: string, maximo: number): string {
  const limpio = (texto || "").trim()
  if (limpio.length <= maximo) return limpio
  return limpio.slice(0, maximo - 1).trimEnd() + "…"
}

/**
 * Envía el mensaje.
 *
 * Si falla, el llamador debería caer al flujo conversacional de siempre: un
 * paciente atendido por el camino viejo es mucho mejor que un paciente sin
 * respuesta.
 */
export async function enviarMensajeConEnlace(
  phoneNumberId: string,
  accessToken: string,
  mensaje: MensajeConEnlace,
): Promise<any> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`

  const respuesta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensaje),
  })

  const datos = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    console.error("[PORTAL] ❌ Error enviando el enlace:", JSON.stringify(datos))
    throw new Error(`WhatsApp CTA URL error: ${JSON.stringify(datos)}`)
  }

  console.log(`[PORTAL] ✅ Enlace enviado a ${mensaje.to}`)
  return datos
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/**
 * Los textos viven acá y no incrustados en el webhook, por el mismo motivo que
 * los del recordatorio: lo que dicen decide si el paciente recibe el saludo
 * inicial. Ninguno puede contener "asistente virtual" ni "bienvenid", porque
 * `presentarSiCorresponde` los tomaría por mensajes que ya se identifican y no
 * antepondría la presentación.
 */
export function textoParaReprogramar(turno?: { fechaFormateada?: string; horaFormateada?: string }): string {
  const cuando =
    turno?.fechaFormateada && turno?.horaFormateada
      ? ` del ${turno.fechaFormateada} a las ${turno.horaFormateada}`
      : ""
  return (
    `Para reprogramar tu turno${cuando}, entrá al enlace de abajo y elegí el horario que te quede mejor.\n\n` +
    `Si preferís que te ayudemos por acá, escribime y seguimos.`
  )
}

export function textoParaTurnoNuevo(): string {
  return (
    "Podés sacar tu turno desde el enlace de abajo: elegís la sede, el profesional y el horario que te quede mejor.\n\n" +
    "Si preferís que te ayudemos por acá, escribime y seguimos."
  )
}

export const BOTON_REPROGRAMAR = "Elegir horario"
export const BOTON_TURNO_NUEVO = "Sacar turno"
