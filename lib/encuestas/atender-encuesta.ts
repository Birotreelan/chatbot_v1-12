/**
 * Qué hace el bot cuando el paciente responde la encuesta (3/11/2026).
 *
 * ── Las cuatro salidas ─────────────────────────────────────────────────────
 *
 *   · "Estoy conforme" (o un texto que dice que está bien) → el link, y si no
 *     hay link, el agradecimiento solo.
 *   · "Molestia o disconformidad" (o un texto que suena a eso) → derivación
 *     inmediata, SIN link.
 *   · texto que no se entiende → se repregunta una vez.
 *   · texto que no se entiende dos veces → se deriva igual.
 *
 * En ningún camino un mensaje ambiguo de un paciente operado termina en
 * "gracias, que tengas un buen día".
 *
 * ── La derivación no ofrece, deriva ────────────────────────────────────────
 *
 * El `handleDeriveToHuman` de siempre PREGUNTA "¿te conecto?" cuando hay
 * agentes disponibles, porque ahí el paciente pidió hablar con alguien y puede
 * arrepentirse. Acá no corresponde: el paciente dijo que algo le molesta
 * después de una cirugía, y preguntarle si quiere que lo atiendan agrega un
 * ida y vuelta en el único caso donde el tiempo importa.
 *
 * Pero el CRITERIO de a dónde se deriva es el mismo que el resto del sistema,
 * como pidió Nicolás: si la clínica tiene atención humana habilitada, al panel;
 * si no, al teléfono de derivación.
 *
 * ── Fuera de horario se abre la sesión igual ───────────────────────────────
 *
 * Y además se le da el teléfono. Es la única diferencia con el resto de las
 * derivaciones, y es deliberada: una molestia postoperatoria no se puede
 * "volver a intentar mañana". La sesión queda registrada para que la clínica la
 * vea al abrir, y el paciente tiene un número ahora.
 *
 * ── Por qué recibe un entorno y no importa nada del webhook ────────────────
 *
 * `sendDirectResponse` y la creación de sesiones viven en whatsapp.tsx, que son
 * 8.000 líneas y no se puede importar desde acá sin arrastrar medio sistema.
 * El llamador pasa las cuatro cosas que hacen falta y este módulo queda puro:
 * se puede simular entero, que es lo que uno quiere de la pieza que decide si
 * un paciente operado habla con una persona o no.
 */

import {
  cerrarEncuesta,
  contarRepregunta,
  leerEncuestaAbierta,
  BOTON_DE_LA_ENCUESTA,
  mensajeConLink,
  mensajeDerivacionAlTelefono,
  mensajeDerivacionPorMolestia,
  mensajeRepregunta,
  mensajeSinLink,
  PAYLOAD_CONFORME,
  PAYLOAD_DISCONFORME,
  type EncuestaAbierta,
} from "./encuesta-postoperatoria"
import { interpretarRespuestaDeEncuesta } from "./interpretar-texto"
import { obtenerLinkDeEncuesta } from "./link-de-encuesta"

export interface EntornoDeEncuesta {
  configId: string
  clienteId: string
  telefono: string
  /** Manda un mensaje al paciente. */
  responder: (texto: string, etiqueta: string) => Promise<void>
  /**
   * Manda un mensaje con un botón que abre una URL (CTA URL de WhatsApp).
   *
   * Separado de `responder` porque son dos tipos de mensaje distintos para
   * Meta y porque el CTA tiene restricciones propias: un solo botón, no se
   * combina con respuestas rápidas y 20 caracteres de etiqueta.
   *
   * Si falla, el llamador tira: acá se cae al mensaje sin botón, que es mejor
   * que no contestarle nada a un paciente que dijo que está bien.
   */
  responderConBoton: (params: {
    texto: string
    url: string
    textoDelBoton: string
    etiqueta: string
  }) => Promise<void>
  /** `true` si la clínica atiende por el panel de Iris. */
  atencionHumanaHabilitada: () => Promise<boolean>
  /** `true` si estamos dentro del horario de atención de la clínica. */
  enHorario: () => Promise<boolean>
  /** Abre la sesión de soporte para que un agente la tome. */
  abrirSesion: (params: { motivo: string; resumen: string }) => Promise<void>
  /**
   * El teléfono de derivación, resuelto con `ultimaSalida: true`: se da aunque
   * el switch esté apagado, porque acá no hay otra puerta.
   */
  telefonoDeDerivacion?: string
}

