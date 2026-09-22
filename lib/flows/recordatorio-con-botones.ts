/**
 * Recordatorio de turno con botones (21/9/2026).
 *
 * ── El hallazgo que define este módulo ─────────────────────────────────────
 *
 * El template del recordatorio NO lo armamos nosotros. El sistema de la clínica
 * hace POST a /api/proxylistener con `Body` = el JSON completo del template
 * —nombre, idioma, parámetros— y nosotros lo retransmitimos tal cual.
 *
 * Eso podría haber significado pedirle a cada clínica que modifique su
 * integración. No hace falta: interceptamos el payload de salida y lo
 * reescribimos. La clínica sigue mandando exactamente lo que manda hoy; cuando
 * `clienteFlows` está en true, le cambiamos el nombre del template y le
 * agregamos los botones. El switch del dashboard controla eso y nada más.
 *
 * La condición para que sea transparente: el template nuevo tiene que aceptar
 * los MISMOS parámetros, en el MISMO orden. Por eso `definicionDeTemplate` no
 * inventa el cuerpo — recibe el texto y sólo se ocupa de los botones.
 *
 * ── Por qué botones y no todo adentro del Flow ─────────────────────────────
 *
 * Meter confirmar y cancelar dentro del Flow ahorraría un mensaje por
 * recordatorio. Cuesta convertir un toque en cinco interacciones, para una
 * población de pacientes de oftalmología. La tasa de respuesta vale más que el
 * centavo.
 *
 * Y hay algo que no es de costo: un botón no se interpreta. Las tres
 * confirmaciones rechazadas de Antonia, el "16.15" de Cristina, el
 * "Jueves 17\n2" que reservó lo que no era — toda esa familia de bugs sale de
 * leer texto libre contra un estado implícito. Con botones desaparece por
 * construcción.
 *
 * ── Una limitación de Meta que conviene tener presente ─────────────────────
 *
 * Textual, de la referencia de componentes: *"templates composed of 4 or more
 * buttons, or a quick reply button and one or more buttons of another type,
 * cannot be viewed on WhatsApp desktop clients."* Esta combinación —dos quick
 * reply más un botón de Flow— cae ahí: al paciente que abra el recordatorio en
 * WhatsApp Web le va a pedir que lo mire en el teléfono.
 */

/**
 * Etiquetas de los botones. Máximo 25 caracteres cada una (límite de Meta).
 *
 * Son constantes porque son la clave de ruteo: al tocar un quick reply, el
 * webhook recibe el texto del botón en `message.button.text`. Matchear contra
 * estas constantes de forma EXACTA —no por substring— es lo que evita repetir
 * la clase de bug que veníamos arreglando.
 */
export const BOTON_CONFIRMAR = "Confirmar Asistencia"
export const BOTON_CANCELAR = "Cancelar turno"
export const BOTON_REAGENDAR = "Reprogramar turno"

/**
 * Las etiquetas del template VIEJO (`confirmacion_1_turno`), que sigue vivo.
 *
 * Un recordatorio mandado ayer se queda en el chat del paciente y sus botones
 * siguen funcionando: alguien puede tocar "Confirmar" tres días después de que
 * migramos el template. Si sólo aceptáramos las etiquetas nuevas, esos toques
 * dejarían de rutear y el paciente se quedaría sin respuesta.
 */
const ETIQUETAS_VIEJAS: Record<string, AccionDelRecordatorio> = {
  confirmar: "confirmar",
  cancelar: "cancelar",
}

/**
 * Payload explícito de cada quick reply.
 *
 * WhatsApp devuelve `button.text` y `button.payload`. El texto es visible y lo
 * puede replicar cualquiera escribiéndolo a mano; el payload lo definimos
 * nosotros al enviar. Cuando estén los dos, conviene rutear por payload.
 */
export const PAYLOAD_CONFIRMAR = "FLOWS_CONFIRMAR"
export const PAYLOAD_CANCELAR = "FLOWS_CANCELAR"
export const PAYLOAD_REAGENDAR = "FLOWS_REAGENDAR"

export type AccionDelRecordatorio = "confirmar" | "cancelar" | "reagendar"

