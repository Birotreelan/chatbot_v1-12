/**
 * El saludo de bienvenida, escrito por cada clínica (25/11/2026).
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────────
 *
 * Hoy el saludo se arma solo con el nombre de la clínica, en cuatro formas
 * según quién escribe:
 *
 *     *¡Bienvenido a Salud Ocular!*
 *     *Elizabeth, ¡bienvenido de nuevo a Salud Ocular!*
 *     *¡Hola, Elizabeth!*
 *     *¡Hola!*
 *
 * Las dos primeras están escritas literal en siete lugares de
 * patient-templates.ts y las dos últimas las arma `presentacion-inicial.ts`.
 *
 * ── Por qué en el embudo y no en cada template ────────────────────────────
 *
 * Es la misma decisión que `etiquetas-menu.ts`, por el mismo motivo y con la
 * misma evidencia: agregarle un `if` por cliente a cada uno de los siete
 * lugares es pedir que vuelva el caso Liliana, donde dos copias de la misma
 * cosa se desincronizaron. Se resuelve en `sendDirectResponse`, por donde salen
 * todas las respuestas: ninguna rama puede olvidarse y las que se agreguen
 * mañana quedan cubiertas sin hacer nada.
 *
 * ── Qué NO se toca ────────────────────────────────────────────────────────
 *
 * La línea "Soy Iris, tu asistente virtual de inteligencia artificial", que va
 * aparte y después del saludo. No es cortesía: es la identificación como IA, la
 * guarda que evita duplicarla la busca literal, y una clínica que la reescribe
 * —o la borra— deja al paciente sin saber con qué está hablando.
 *
 * Por eso el campo reemplaza el SALUDO y no el bloque entero. Si una clínica
 * quiere decir "Hola, soy Marta del equipo de Salud Ocular", eso no es un
 * saludo propio: es pedir que el bot se presente como una persona, y no es algo
 * que se resuelva con un campo de texto.
 */

/**
 * Las cuatro formas del saludo generado, al principio del mensaje.
 *
 * ── Por qué una sola expresión y no cuatro ────────────────────────────────
 *
 * Porque lo que hay que garantizar es que se reemplace UNA, la que esté, y
 * aplicar cuatro reemplazos en fila abre la puerta a que el segundo toque el
 * resultado del primero.
 *
 * Exige que el saludo esté al PRINCIPIO y entre asteriscos, que es como lo
 * escriben los templates. La frase "bienvenido" sueltaen medio de un mensaje no
 * se toca: puede ser parte de una explicación.
 *
 * El nombre se captura para poder usarlo en el texto propio: sale de la misma
 * línea que se está reemplazando, así que no hace falta que el embudo sepa
 * quién es el paciente.
 */
const SALUDO_GENERADO =
  /^\*(?:¡?Bienvenido a [^!*\n]+!|([^,*\n]{1,40}), ¡?bienvenido de nuevo a [^!*\n]+!|¡?Hola, ([^!*\n]{1,40})!|¡?Hola!)\*/

/** ¿Vale la pena leer la configuración? Evita una lectura por cada mensaje. */
export function empiezaConSaludo(mensaje: string): boolean {
  return typeof mensaje === "string" && SALUDO_GENERADO.test(mensaje)
}

/**
 * Reemplaza los marcadores del texto que escribió la clínica.
 *
 * `{nombre}` y `{clinica}`. Cuando no hay nombre —el saludo al paciente que
 * todavía no se identificó— el marcador se saca y se limpia la puntuación que
 * queda huérfana: sin eso, "Hola {nombre}, ¿en qué te ayudo?" sale como "Hola ,
 * ¿en qué te ayudo?", que es peor que el saludo genérico.
 */
export function resolverMarcadores(
  texto: string,
  datos: { nombre?: string | null; clinica?: string | null },
): string {
  const nombre = (datos.nombre || "").trim()
  const clinica = (datos.clinica || "").trim()

  let resultado = texto.replace(/\{clinica\}/gi, clinica)

  if (nombre) {
    return resultado.replace(/\{nombre\}/gi, nombre)
  }

  /**
   * ── Sacar el nombre sin dejar la puntuación huérfana ────────────────────
   *
   * Las tres posiciones en que alguien va a escribir el marcador necesitan
   * tratos distintos, y la diferencia se ve en la coma:
   *
   *   "¡Hola, {nombre}!"        → "¡Hola!"      la coma es del vocativo, se va
   *   "Hola {nombre}, ¿qué tal?" → "Hola, ¿qué tal?"  la coma cierra la frase, queda
   *   "{nombre}, gracias…"       → "Gracias…"    se va con su coma, y lo que
   *                                              sigue pasa a abrir la oración
   *
   * Hacerlo con una sola regla deja "Hola ¿qué tal?" o "gracias" en minúscula,
   * que es la clase de detalle por el que un saludo escrito con cuidado parece
   * descuidado.
   */
  resultado = resultado
    // La coma ANTES del marcador es del vocativo: se va con él.
    .replace(/,\s*\{nombre\}/gi, "")
    // Al principio de la frase, con su coma.
    .replace(/^([*¡¿\s]*)\{nombre\}\s*,\s*/i, "$1")
    // En cualquier otra posición: el marcador y el espacio que lo precede.
    .replace(/[ \t]*\{nombre\}/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([!?.,;:])/g, "$1")
    // Ningún saludo empieza con una coma: la deja el marcador escrito dos veces
    // seguidas, que no debería pasar pero no tiene por qué salir así al chat.
    .replace(/^[\s,;:]+/, "")
    .trim()

  // Lo que quedó abriendo la oración va en mayúscula.
  const primeraLetra = resultado.search(/\p{L}/u)
  if (primeraLetra >= 0) {
    resultado =
      resultado.slice(0, primeraLetra) +
      resultado.charAt(primeraLetra).toUpperCase() +
      resultado.slice(primeraLetra + 1)
  }

  return resultado
}

/**
 * Pone el saludo de la clínica en lugar del generado.
 *
 * Sin saludo propio devuelve el mensaje intacto, que es el caso de todos los
 * clientes menos los que lo configuren.
 */
export function personalizarSaludo(
  mensaje: string,
  saludoPropio?: string | null,
  clinica?: string | null,
): string {
  const propio = (saludoPropio || "").trim()
  if (!propio || !mensaje) return mensaje

  const coincidencia = mensaje.match(SALUDO_GENERADO)
  if (!coincidencia) return mensaje

  // El nombre viene de cualquiera de las dos formas que lo traen.
  const nombre = coincidencia[1] || coincidencia[2] || ""
  const resuelto = resolverMarcadores(propio, { nombre, clinica })
  if (!resuelto.trim()) return mensaje

  return resuelto + mensaje.slice(coincidencia[0].length)
}
