/**
 * Reabrir la ventana de 24 h con una plantilla de autorización (9/10/2026).
 *
 * ── El problema ────────────────────────────────────────────────────────────
 *
 * WhatsApp sólo permite mensajes libres dentro de las 24 h posteriores al
 * último mensaje del paciente. Pasado ese plazo el panel mostraba un cartel
 * ámbar —"WhatsApp probablemente rechace el envío hasta que el paciente vuelva
 * a escribir"— y ahí terminaba: la clínica quedaba esperando que el paciente
 * escribiera por su cuenta, lo que muchas veces no pasa nunca.
 *
 * ── Cómo se sale ───────────────────────────────────────────────────────────
 *
 * Fuera de la ventana sólo se puede enviar una plantilla aprobada. Pero la
 * plantilla NO es el mensaje: es el anzuelo. Cuando el paciente responde —y
 * tocar el botón cuenta como responder— ese mensaje entrante abre una ventana
 * nueva de 24 h, y recién entonces el agente escribe lo que quería decir.
 *
 * O sea que la plantilla tiene un solo trabajo: conseguir que el paciente toque
 * algo. Todo lo demás va después, en texto libre, sin restricciones.
 *
 * ── Por qué el texto está congelado acá ────────────────────────────────────
 *
 * Porque de él depende la categoría, y de la categoría depende el costo:
 *
 *   utility   US$ 0,0260 + impuestos = US$ 0,0318
 *   marketing US$ 0,0618 + impuestos = US$ 0,0756
 *
 * Al cliente se le factura US$ 0,075 por unidad. Una plantilla clasificada como
 * marketing costaría MÁS de lo que se cobra: el envío pasaría a perder dinero.
 * Por eso el cuerpo afirma que hay una gestión pendiente de la atención del
 * paciente, que es literalmente lo que la definición de utility exige, y por eso
 * el motivo se valida en vez de aceptarse tal cual. Meta recategoriza las
 * plantillas según lo que realmente se manda: un motivo promocional convierte
 * la plantilla en marketing para todos los clientes a la vez, sin aviso.
 *
 * ── Por qué está separado del estado ───────────────────────────────────────
 *
 * Este módulo lo importa el panel de atención, que corre en el navegador: la
 * previsualización tiene que mostrar el texto EXACTO que va a recibir el
 * paciente, y la validación del motivo tiene que ser la misma de los dos lados.
 * El estado de las invitaciones vive en reapertura.ts, que usa Redis;
 * importarlo desde el cliente arrastraría todo el cliente de Redis al bundle.
 */

/**
 * Nombre de la plantilla en Meta. Igual en todas las cuentas: el texto es
 * universal y se da de alta una vez por WABA con este mismo nombre.
 *
 * Se puede pisar por cliente —`config.plantillaReapertura`— para el caso en que
 * una cuenta haya tenido que registrarla con otro nombre, por ejemplo porque el
 * primer alta quedó rechazada y hubo que reintentar con un nombre nuevo.
 */
export const PLANTILLA_REAPERTURA = "autorizar_conversacion"

/** Meta aprueba por idioma, y el cuerpo está escrito en español rioplatense. */
export const IDIOMA_PLANTILLA = "es_AR"

/**
 * Payload del botón «Aceptar conversación».
 *
 * Es lo que distingue este toque de cualquier otro botón de plantilla. Tiene que
 * viajar en el envío —`parameters: [{ type: "payload", payload: ... }]`— porque
 * si no, el webhook recibe sólo el TEXTO del botón y el bot lo trata como una
 * opción de menú: el paciente autoriza la conversación y recibe el menú
 * automático en lugar del agente que lo estaba esperando.
 */
export const PAYLOAD_BOTON_REAPERTURA = "RETOMAR_CONVERSACION"

/** El texto del botón, para la previsualización. El de Meta tope en 25. */
export const TEXTO_BOTON_REAPERTURA = "Aceptar conversación"

/** Tope del motivo. Entra en una línea del teléfono y no tapa el resto. */
export const MOTIVO_MAX = 60

/**
 * Motivos que mantienen la categoría utility, ofrecidos como punto de partida.
 *
 * No son una lista cerrada: el agente puede escribir el suyo. Son ejemplos de
 * la FORMA que tiene que tener —una gestión concreta del paciente— porque
 * describir la regla en abstracto no le sirve a nadie que esté apurado.
 */
export const MOTIVOS_SUGERIDOS = [
  "Resultado de tu estudio",
  "Tu turno de esta semana",
  "Documentación para tu obra social",
  "Falta un dato en tu ficha",
  "Tu solicitud de turno",
  "Indicaciones previas a tu estudio",
] as const

/**
 * Términos que delatan un motivo promocional.
 *
 * ── Por qué una lista y no un modelo ──────────────────────────────────────
 *
 * Porque no hace falta acertar siempre: alcanza con frenar el caso obvio y
 * explicar la regla en el momento en que alguien la está por romper. Un agente
 * que lee "esto convertiría la plantilla en marketing y costaría el doble"
 * entiende el criterio y escribe otra cosa. El que recibe un rechazo sin
 * explicación escribe "pr0mo" y sigue.
 *
 * Por eso el mensaje de error dice por qué, y por eso esto no pretende ser
 * exhaustivo: es un recordatorio, no una barrera.
 */
