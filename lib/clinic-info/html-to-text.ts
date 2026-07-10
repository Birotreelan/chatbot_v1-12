/**
 * Conversión de HTML a texto plano, sin dependencias nuevas (10/7/2026).
 *
 * No usa un parser DOM real (cheerio/jsdom no están instalados en el
 * proyecto) — para el caso de uso (extraer el contenido legible de una
 * página institucional) alcanza con una limpieza basada en regex: sacar
 * script/style/nav/header/footer (ruido que no queremos que la IA cite),
 * despues sacar el resto de las etiquetas y decodificar entidades HTML.
 *
 * No pretende ser un parser HTML completo ni manejar sitios con contenido
 * armado 100% por JS del lado del cliente (ahí no hay nada que extraer sin
 * un navegador headless) — para esos casos el resultado va a venir vacío o
 * muy pobre, y la carga manual sigue siendo la opción de respaldo.
 */

// Tags cuyo contenido completo se descarta (no solo la etiqueta) porque casi
// nunca aporta información institucional real.
const STRIP_TAGS_WITH_CONTENT = ["script", "style", "noscript", "svg", "nav", "header", "footer", "form", "iframe"]

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&aacute;": "á",
  "&eacute;": "é",
  "&iacute;": "í",
  "&oacute;": "ó",
  "&uacute;": "ú",
  "&ntilde;": "ñ",
  "&Aacute;": "Á",
  "&Eacute;": "É",
  "&Iacute;": "Í",
  "&Oacute;": "Ó",
  "&Uacute;": "Ú",
  "&Ntilde;": "Ñ",
}

function decodeEntities(text: string): string {
  let result = text
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char)
  }
  // Entidades numéricas (&#123; / &#x7B;)
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
  return result
}

/**
 * Extrae el texto legible de un documento HTML: saca comentarios y las
 * etiquetas de "ruido" (con su contenido), después saca el resto de las
 * etiquetas dejando el texto, decodifica entidades y colapsa espacios.
 */
export function extractMainText(html: string): string {
  let cleaned = html

  // Comentarios HTML
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, " ")

  // Etiquetas cuyo contenido se descarta por completo
  for (const tag of STRIP_TAGS_WITH_CONTENT) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi")
    cleaned = cleaned.replace(regex, " ")
  }

  // Saltos de línea legibles antes de sacar el resto de las etiquetas de bloque
  cleaned = cleaned.replace(/<\/(p|div|section|article|li|h[1-6]|br|tr)>/gi, "\n")
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n")

  // Resto de las etiquetas: sacar sólo la etiqueta, conservar el texto interno
  cleaned = cleaned.replace(/<[^>]+>/g, " ")

  cleaned = decodeEntities(cleaned)

  // Colapsar espacios/líneas en blanco excesivas
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")

  return cleaned.trim()
}

/** Título de la página (tag &lt;title&gt;), si existe — útil como referencia. */
export function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeEntities(match[1]).trim() : undefined
}
