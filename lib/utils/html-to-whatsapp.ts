/**
 * html-to-whatsapp.ts
 *
 * WhatsApp Cloud API no interpreta HTML en el body de los mensajes de texto:
 * envía el string tal cual (ver lib/whatsapp-api.ts, sendWhatsAppMessage).
 * Solo soporta un subset de markdown propio: *negrita*, _itálica_, ~tachado~
 * y saltos de línea con \n.
 *
 * Este helper convierte HTML básico (el que llega en campos como
 * "indicaciones_deudor": "<p>...<strong>...</strong></p>\r\n<p>...</p>")
 * a texto plano formateado para WhatsApp.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&nbsp;": " ",
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
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
}

function decodeHtmlEntities(text: string): string {
  let result = text
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char)
  }
  // Entidades numéricas genéricas (&#123; / &#x7B;)
  result = result.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
  return result
}

/**
 * Convierte HTML básico (<p>, <strong>/<b>, <em>/<i>, <br>) a texto plano
 * con formato WhatsApp (*negrita*, _itálica_) y saltos de línea.
 */
export function htmlToWhatsAppText(html: string): string {
  if (!html) return ""

  let text = html

  // Normalizar saltos de línea crudos (\r\n) que a veces vienen sueltos entre tags
  text = text.replace(/\r\n/g, "\n")

  // Negrita: <strong>...</strong> y <b>...</b> → *...*
  text = text.replace(/<(strong|b)>/gi, "*").replace(/<\/(strong|b)>/gi, "*")

  // Itálica: <em>...</em> y <i>...</i> → _..._
  text = text.replace(/<(em|i)>/gi, "_").replace(/<\/(em|i)>/gi, "_")

  // Saltos de línea explícitos
  text = text.replace(/<br\s*\/?>/gi, "\n")

  // Párrafos: cierre de <p> agrega separación entre párrafos, apertura se descarta
  text = text.replace(/<\/p>/gi, "\n\n").replace(/<p[^>]*>/gi, "")

  // Listas simples, por si aparecen
  text = text.replace(/<li[^>]*>/gi, "- ").replace(/<\/li>/gi, "\n")
  text = text.replace(/<\/?(ul|ol)>/gi, "\n")

  // Cualquier tag residual no contemplado se elimina
  text = text.replace(/<[^>]+>/g, "")

  // Decodificar entidades HTML
  text = decodeHtmlEntities(text)

  // Colapsar espacios/saltos de línea excesivos
  text = text.replace(/[ \t]+\n/g, "\n")
  text = text.replace(/\n{3,}/g, "\n\n")
  text = text.trim()

  return text
}