const TERMINOS_PROMOCIONALES = [
  "promo",
  "promoción",
  "promocion",
  "descuento",
  "oferta",
  "rebaja",
  "2x1",
  "gratis",
  "sin cargo",
  "bonificad",
  "liquidación",
  "liquidacion",
  "aprovechá",
  "aprovecha",
  "última oportunidad",
  "ultima oportunidad",
  "te extrañamos",
  "te extranamos",
  "volvé a",
  "volve a",
  "novedades",
  "lanzamiento",
  "nuevos servicios",
]

export type MotivoValidado =
  | { ok: true; motivo: string }
  | { ok: false; error: string }

/**
 * Valida y normaliza el motivo que escribe el agente.
 *
 * Devuelve el error listo para mostrar, con el porqué incluido. La validación
 * corre en el servidor aunque el formulario ya la haya hecho: el endpoint es
 * alcanzable sin pasar por la pantalla, y lo que está en juego es la categoría
 * de la plantilla de todos los clientes.
 */
export function validarMotivo(crudo: unknown): MotivoValidado {
  if (typeof crudo !== "string") {
    return { ok: false, error: "Falta el motivo." }
  }

  // Los saltos de línea romperían el renglón del motivo en el teléfono.
  const motivo = crudo.replace(/\s+/g, " ").trim()

  if (motivo.length === 0) {
    return { ok: false, error: "Escribí el motivo por el que querés contactar al paciente." }
  }

  if (motivo.length > MOTIVO_MAX) {
    return {
      ok: false,
      error: `El motivo no puede pasar de ${MOTIVO_MAX} caracteres (tiene ${motivo.length}).`,
    }
  }

  // Un motivo de una sola palabra suele ser un "hola" o un "consulta" que no le
  // dice nada al paciente, y además deja a la plantilla sin el anclaje concreto
  // que sostiene la categoría utility.
  if (!/\s/.test(motivo)) {
    return {
      ok: false,
      error:
        "El motivo tiene que decir de qué se trata, no una sola palabra. " +
        'Por ejemplo: "Resultado de tu estudio del 12/10".',
    }
  }

  const sinAcentos = motivo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

  const encontrado = TERMINOS_PROMOCIONALES.find((t) =>
    sinAcentos.includes(t.normalize("NFD").replace(/[̀-ͯ]/g, "")),
  )

  if (encontrado) {
    return {
      ok: false,
      error:
        `El motivo no puede ser promocional —dice "${encontrado}"—. Esta plantilla está ` +
        "aprobada como mensaje de utilidad y tiene que referirse a una gestión concreta del " +
        "paciente. Un motivo promocional la reclasifica como publicidad para todas las " +
        "clínicas, y pasa a costar más del doble.",
    }
  }

  return { ok: true, motivo }
}

/**
 * El texto exacto que va a ver el paciente.
 *
 * Existe para que la previsualización del panel y el mensaje enviado no puedan
 * diferir. Si la pantalla armara su propio texto "parecido", el día que el
 * cuerpo aprobado cambie el agente estaría leyendo una cosa y el paciente
 * recibiendo otra — y la que manda es la aprobada por Meta, que no está acá sino
 * en la cuenta.
 *
 * Es una COPIA del cuerpo aprobado, no su fuente. Si se edita la plantilla en
 * Meta hay que editar esto, y por eso el nombre dice "loQueVeElPaciente" y no
 * "cuerpoDeLaPlantilla": lo segundo sugeriría que acá se define.
 */
export function loQueVeElPaciente(nombreClinica: string, motivo: string): string {
  return (
    `Hola, te escribimos desde ${nombreClinica} por una gestión pendiente de tu atención.\n\n` +
    `Motivo: ${motivo}\n\n` +
    `WhatsApp necesita tu autorización para que podamos continuar por este medio. ` +
    `Presioná «${TEXTO_BOTON_REAPERTURA}» y te respondemos a la brevedad.\n\n` +
    `Si no esperabas este mensaje, podés ignorarlo.`
  )
}

/**
 * El objeto `template` para `sendWhatsAppTemplate`.
 *
 * El payload del botón va acá y no en el alta de la plantilla: en Meta el botón
 * se registra sólo con su texto, y el payload se define en cada envío. Es la
 * única forma de que el webhook pueda distinguir este toque.
 */
export function plantillaDeReapertura(params: {
  nombre?: string
  nombreClinica: string
  motivo: string
}) {
  return {
    name: params.nombre || PLANTILLA_REAPERTURA,
    language: { code: IDIOMA_PLANTILLA },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: params.nombreClinica },
          { type: "text", text: params.motivo },
        ],
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [{ type: "payload", payload: PAYLOAD_BOTON_REAPERTURA }],
      },
    ],
  }
}