/**
 * Traduce lo que llegó del webhook a una acción, sin adivinar.
 *
 * Devuelve null cuando el mensaje no corresponde a ninguno de nuestros botones
 * — y eso es lo correcto: que siga su camino por el motor conversacional en vez
 * de forzarlo dentro de una de las tres opciones.
 */
export function accionDelBoton(boton: { text?: string; payload?: string } | null | undefined): AccionDelRecordatorio | null {
  if (!boton) return null

  const payload = (boton.payload || "").trim().toUpperCase()
  if (payload === PAYLOAD_CONFIRMAR) return "confirmar"
  if (payload === PAYLOAD_CANCELAR) return "cancelar"
  if (payload === PAYLOAD_REAGENDAR) return "reagendar"

  // La comparación es sin distinguir mayúsculas. WhatsApp devuelve el título
  // exactamente como se aprobó, pero la plantilla real dice "Confirmar
  // Asistencia" con A mayúscula y en el código estaba escrito con minúscula:
  // una diferencia invisible al leer que habría dejado el botón sin rutear.
  const texto = (boton.text || "").trim().toLowerCase()
  if (!texto) return null
  if (texto === BOTON_CONFIRMAR.toLowerCase()) return "confirmar"
  if (texto === BOTON_CANCELAR.toLowerCase()) return "cancelar"
  if (texto === BOTON_REAGENDAR.toLowerCase()) return "reagendar"

  return ETIQUETAS_VIEJAS[texto] ?? null
}

// ─── Creación del template (se hace una vez por WABA) ────────────────────────

/**
 * El cuerpo vigente de `confirmacion_1_turno`, tal cual está aprobado hoy.
 *
 * Se copia textual a propósito. El template nuevo tiene que aceptar los MISMOS
 * cinco parámetros en el MISMO orden —sede, fecha, hora, profesional,
 * dirección— porque el sistema de la clínica va a seguir mandando exactamente
 * lo que manda hoy y nosotros sólo le cambiamos el nombre al template. Un
 * parámetro corrido acá es un paciente recibiendo la fecha de otro.
 *
 * La única diferencia con el aprobado: dice "confirme o cancele su asistencia"
 * y ahora hay una tercera opción. Ver CUERPO_CON_REAGENDAR.
 */
export const CUERPO_VIGENTE =
  "Hola! Nos comunicamos desde {{1}} para recordarle que tiene un turno el día {{2}}, " +
  "a las {{3}} horas con {{4}} en {{5}}.\n\n" +
  "Por favor, confirme o cancele su asistencia.\n\n" +
  "Muchas gracias."

/** Encabezado de la plantilla con Flows, tal como se aprobó. */
export const ENCABEZADO_CON_REAGENDAR = "Recordatorio de turno"

/**
 * El cuerpo de `confirmacion_1_flows`, la plantilla que se creó el 22/9/2026.
 *
 * Mantiene los cinco parámetros en el mismo orden que la vigente —sede, fecha,
 * hora, profesional, dirección— que es lo que permite reescribir el envío sin
 * que la clínica cambie nada.
 */
export const CUERPO_CON_REAGENDAR =
  "Estimado/a paciente:\n\n" +
  "Nos comunicamos desde {{1}} para recordarle que tiene un turno programado para el día {{2}} " +
  "a las {{3}} horas, con {{4}}, en {{5}}.\n\n" +
  "Por favor, seleccione una de las siguientes opciones para confirmar su asistencia, " +
  "cancelar el turno o solicitar una reprogramación.\n\n" +
  "Muchas gracias."

/** Los ejemplos que ya tiene aprobados el template vigente. */
export const EJEMPLOS_VIGENTES = [
  "Centro de Ojos Lanus",
  "17/12/2025",
  "10:15",
  "Juan Perez",
  "San Martin 343",
]

export interface DefinicionDeTemplate {
  name: string
  language: string
  category: "UTILITY"
  components: unknown[]
}

