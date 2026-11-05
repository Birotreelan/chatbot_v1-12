/**
 * La plantilla que avisa fuera de la ventana de 24 h (5/11/2026).
 *
 * ── Por qué hace falta una nueva ───────────────────────────────────────────
 *
 * Pasadas las 24 h del último mensaje del paciente, WhatsApp sólo acepta
 * plantillas aprobadas. La que ya existe —`autorizar_conversacion`— tiene un
 * botón de respuesta rápida, así que para usarla habría que mandar dos
 * mensajes: la plantilla, esperar que el paciente la toque, y recién entonces
 * el enlace. Son US$ 0,0636 y un paso donde se pierde gente.
 *
 * Con un botón de URL el aviso es uno solo: US$ 0,0318, y el paciente llega al
 * chat de un toque.
 *
 * ── El texto está congelado acá, y de él depende el costo ──────────────────
 *
 * Es la misma razón que está escrita en lib/reapertura-texto.ts:
 *
 *   utility   US$ 0,0260 + impuestos = US$ 0,0318
 *   marketing US$ 0,0618 + impuestos = US$ 0,0756
 *
 * Al cliente se le factura US$ 0,075 por unidad, así que una plantilla
 * clasificada como marketing costaría MÁS de lo que se cobra: el aviso pasaría
 * a perder dinero, y encima Meta recategoriza según lo que realmente se manda
 * —un texto promocional convierte la plantilla en marketing para todas las
 * cuentas a la vez, sin avisar—.
 *
 * Por eso el cuerpo afirma lo único que la definición de utility exige: que
 * hay algo pendiente de una gestión que el propio paciente inició. Nada de
 * novedades, ofertas ni saludos.
 *
 * ── Qué hay que registrar en Meta ──────────────────────────────────────────
 *
 * Nombre: `respuesta_de_atencion`
 * Idioma: es_AR
 * Categoría: Utility
 * Cuerpo:
 *
 *   Tenés una respuesta del equipo de atención de {{1}}.
 *
 *   Entrá para leerla y seguir la conversación. Podés escribir, enviar fotos
 *   o grabar un audio.
 *
 * Botón: tipo "Visitar sitio web", dinámico
 *   Texto del botón: Ver la respuesta
 *   URL: https://treelan-bot.vercel.app/a/{{1}}
 *
 * El `{{1}}` del cuerpo es el nombre de la clínica y el `{{1}}` del botón es
 * el token. Son dos variables distintas: Meta las numera por componente, no
 * por plantilla, y confundirlas es el error que hace que llegue la URL con el
 * nombre de la clínica adentro.
 *
 * ── Mientras no esté aprobada ─────────────────────────────────────────────
 *
 * `avisarSiCorresponde` no manda nada fuera de la ventana y devuelve
 * `ventana_cerrada`. El agente ve el estado de la ventana que el panel ya
 * muestra desde el 15/9, que es exactamente la información que necesita. No se
 * intenta el envío a ciegas: una plantilla que no existe devuelve un error de
 * Meta que no distingue de un problema de red.
 */

/** El nombre con el que se da de alta. Pisable por cliente, como la de reapertura. */
export const PLANTILLA_AVISO = "respuesta_de_atencion"

/** Meta aprueba por idioma, y el cuerpo está en español rioplatense. */
export const IDIOMA_PLANTILLA = "es_AR"

/** Tope de 25 caracteres en el texto de un botón de plantilla. */
export const BOTON_PLANTILLA = "Ver la respuesta"

/**
 * El cuerpo, para la previsualización y para los tests.
 *
 * Tiene que decir LO MISMO que el texto registrado en Meta. Si se separan, la
 * previsualización del panel miente sobre lo que recibe el paciente.
 */
export function cuerpoDeLaPlantilla(clinica: string): string {
  return (
    `Tenés una respuesta del equipo de atención de ${clinica}.\n\n` +
    `Entrá para leerla y seguir la conversación. Podés escribir, enviar fotos o grabar un audio.`
  )
}

/**
 * El payload del envío.
 *
 * El botón de URL dinámico recibe SÓLO el sufijo, no la URL entera: el resto
 * —`https://…/a/`— quedó fijo al registrar la plantilla. Mandar la URL
 * completa produce `https://…/a/https://…/a/token`, que es un error que Meta
 * no rechaza: el mensaje sale y el botón lleva a ninguna parte.
 */
export function cuerpoDelEnvio(params: {
  clinica: string
  token: string
  nombre?: string
}): Record<string, unknown> {
  return {
    template: {
      name: params.nombre || PLANTILLA_AVISO,
      language: { code: IDIOMA_PLANTILLA },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: params.clinica }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: params.token }],
        },
      ],
    },
  }
}