export type ResultadoDeEncuesta =
  | "link_enviado"
  | "sin_link"
  | "derivado_al_panel"
  | "derivado_al_telefono"
  | "repreguntado"
  | "no_era_encuesta"

/** Un resumen corto de la cirugía, para que el agente no arranque de cero. */
function resumenParaElAgente(encuesta: EncuestaAbierta, dicho: string): string {
  const partes: string[] = []
  if (encuesta.cirugia?.nombre) partes.push(encuesta.cirugia.nombre)
  if (encuesta.cirugia?.ojo) partes.push(`ojo ${encuesta.cirugia.ojo}`)
  if (encuesta.cirugia?.fecha) partes.push(`del ${encuesta.cirugia.fecha}`)
  if (encuesta.cirugia?.cirujano) partes.push(`cirujano: ${encuesta.cirugia.cirujano}`)
  const cirugia = partes.length > 0 ? partes.join(" · ") : "cirugía sin datos"
  const hc = encuesta.paciente?.hc ? ` · HC ${encuesta.paciente.hc}` : ""
  return `Encuesta postoperatoria: el paciente refiere una molestia o disconformidad. ${cirugia}${hc}. Dijo: "${dicho.slice(0, 300)}"`
}

/**
 * Deriva, con el mismo criterio que el resto del sistema.
 *
 * Devuelve a dónde fue, para el log.
 */
async function derivar(
  entorno: EntornoDeEncuesta,
  encuesta: EncuestaAbierta,
  dicho: string,
): Promise<"derivado_al_panel" | "derivado_al_telefono"> {
  const habilitada = await entorno.atencionHumanaHabilitada().catch(() => false)

  if (!habilitada) {
    await entorno.responder(
      mensajeDerivacionAlTelefono(encuesta, entorno.telefonoDeDerivacion),
      "encuesta-derivacion-telefono",
    )
    return "derivado_al_telefono"
  }

  // La sesión se abre siempre, en horario o no: ver la nota de arriba.
  await entorno
    .abrirSesion({
      motivo: "Molestia postoperatoria",
      resumen: resumenParaElAgente(encuesta, dicho),
    })
    .catch((error) => {
      console.error("[ENCUESTA] No se pudo abrir la sesión de soporte:", error)
    })

  const enHorario = await entorno.enHorario().catch(() => true)
  if (enHorario) {
    await entorno.responder(mensajeDerivacionPorMolestia(encuesta), "encuesta-derivacion-panel")
  } else {
    // Fuera de horario se dice la verdad —van a contestar cuando abran— y
    // además se le da el teléfono, que es lo único que sirve ahora mismo.
    const base = mensajeDerivacionPorMolestia(encuesta)
    const conTelefono = entorno.telefonoDeDerivacion
      ? `${base}

Si no podés esperar, comunicate directamente:
${entorno.telefonoDeDerivacion.trim()}`
      : base
    await entorno.responder(conTelefono, "encuesta-derivacion-fuera-de-horario")
  }

  return "derivado_al_panel"
}

/** El link: el que vino al enviar, o el que diga el sistema de la clínica ahora. */
async function resolverLink(
  entorno: EntornoDeEncuesta,
  encuesta: EncuestaAbierta,
): Promise<string | null> {
  if (encuesta.linkEncuesta) return encuesta.linkEncuesta

  const { link, motivo } = await obtenerLinkDeEncuesta(encuesta.clienteId || entorno.clienteId)
  if (!link) {
    console.warn(
      `[ENCUESTA] ${entorno.telefono}: sin link para mandar (${motivo}). ` +
        `Se responde el agradecimiento sin encuesta.`,
    )
  }
  return link
}

