/**
 * Las barandas de la redacción (25/11/2026).
 *
 * ── Qué son, y por qué son código y no instrucciones del prompt ───────────
 *
 * El plan lo dice en una línea: "Las reglas que no se negocian no son
 * instrucciones en un prompt, son código que corre después". Un prompt pide; el
 * código verifica. La diferencia aparece el día que el modelo no hace caso, y
 * ese día llega: no inventar un horario es una regla que, incumplida una vez de
 * cada mil, le hace perder el turno a un paciente.
 *
 * Todas las funciones de este archivo son puras y se prueban sin red. Eso es
 * deliberado: son el único punto del sistema donde se decide si un texto
 * generado sale o no sale, y tienen que poder revisarse sin levantar nada.
 *
 * ── El principio: el texto determinístico es la verdad ────────────────────
 *
 * La redacción no agrega información, sólo la dice mejor. Así que casi todas
 * las barandas tienen la misma forma: comparar el texto nuevo contra el
 * original y rechazar lo que APARECIÓ. No hace falta saber si "el martes 25 a
 * las 10:30" es correcto; alcanza con saber que estaba en el original.
 *
 * Es una verificación más fuerte de lo que parece, porque todo lo que un modelo
 * puede inventar que le haga daño a un paciente —una fecha, una hora, un
 * teléfono, un precio, una indicación— llega en forma de dato nuevo.
 *
 * ── Y ante la duda, sale el original ──────────────────────────────────────
 *
 * Cada baranda que se dispara devuelve el motivo y el llamador manda el texto
 * de siempre. El peor caso de esta capa es el comportamiento de hoy, que es
 * exactamente la propiedad que permite encenderla en producción.
 */

export interface Veredicto {
  aprobado: boolean
  /** Qué baranda se disparó. Va al log, nunca al paciente. */
  motivo?: string
}

const APROBADO: Veredicto = { aprobado: true }

// ── Separar la prosa del menú ─────────────────────────────────────────────

/**
 * Una línea de menú: el número de opción, un separador, y texto.
 *
 * Es el mismo criterio que `etiquetas-menu.ts` usa para personalizar la
 * etiqueta, y no es casual: los menús del proyecto se escriben todos así.
 */
const LINEA_DE_MENU = /^[ \t]*\d{1,2}[.\-)][ \t]+\S/

export interface Partes {
  /** Lo que la IA puede reescribir. */
  prosa: string
  /** Desde la primera línea de menú hasta el final. Se reenvía TAL CUAL. */
  menu: string
}

/**
 * Parte el mensaje en prosa y menú.
 *
 * ── Por qué el menú no se reescribe NUNCA ─────────────────────────────────
 *
 * Porque el número que el paciente responde se interpreta con un action map
 * que está escrito aparte. Si la redacción renumera, reordena o renombra una
 * opción, el paciente contesta "2" creyendo una cosa y el sistema ejecuta otra.
 * Es el caso Liliana (9/7/2026), que ya pasó una vez con el menú y el action map
 * desincronizados, y que no hace falta repetir con un modelo en el medio.
 *
 * Se corta en la PRIMERA línea numerada y todo lo que sigue va intacto,
 * incluido el pie ("Respondé con el número…"): forma parte de las
 * instrucciones de uso del menú, no de la conversación.
 */
export function separarMenu(texto: string): Partes {
  const lineas = (texto || "").split("\n")
  const primera = lineas.findIndex((linea) => LINEA_DE_MENU.test(linea))
  if (primera === -1) return { prosa: texto || "", menu: "" }
  return {
    prosa: lineas.slice(0, primera).join("\n").trimEnd(),
    menu: lineas.slice(primera).join("\n"),
  }
}

// ── Las barandas ──────────────────────────────────────────────────────────

/**
 * Los números, normalizados para comparar.
 *
 * Se les saca el cero de adelante porque "09:30" y "9:30" son el mismo horario
 * escrito de dos formas, y rechazar la segunda sería rechazar una redacción
 * correcta. Lo que se busca es un número que no existía, no un formato nuevo.
 */
function numeros(texto: string): string[] {
  return ((texto || "").match(/\d+/g) || []).map((n) => n.replace(/^0+(?=\d)/, ""))
}

/**
 * Ningún número nuevo.
 *
 * La baranda más importante de todas, y la que justifica la capa entera: una
 * fecha, una hora, un teléfono, un precio, un número de documento y un número
 * de opción son todos números. Si el texto nuevo no tiene ninguno que el
 * original no tuviera, no inventó ninguno de los datos que pueden hacer daño.
 */
export function sinNumerosNuevos(original: string, nuevo: string): Veredicto {
  const delOriginal = new Set(numeros(original))
  const nuevos = numeros(nuevo).filter((n) => !delOriginal.has(n))
  if (nuevos.length === 0) return APROBADO
  return { aprobado: false, motivo: `inventó números que no estaban: ${nuevos.join(", ")}` }
}

/**
 * Un año, que es el único número que la redacción puede tirar.
 *
 * "el jueves, 26 de noviembre de 2026 a las 14:00" escrito como "el jueves 26
 * de noviembre a las 14:00" es mejor redacción y no pierde nada: el año no le
 * dice al paciente nada que no sepa. Cualquier otro número sí.
 */
function esAnio(numero: string): boolean {
  const n = Number(numero)
  return n >= 2020 && n <= 2039
}

