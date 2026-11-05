/**
 * Avisarle al paciente que tiene una respuesta (5/11/2026).
 *
 * ── Esta función decide si el cambio ahorra plata o no ─────────────────────
 *
 * Sólo se pagan los mensajes que SALEN, y cada uno cuesta lo mismo: US$ 0,0318
 * sea un mensaje del agente o un aviso. Así que mover la conversación al chat
 * no ahorra nada por sí solo — si avisáramos cada mensaje del agente,
 * cambiaríamos quince mensajes de WhatsApp por quince avisos de WhatsApp.
 *
 * El ahorro sale de avisar POCO:
 *
 *   hoy        15 mensajes del agente × US$ 0,0318 = US$ 0,48
 *   con chat   1 o 2 avisos                        = US$ 0,03 a 0,06
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * Se avisa cuando el paciente NO está mirando y no se le avisó hace poco.
 *
 *  · Mirando = el chat consultó al servidor en los últimos 40 segundos. Ver
 *    `marcarPresente`: el latido es la misma consulta con la que el chat se
 *    actualiza, y se detiene con la pestaña oculta, así que una pestaña abierta
 *    que nadie mira NO cuenta como presente.
 *  · Hace poco = diez minutos. Si el paciente se fue del chat y el agente
 *    manda cuatro mensajes seguidos, es un solo aviso.
 *
 * El primer mensaje de una consulta cae solo en esta regla: el paciente nunca
 * abrió el chat, así que no está presente y no se le avisó nunca.
 *
 * ── Qué NO hace ───────────────────────────────────────────────────────────
 *
 * No manda el contenido del mensaje. El aviso dice que hay una respuesta y
 * lleva el botón; lo que dijo el agente está del otro lado del enlace. Dos
 * razones: el contenido es clínico y el aviso viaja por un canal que no
 * controlamos, y meter el texto convertiría el aviso en el mensaje —con lo que
 * volveríamos a pagar por mensaje—.
 */

import { getRedisClient } from "../redis"
import { estadoVentana } from "../ventana-atencion"
import { estaPresente } from "./conversacion"
import { emitirEnlaceDeAtencion, urlDelChat } from "./token"
import { construirMensajeConEnlace, enviarMensajeConEnlace } from "../portal/mensaje-enlace"
import { primerNombrePresentable } from "../portal/mensaje-enlace"
import { sendWhatsAppTemplate } from "../whatsapp-api"
import { cuerpoDelEnvio } from "./plantilla"
import type { WhatsAppConfig } from "../types"

/** Diez minutos entre avisos. */
export const ESPERA_ENTRE_AVISOS_SEGUNDOS = 10 * 60

const ULTIMO_AVISO = "atencion:aviso:"

/** El texto del botón. Tope de 20 caracteres en un CTA URL de WhatsApp. */
export const BOTON_DEL_AVISO = "Ver la respuesta"

export type ResultadoDelAviso =
  | { enviado: true; motivo: "ventana_abierta" | "plantilla"; token: string }
  | {
      enviado: false
      motivo:
        | "presente"
        | "avisado_hace_poco"
        | "sin_token"
        | "falla"
        /** Fuera de las 24 h y la plantilla no está dada de alta todavía. */
        | "sin_plantilla"
    }

async function avisadoHacePoco(clienteId: string, telefono: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    return (await redis.get(`${ULTIMO_AVISO}${clienteId}:${telefono}`)) !== null
  } catch {
    // Si no se puede leer, se avisa: que el paciente reciba un aviso de más es
    // mucho mejor que quedarse esperando una respuesta que ya está escrita.
    return false
  }
}

async function marcarAvisado(clienteId: string, telefono: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.set(`${ULTIMO_AVISO}${clienteId}:${telefono}`, Date.now(), {
      ex: ESPERA_ENTRE_AVISOS_SEGUNDOS,
    })
  } catch {
    // Ídem: el peor caso es un aviso repetido.
  }
}

/**
 * El cuerpo del aviso.
 *
 * Dice de quién es la respuesta y qué hacer, y nada más. No dice "hacé clic
 * acá": el botón está abajo y nombrarlo alcanza.
 */