async function responderConforme(
  entorno: EntornoDeEncuesta,
  encuesta: EncuestaAbierta,
): Promise<ResultadoDeEncuesta> {
  const link = await resolverLink(entorno, encuesta)
  if (link) {
    try {
      await entorno.responderConBoton({
        texto: mensajeConLink(encuesta),
        url: link,
        textoDelBoton: BOTON_DE_LA_ENCUESTA,
        etiqueta: "encuesta-link",
      })
      return "link_enviado"
    } catch (error) {
      // El CTA puede fallar por cosas del lado de Meta —la ventana, un
      // formato de URL que rechaza— y el paciente ya contestó que está bien.
      // Se cae al texto con el enlace adentro: es peor que el botón, y mucho
      // mejor que no responderle.
      console.error("[ENCUESTA] Falló el botón de la encuesta, se manda el enlace en el texto:", error)
      await entorno.responder(`${mensajeConLink(encuesta)}\n\n${link}`, "encuesta-link-sin-boton")
      return "link_enviado"
    }
  }
  await entorno.responder(mensajeSinLink(encuesta), "encuesta-sin-link")
  return "sin_link"
}

/**
 * Atiende la respuesta del paciente a la encuesta.
 *
 * `no_era_encuesta` significa "esto no es asunto mío": el llamador sigue con el
 * pipeline normal. Cualquier otro resultado es terminal — el mensaje ya se
 * contestó.
 */
export async function atenderRespuestaDeEncuesta(params: {
  entorno: EntornoDeEncuesta
  /** El payload del botón de plantilla, si el paciente tocó uno. */
  payload?: string
  /** El texto que escribió, si escribió. */
  texto?: string
}): Promise<ResultadoDeEncuesta> {
  const { entorno, payload, texto } = params
  const esBotonDeEncuesta = payload === PAYLOAD_CONFORME || payload === PAYLOAD_DISCONFORME

  const guardada = await leerEncuestaAbierta(entorno.configId, entorno.telefono)

  // Sin encuesta abierta y sin botón de encuesta, acá no hay nada que hacer.
  if (!guardada && !esBotonDeEncuesta) return "no_era_encuesta"

  /**
   * El botón se atiende aunque el estado no esté.
   *
   * Pasa si el paciente contesta pasados los siete días, o si Redis perdió la
   * clave. El payload es inequívoco —sólo lo puede haber tocado alguien que
   * recibió la encuesta— así que ignorarlo sería dejar sin respuesta a un
   * paciente que SÍ apretó "Molestia o disconformidad".
   *
   * Queda sin los datos de la cirugía, y el resumen para el agente lo dice.
   */
  const encuesta: EncuestaAbierta =
    guardada ?? {
      clienteId: entorno.clienteId,
      linkEncuesta: null,
      enviadaEl: "",
    }

  if (payload === PAYLOAD_DISCONFORME) {
    await cerrarEncuesta(entorno.configId, entorno.telefono)
    const destino = await derivar(entorno, encuesta, "(tocó el botón de molestia o disconformidad)")
    console.log(`[ENCUESTA] ${entorno.telefono}: botón DISCONFORME → ${destino}`)
    return destino
  }

  if (payload === PAYLOAD_CONFORME) {
    await cerrarEncuesta(entorno.configId, entorno.telefono)
    const r = await responderConforme(entorno, encuesta)
    console.log(`[ENCUESTA] ${entorno.telefono}: botón CONFORME → ${r}`)
    return r
  }

  // ── Texto libre, con la encuesta abierta ────────────────────────────────
  const mensaje = (texto || "").trim()
  if (!mensaje) return "no_era_encuesta"

  const { lectura, origen } = await interpretarRespuestaDeEncuesta(mensaje)
  console.log(`[ENCUESTA] ${entorno.telefono}: texto leído como "${lectura}" (${origen})`)

  if (lectura === "molestia") {
    await cerrarEncuesta(entorno.configId, entorno.telefono)
    return await derivar(entorno, encuesta, mensaje)
  }

  if (lectura === "conforme") {
    await cerrarEncuesta(entorno.configId, entorno.telefono)
    return await responderConforme(entorno, encuesta)
  }

  // No se entendió. Se pregunta una vez; a la segunda se deriva, porque
  // insistir con la misma pregunta a alguien que acaba de operarse es peor que
  // ponerle una persona.
  const van = await contarRepregunta(entorno.configId, entorno.telefono, encuesta)
  if (van >= 2) {
    await cerrarEncuesta(entorno.configId, entorno.telefono)
    console.log(`[ENCUESTA] ${entorno.telefono}: no se entendió dos veces → se deriva`)
    return await derivar(entorno, encuesta, mensaje)
  }

  await entorno.responder(mensajeRepregunta(encuesta), "encuesta-repregunta")
  return "repreguntado"
}
