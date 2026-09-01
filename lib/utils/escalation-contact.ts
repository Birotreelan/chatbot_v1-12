/**
 * lib/utils/escalation-contact.ts
 *
 * Formatea el "número de derivación" de la clínica (WhatsAppConfig.
 * escalationPhoneNumber) dentro de los mensajes al paciente.
 *
 * 31/8/2026 — pedido de Nicolás: el campo pasó de ser un input de una línea a un
 * textarea, para que la clínica pueda cargar varias líneas con formato (número,
 * horario de atención, un segundo teléfono para urgencias, etc.).
 *
 * El problema que resuelve: hasta ahora el valor se interpolaba SIEMPRE dentro
 * de la frase y entre asteriscos —`contactanos al *${numero}*.`—. Con un valor
 * de varias líneas eso produce un mensaje roto: los asteriscos quedan a tres
 * líneas de distancia (WhatsApp no aplica negrita así) y el punto final cuelga
 * suelto al final del bloque.
 *
 * Regla:
 *   - UNA línea  → exactamente el comportamiento anterior: `al *0800-345-9393*.`
 *     Ninguna clínica que hoy tenga un solo número ve cambiar sus mensajes.
 *   - VARIAS     → la frase se cierra con dos puntos y el contenido va completo
 *     debajo, tal cual lo escribió la clínica (se respetan sus asteriscos,
 *     guiones y saltos: por eso NO se agrega negrita automática en este modo).
 */

/** Texto que se muestra cuando la clínica no cargó ningún dato de contacto. */
export const CONTACTO_DERIVACION_PLACEHOLDER = "[NÚMERO DE DERIVACIÓN]"

/**
 * Separa el valor en líneas, respetando el formato que escribió la clínica.
 *
 * Las líneas en blanco INTERMEDIAS se conservan: son separación de párrafos
 * deliberada y forman parte del mensaje (corregido el 31/8/2026 — la primera
 * versión las descartaba y el texto salía todo apelmazado). Sólo se recortan las
 * líneas vacías del principio y del final, que son ruido de tipeo en el textarea
 * y dejarían un hueco entre la frase y el bloque.
 */
function lineasDeContacto(valor?: string | null): string[] {
  if (!valor) return []

  const lineas = valor.split(/\r?\n/).map((linea) => linea.trim())

  while (lineas.length > 0 && lineas[0] === "") lineas.shift()
  while (lineas.length > 0 && lineas[lineas.length - 1] === "") lineas.pop()

  return lineas
}

/** true si la clínica cargó más de una línea (modo bloque). */
export function esContactoMultilinea(valor?: string | null): boolean {
  return lineasDeContacto(valor).length > 1
}

/**
 * Arma la parte final de una frase de derivación.
 *
 * @param fraseSinContacto  La frase SIN la preposición final ni el contacto.
 *                          Ej: "Para otro tipo de consultas, comunicate"
 * @param valor             Contenido del campo de derivación (1 o N líneas).
 * @param preposicion       Cómo se une la frase con el contacto en el caso de
 *                          una sola línea. Por defecto "al" ("comunicate al *X*").
 *                          Usar "con nosotros al", "a", etc. según la frase.
 *
 * Ejemplos:
 *   frase("Para otras consultas, comunicate", "0800-345-9393")
 *     → "Para otras consultas, comunicate al *0800-345-9393*."
 *
 *   frase("Para otras consultas, comunicate", "0800-345-9393\nLun a Vie 8 a 20")
 *     → "Para otras consultas, comunicate:\n\n0800-345-9393\nLun a Vie 8 a 20"
 */
export function fraseDerivacion(
  fraseSinContacto: string,
  valor?: string | null,
  preposicion: string = "al",
): string {
  const lineas = lineasDeContacto(valor)
  const base = fraseSinContacto.replace(/[\s:.]+$/, "")

  if (lineas.length === 0) {
    // Sin dato cargado: se mantiene el placeholder que ya usaba el sistema, para
    // que sea evidente en el mensaje que falta configurarlo.
    return `${base} ${preposicion} *${CONTACTO_DERIVACION_PLACEHOLDER}*.`
  }

  if (lineas.length === 1) {
    return `${base} ${preposicion} *${lineas[0]}*.`
  }

  return `${base}:\n\n${lineas.join("\n")}`
}

/**
 * Variante para cuando el contacto va SOLO, sin frase que lo introduzca (por
 * ejemplo dentro de un mensaje ya armado que termina en dos puntos).
 *
 * Una línea → `*0800-345-9393*` (igual que antes). Varias → el bloque tal cual.
 */
export function contactoDerivacion(valor?: string | null): string {
  const lineas = lineasDeContacto(valor)
  if (lineas.length === 0) return `*${CONTACTO_DERIVACION_PLACEHOLDER}*`
  if (lineas.length === 1) return `*${lineas[0]}*`
  return lineas.join("\n")
}

/**
 * Versión de una sola línea, para los lugares donde el contacto DEBE ir
 * embebido en medio de una oración y no se puede abrir un bloque (por ejemplo,
 * dentro de un prompt para el LLM o en un texto de botón). Une las líneas con
 * " | " para no romper el renglón.
 */
export function contactoDerivacionEnLinea(valor?: string | null): string {
  // Acá sí se descartan las líneas en blanco: el objetivo es que todo entre en
  // un renglón, así que un separador vacío ("A |  | B") sólo agregaría ruido.
  const lineas = lineasDeContacto(valor).filter((linea) => linea.length > 0)
  if (lineas.length === 0) return CONTACTO_DERIVACION_PLACEHOLDER
  return lineas.join(" | ")
}