export function textoDelAviso(params: { clinica: string; pacienteNombre?: string }): string {
  const nombre = primerNombrePresentable(params.pacienteNombre)
  // Sin nombre la frase arranca la oración, así que le toca la mayúscula. Un
  // "tenés una respuesta" en minúscula se lee como un mensaje cortado.
  const saludo = nombre ? `${nombre}, t` : "T"
  return (
    `${saludo}enés una respuesta del equipo de ${params.clinica}.\n\n` +
    `Entrá con el botón para leerla y seguir la conversación. Podés escribir, mandar fotos o ` +
    `grabar un audio desde ahí.`
  )
}

/**
 * Avisa, si corresponde.
 *
 * Nunca lanza: el mensaje del agente ya quedó guardado y visible en el chat.
 * Que el aviso falle es un problema —el paciente puede no enterarse— pero
 * hacer fallar el envío del agente por eso sería peor: perdería el mensaje.
 */
export async function avisarSiCorresponde(params: {
  config: WhatsAppConfig
  clienteId: string
  telefono: string
  pacienteNombre?: string
  /** Para los tests y para forzar el aviso desde el panel si algún día se ofrece. */
  forzar?: boolean
}): Promise<ResultadoDelAviso> {
  const { config, clienteId, telefono, pacienteNombre } = params

  try {
    if (!params.forzar) {
      if (await estaPresente(clienteId, telefono)) {
        return { enviado: false, motivo: "presente" }
      }
      if (await avisadoHacePoco(clienteId, telefono)) {
        return { enviado: false, motivo: "avisado_hace_poco" }
      }
    }

    const token = await emitirEnlaceDeAtencion({
      configId: config.id,
      clienteId,
      telefono,
      pacienteNombre,
    })
    if (!token) return { enviado: false, motivo: "sin_token" }

    const clinica = config.displayName?.trim() || "la clínica"

    /**
     * Dentro de la ventana de 24 h: un mensaje libre con botón de URL.
     *
     * "desconocida" se trata como abierta: pasa en conversaciones que venían
     * en curso cuando se incorporó el registro de la ventana, y el peor caso
     * es que Meta rechace el envío —que es lo que ya maneja el panel—.
     */
    const ventana = await estadoVentana(config.id, telefono)

    if (ventana.estado !== "cerrada") {
      await enviarMensajeConEnlace(
        config.phoneNumberId,
        config.accessToken,
        construirMensajeConEnlace({
          to: telefono,
          cuerpo: textoDelAviso({ clinica, pacienteNombre }),
          url: urlDelChat(token),
          textoDelBoton: BOTON_DEL_AVISO,
        }),
      )
      await marcarAvisado(clienteId, telefono)
      console.log(`[ATENCION] Aviso enviado a ${telefono} (${clienteId}), ventana abierta`)
      return { enviado: true, motivo: "ventana_abierta", token }
    }

    /**
     * Fuera de la ventana: sólo una plantilla aprobada.
     *
     * Se intenta SÓLO si la clínica la tiene declarada. Mandarla a ciegas no
     * sirve: una plantilla que no existe devuelve un error de Meta que no se
     * distingue de un problema de red, el agente vería "no se pudo avisar" sin
     * saber por qué, y cada intento sería un viaje perdido.
     *
     * Mientras no esté, el agente ve el estado de la ventana que el panel
     * muestra desde el 15/9, que es exactamente la información que necesita.
     * Ver lib/atencion/plantilla.ts para el alta.
     */
    const nombreDePlantilla = config.plantillaAvisoDeAtencion?.trim()
    if (!nombreDePlantilla) {
      return { enviado: false, motivo: "sin_plantilla" }
    }

    await sendWhatsAppTemplate(
      config.phoneNumberId,
      config.accessToken,
      telefono,
      cuerpoDelEnvio({ clinica, token, nombre: nombreDePlantilla }),
      config.wabaId,
    )

    await marcarAvisado(clienteId, telefono)
    console.log(
      `[ATENCION] Aviso enviado a ${telefono} (${clienteId}) por plantilla «${nombreDePlantilla}»`,
    )
    return { enviado: true, motivo: "plantilla", token }
  } catch (error) {
    console.error("[ATENCION] No se pudo avisar al paciente:", error)
    return { enviado: false, motivo: "falla" }
  }
}