/**
 * Ningún dato perdido.
 *
 * La contracara de `sinNumerosNuevos`, y hace falta tanto como ella: un texto
 * que dice "Lucrecia, ¿en qué te puedo ayudar?" en lugar de "tenés turno el
 * jueves 26 a las 14:00" no inventa nada, no pierde ningún enlace y no se mete
 * con ningún tema — pasaría todas las demás barandas y le habría borrado al
 * paciente la única información del mensaje.
 *
 * Es el error más probable de los dos, además: a un modelo al que se le pide
 * "más corto y más natural" le sale antes resumir de más que inventar.
 */
export function sinDatosPerdidos(original: string, nuevo: string): Veredicto {
  const delNuevo = new Set(numeros(nuevo))
  const perdidos = numeros(original).filter((n) => !esAnio(n) && !delNuevo.has(n))
  if (perdidos.length === 0) return APROBADO
  return { aprobado: false, motivo: `perdió datos del original: ${[...new Set(perdidos)].join(", ")}` }
}

function urls(texto: string): string[] {
  return ((texto || "").match(/https?:\/\/\S+/g) || []).map((u) => u.replace(/[.,;)]+$/, ""))
}

/**
 * Los enlaces, los mismos y ninguno más.
 *
 * En los dos sentidos. Un enlace inventado es obvio; uno PERDIDO es peor y más
 * fácil de que pase: el mensaje que deriva al portal sin el enlace deja al
 * paciente leyendo "entrá por acá" sin ningún "acá", y la conversación termina
 * sin que nada falle.
 */
export function conLosMismosEnlaces(original: string, nuevo: string): Veredicto {
  const a = urls(original)
  const b = urls(nuevo)
  const faltan = a.filter((u) => !b.includes(u))
  const sobran = b.filter((u) => !a.includes(u))
  if (faltan.length === 0 && sobran.length === 0) return APROBADO
  return {
    aprobado: false,
    motivo: faltan.length ? `perdió el enlace ${faltan[0]}` : `inventó el enlace ${sobran[0]}`,
  }
}

/**
 * Un solo mensaje.
 *
 * El plan lo pone entre las barandas y aclara por qué no es una preferencia de
 * estilo: cada mensaje que sale cuesta US$ 0,0318 y se factura por unidad. Un
 * modelo al que se le pide "escribí esto mejor" tiende a cerrar con una
 * pregunta de cortesía, y en WhatsApp cada vuelta de cortesía es plata.
 *
 * Tampoco se le deja alargar el mensaje sin control: un paciente mayor leyendo
 * en un teléfono abandona un bloque de texto largo, así que el límite protege
 * la conversación además del costo.
 */
export function conLargoRazonable(original: string, nuevo: string): Veredicto {
  const limite = Math.max(Math.round((original || "").length * 1.6), (original || "").length + 160)
  if (nuevo.length > limite) {
    return { aprobado: false, motivo: `se pasó de largo: ${nuevo.length} caracteres contra ${limite}` }
  }
  if (nuevo.trim().length === 0) return { aprobado: false, motivo: "devolvió un texto vacío" }
  // Separadores de "mensaje nuevo": el modelo a veces los usa para dar dos
  // respuestas. Lo que se manda es un mensaje, no una conversación.
  if (/\n\s*(---+|===+|\*\*\*+)\s*\n/.test(nuevo)) {
    return { aprobado: false, motivo: "partió la respuesta en dos con un separador" }
  }
  return APROBADO
}

/**
 * Las palabras que sólo puede decir la clínica.
 *
 * No es un filtro de lenguaje médico: es la lista corta de temas que el
 * diagnóstico marcó como la pregunta práctica de la víspera —gotas, ayuno,
 * medicación— y que el bot hoy no contesta a propósito, porque la respuesta
 * depende de cada paciente y de cada cirugía.
 *
 * La prueba es la misma que el resto: si la palabra ya estaba en el original,
 * pasa —el mensaje determinístico ya decidió hablar de eso—. Si apareció en la
 * redacción, el modelo se metió solo en un tema que no le corresponde.
 */
const TEMAS_DE_LA_CLINICA = [
  "gotas",
  "ayuno",
  "ayunas",
  "medicacion",
  "medicación",
  "dosis",
  "anestesia",
  "colirio",
  "mg",
]

function sinAcentos(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

export function sinIndicacionesPropias(original: string, nuevo: string): Veredicto {
  const antes = sinAcentos(original)
  const despues = sinAcentos(nuevo)
  for (const tema of TEMAS_DE_LA_CLINICA) {
    const palabra = sinAcentos(tema)
    const regex = new RegExp(`\\b${palabra}\\b`)
    if (regex.test(despues) && !regex.test(antes)) {
      return { aprobado: false, motivo: `se metió con «${tema}», que no estaba en el mensaje original` }
    }
  }
  return APROBADO
}

/**
 * Todas las barandas, en orden.
 *
 * El orden no cambia el resultado —si una falla, el texto no sale— pero sí lo
 * que dice el log, y para eso conviene que lo primero que se reporte sea lo más
 * grave. Un número inventado es peor que un mensaje largo.
 */
export function revisarRedaccion(original: string, nuevo: string): Veredicto {
  for (const baranda of [
    sinNumerosNuevos,
    sinDatosPerdidos,
    conLosMismosEnlaces,
    sinIndicacionesPropias,
    conLargoRazonable,
  ]) {
    const veredicto = baranda(original, nuevo)
    if (!veredicto.aprobado) return veredicto
  }
  return APROBADO
}
