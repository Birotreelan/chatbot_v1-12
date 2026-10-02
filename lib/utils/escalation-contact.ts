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

/**
 * Las mismas líneas, para pantallas HTML (1/10/2026).
 *
 * El portal muestra el mismo bloque de teléfonos que el bot, pero el bot
 * escribe para WhatsApp: ahí `*0800*` es negrita y en una página web son dos
 * asteriscos a la vista. Por eso se quitan acá y la negrita, si hace falta, la
 * pone el componente con sus propias clases.
 *
 * Se descartan las líneas vacías: en WhatsApp separan párrafos, en HTML el
 * espaciado lo da el contenedor.
 */
export function lineasDeContactoParaWeb(valor?: string | null): string[] {
  return lineasDeContacto(valor)
    .map((linea) => linea.replace(/\*/g, "").trim())
    .filter((linea) => linea.length > 0)
}

/**
 * ¿Este mensaje lleva los datos de contacto de la clínica? (2/10/2026)
 *
 * Reportado por Nicolás: a un paciente de PAMI SO le mandamos los seis
 * teléfonos de las sedes en el saludo y, cuando volvió a escribir —"solo
 * preciso gotas para la vista"—, se los mandamos enteros otra vez. El segundo
 * envío no le agrega nada: ya los tiene, dos mensajes más arriba.
 *
 * La pregunta se contesta mirando el texto y no etiquetando cada rama a mano.
 * El bloque aparece hoy en cinco lugares —el saludo con obra social bloqueada,
 * la derivación por consulta médica, "otra consulta", la obra social no
 * habilitada y la derivación externa— y la sexta que se agregue mañana se
 * olvidaría de la etiqueta. Esto la cubre sola.
 *
 * Se exige coincidencia de una línea COMPLETA del contacto configurado, no de
 * un número suelto: un mensaje que menciona un teléfono al pasar no es una
 * derivación, y callarlo sería callar de más.
 *
 * Con el contacto sin cargar devuelve `false`: no hay bloque que repetir, y el
 * placeholder no identifica a nadie.
 */
export function llevaDatosDeContacto(mensaje: string, valor?: string | null): boolean {
  if (!mensaje) return false

  const lineas = lineasDeContacto(valor)
  if (lineas.length === 0) return false

  // Se compara por DÍGITOS y no por texto. Un mismo teléfono viaja de formas
  // distintas según por dónde salga —"*0800-345-9393*" en una frase,
  // "📞 0800-345-9393" dentro del bloque, con o sin guiones— y comparar
  // cadenas obligaba a que coincidieran los adornos. Los dígitos son lo único
  // que no cambia.
  const soloDigitos = (texto: string) => texto.replace(/\D/g, "")
  const digitosDelMensaje = soloDigitos(mensaje)

  // 7 dígitos: un teléfono. Menos que eso es una hora, un número de turno o un
  // año, y callar por eso sería callar de más.
  const numeros = lineas
    .map(soloDigitos)
    .filter((n) => n.length >= 7)

  if (numeros.length === 0) return false

  return numeros.some((n) => digitosDelMensaje.includes(n))
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