/**
 * Arma el cuerpo de la request de creación del template.
 *
 * `cuerpo` y `ejemplos` vienen de afuera a propósito: el template actual de la
 * clínica ya tiene un texto aprobado y una cantidad de variables fija, y este
 * template nuevo tiene que aceptar exactamente los mismos parámetros en el
 * mismo orden para que la reescritura del envío sea invisible. Inventar el
 * texto acá sería cambiarle el mensaje al paciente sin querer.
 */
export function definicionDeTemplate(params: {
  nombre: string
  idioma: string
  /** El MISMO texto del template vigente, con sus {{1}}…{{n}}. */
  cuerpo: string
  /** Un valor de ejemplo por variable, en orden. Meta los exige para aprobar. */
  ejemplos: string[]
  /** Encabezado opcional. La plantilla vigente usa "Recordatorio de turno". */
  encabezado?: string
}): DefinicionDeTemplate {
  return {
    name: params.nombre,
    language: params.idioma,
    // Utility y no marketing: es una notificación sobre un turno que el
    // paciente ya tiene. Si Meta lo reclasifica al crearlo, la tarifa cambia —
    // es lo primero que hay que mirar en la respuesta.
    category: "UTILITY",
    components: [
      ...(params.encabezado
        ? [{ type: "HEADER", format: "TEXT", text: params.encabezado }]
        : []),
      {
        type: "BODY",
        text: params.cuerpo,
        example: { body_text: [params.ejemplos] },
      },
      {
        type: "BUTTONS",
        // Los tres son quick reply. Sin mezclar tipos de botón, el template se
        // ve también en WhatsApp Desktop — la restricción de Meta que lo
        // obligaba al teléfono aplica sólo cuando se combina un quick reply con
        // un botón de otro tipo (por ejemplo, uno de Flow).
        buttons: [
          { type: "QUICK_REPLY", text: BOTON_CONFIRMAR },
          { type: "QUICK_REPLY", text: BOTON_CANCELAR },
          { type: "QUICK_REPLY", text: BOTON_REAGENDAR },
        ],
      },
    ],
  }
}

// ─── Reescritura del envío (en cada recordatorio) ────────────────────────────

/**
 * Toma el `Body` que mandó la clínica y le agrega los botones.
 *
 * No toca los parámetros del cuerpo: se copian tal cual. Lo único que cambia es
 * el nombre del template y los componentes de botones que se agregan al final.
 *
 * Devuelve null si el payload no tiene la forma esperada. El llamador debe
 * enviar el original en ese caso: un recordatorio sin botones llega igual, uno
 * que no llega es un paciente que no se entera de su turno.
 */
export function agregarBotonesAlEnvio(
  bodyOriginal: unknown,
  params: {
    nombreTemplateFlows: string
  },
): Record<string, any> | null {
  const original = normalizar(bodyOriginal)
  if (!original?.template?.name) return null

  const componentesOriginales: any[] = Array.isArray(original.template.components)
    ? original.template.components
    : []

  // Si ya trae botones, no los duplicamos ni los pisamos: es señal de que la
  // clínica cambió su integración y este módulo dejó de ser necesario.
  const yaTieneBotones = componentesOriginales.some((c) => String(c?.type).toLowerCase() === "button")
  if (yaTieneBotones) return null

  return {
    ...original,
    template: {
      ...original.template,
      name: params.nombreTemplateFlows,
      // Los tres son quick_reply: la plantilla real no lleva botón de Flow.
      // El Flow se manda después, como mensaje aparte, sólo a quien toca
      // "Reprogramar turno" — ver construirMensajeFlow en mensaje-flow.ts.
      //
      // El payload explícito es lo único que aportan estos componentes: sin
      // ellos los botones se muestran igual (son parte de la plantilla
      // aprobada), pero WhatsApp devolvería sólo el título. Rutear por un
      // payload que definimos nosotros es más firme que rutear por un texto
      // que cualquiera puede escribir a mano.
      components: [
        ...componentesOriginales,
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: PAYLOAD_CONFIRMAR }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: PAYLOAD_CANCELAR }] },
        { type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: PAYLOAD_REAGENDAR }] },
      ],
    },
  }
}

function normalizar(body: unknown): any | null {
  if (!body) return null
  if (typeof body === "string") {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  if (typeof body === "object") return body
  return null
}
