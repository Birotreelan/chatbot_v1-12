/**
 * Etiqueta de "Realizar otra consulta" personalizada por cliente (22/9/2026).
 *
 * ── Por qué en el embudo y no en cada menú ─────────────────────────────────
 *
 * El texto "Realizar otra consulta" está escrito literal en unos VEINTE lugares
 * de patient-templates.ts, más seis en el detector de opciones y cuatro en los
 * botones. Son variantes del mismo menú: paciente nuevo, paciente sin turnos,
 * con un turno, con varios, sólo cirugías, obra social bloqueada, y cada una
 * con su numeración.
 *
 * Agregarle un `if` por cliente a cada uno es pedir que vuelva el caso Liliana
 * (9/7/2026): el menú y el action map se desincronizaron y el número que
 * respondía la paciente ejecutaba otra acción.
 *
 * Así que se resuelve donde ya resolvieron el mismo problema con la
 * presentación de IA: en `sendDirectResponse`, el embudo por el que salen todas
 * las respuestas. Ninguna rama puede olvidarse, y las que se agreguen mañana
 * quedan cubiertas sin hacer nada.
 *
 * ── Por qué sólo reemplaza líneas numeradas ────────────────────────────────
 *
 * La frase aparece también en prompts y comentarios. El reemplazo exige que la
 * línea EMPIECE con el número de opción y termine ahí: "3- Realizar otra
 * consulta". Nada más se toca.
 *
 * ── Por qué no se renumera nada ────────────────────────────────────────────
 *
 * Es un cambio de etiqueta, no una opción nueva. La opción 3 sigue siendo la 3
 * y sigue ejecutando `other_inquiry_intent`. El action map ni se entera — que es
 * exactamente lo que lo hace seguro.
 */

/** El texto por defecto, el que hoy está escrito en los menús. */
export const ETIQUETA_OTRA_CONSULTA = "Realizar otra consulta"

/** El título por defecto del botón correspondiente. */
export const BOTON_OTRA_CONSULTA = "Otra consulta"

/** Tope de WhatsApp para el título de un botón de respuesta rápida. */
export const LIMITE_TITULO_BOTON = 20

/**
 * La línea de menú, tal como la escriben los templates: el número de opción,
 * un separador, y la etiqueta sola hasta el fin de línea.
 *
 * `\r?` porque algún template podría traer saltos de Windows, y sin eso la
 * línea no matchearía y el cliente vería la etiqueta vieja sin entender por qué.
 */
const LINEA_DE_MENU = /^([ \t]*\d{1,2}[.\-)][ \t]*)Realizar otra consulta[ \t]*(\r?)$/gm

/** ¿Vale la pena leer la configuración? Evita una lectura por cada mensaje. */
export function mencionaOtraConsulta(mensaje: string): boolean {
  return typeof mensaje === "string" && mensaje.includes(ETIQUETA_OTRA_CONSULTA)
}

/**
 * Reemplaza la etiqueta en las líneas numeradas del menú.
 *
 * Sin etiqueta propia devuelve el mensaje intacto, que es el caso de todos los
 * clientes menos el que la configuró.
 */
export function personalizarMenu(mensaje: string, etiqueta?: string | null): string {
  const propia = (etiqueta || "").trim()
  if (!propia || !mensaje) return mensaje
  if (propia === ETIQUETA_OTRA_CONSULTA) return mensaje

  return mensaje.replace(LINEA_DE_MENU, (_m, prefijo, finDeLinea) => `${prefijo}${propia}${finDeLinea}`)
}

/**
 * Título del botón, acotado al límite de WhatsApp.
 *
 * Pasarse no trunca: WhatsApp rechaza el mensaje interactivo entero y el
 * paciente se queda sin botones. Preferimos un título con puntos suspensivos.
 *
 * Es un campo aparte del texto del menú a propósito: "Realizar otra consulta o
 * solicitar turno de estudios" son 51 caracteres y en un botón no entra. La
 * línea del menú puede ser larga; el botón no.
 */
export function tituloBotonOtraConsulta(titulo?: string | null): string {
  const propio = (titulo || "").trim()
  if (!propio) return BOTON_OTRA_CONSULTA
  if (propio.length <= LIMITE_TITULO_BOTON) return propio
  return propio.slice(0, LIMITE_TITULO_BOTON - 1).trimEnd() + "…"
}

/**
 * Reemplaza el título en la lista de botones que va a salir.
 *
 * Se compara contra el título por defecto porque es lo que arman los builders;
 * los demás botones no se tocan.
 */
export function personalizarBotones(
  botones: Array<{ id: string; title: string }> | undefined,
  titulo?: string | null,
): Array<{ id: string; title: string }> | undefined {
  if (!botones?.length) return botones
  const propio = tituloBotonOtraConsulta(titulo)
  if (propio === BOTON_OTRA_CONSULTA) return botones

  return botones.map((b) => (b.title === BOTON_OTRA_CONSULTA ? { ...b, title: propio } : b))
}

/**
 * ¿Este título de botón es el de "otra consulta"?
 *
 * Acepta el propio Y el por defecto, y no es una concesión: un menú enviado
 * ayer sigue en el chat del paciente con los botones viejos. Si sólo
 * reconociéramos el nuevo, tocar ese botón dejaría de interrumpir el sub-flujo
 * activo y el paciente quedaría atrapado donde estaba.
 */
export function esBotonOtraConsulta(titulo: string, propio?: string | null): boolean {
  const normalizado = (titulo || "").toLowerCase().trim()
  if (!normalizado) return false
  if (normalizado === BOTON_OTRA_CONSULTA.toLowerCase()) return true

  const custom = tituloBotonOtraConsulta(propio)
  return custom !== BOTON_OTRA_CONSULTA && normalizado === custom.toLowerCase()
}
