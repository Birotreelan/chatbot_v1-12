/**
 * Scraper de sitios institucionales (10/7/2026) — primera versión.
 *
 * Alcance deliberadamente acotado (ver asesoría previa a este desarrollo):
 * una sola URL por importación, fetch simple del lado del servidor (sin
 * navegador headless). Cubre sitios estáticos/renderizados en el servidor
 * (WordPress, Wix, Squarespace en su mayoría) — sitios armados 100% con JS
 * del lado del cliente van a devolver poco o nada de contenido útil; para
 * esos casos la carga manual sigue siendo la vía. Si esto se vuelve un
 * problema frecuente, la mejora natural es delegar el fetch a un servicio de
 * terceros pensado para esto (ej. Firecrawl, Jina Reader) en vez de construir
 * y mantener un navegador headless acá.
 */

import { extractMainText, extractTitle } from "./html-to-text"

const FETCH_TIMEOUT_MS = 15000
const MAX_HTML_BYTES = 3_000_000 // 3MB — de sobra para una página institucional
const MAX_TEXT_CHARS = 20_000 // tope para no mandar textos gigantes a la extracción por IA

export interface ScrapeResult {
  url: string
  title?: string
  text: string
}

export class ScrapeError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_url" | "fetch_failed" | "not_html" | "empty_content",
  ) {
    super(message)
    this.name = "ScrapeError"
  }
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}

export async function scrapeUrl(rawUrl: string): Promise<ScrapeResult> {
  let url: URL
  try {
    url = new URL(normalizeUrl(rawUrl))
  } catch {
    throw new ScrapeError(`URL inválida: ${rawUrl}`, "invalid_url")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError(`Protocolo no soportado: ${url.protocol}`, "invalid_url")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Algunos sitios bloquean requests sin User-Agent de navegador.
        "User-Agent":
          "Mozilla/5.0 (compatible; IrisClinicInfoBot/1.0; +https://iris-chatbot.example/bot-info)",
        Accept: "text/html,application/xhtml+xml",
      },
    })
  } catch (error) {
    throw new ScrapeError(
      `No se pudo acceder a la URL (${error instanceof Error ? error.message : "error de red"})`,
      "fetch_failed",
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new ScrapeError(`El sitio respondió con estado ${response.status}`, "fetch_failed")
  }

  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new ScrapeError(`El contenido no es HTML (content-type: ${contentType || "desconocido"})`, "not_html")
  }

  const contentLength = Number(response.headers.get("content-length") || 0)
  if (contentLength && contentLength > MAX_HTML_BYTES) {
    throw new ScrapeError("La página es demasiado grande para procesar", "fetch_failed")
  }

  const html = await response.text()
  const title = extractTitle(html)
  let text = extractMainText(html)

  if (!text || text.length < 30) {
    throw new ScrapeError(
      "No se encontró contenido legible en la página (puede ser un sitio armado con JavaScript del lado del cliente)",
      "empty_content",
    )
  }

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS)
  }

  return { url: url.toString(), title, text }
}
