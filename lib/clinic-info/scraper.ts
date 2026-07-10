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
 *
 * Nota sobre diagnóstico (10/7/2026): el fetch de Node/undici, cuando falla a
 * bajo nivel (DNS, TLS, conexión rechazada, timeout), tira SIEMPRE el mismo
 * mensaje genérico "fetch failed" en `error.message` — la razón real vive en
 * `error.cause` (ej. `{ code: "ENOTFOUND" }`). Por eso acá se desarma esa
 * cadena de causas y se logea completa, además de traducir los códigos más
 * comunes a un mensaje entendible en vez de repetir "fetch failed" a secas.
 */

import { logger } from "@/lib/logger"
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

/** Códigos de bajo nivel más comunes (Node/undici) traducidos a algo legible. */
const CAUSE_CODE_MESSAGES: Record<string, string> = {
  ENOTFOUND: "no se pudo resolver el dominio (¿la URL está bien escrita?)",
  ECONNREFUSED: "el servidor rechazó la conexión",
  ECONNRESET: "la conexión se cortó del otro lado",
  ETIMEDOUT: "se agotó el tiempo de espera de la conexión",
  UND_ERR_CONNECT_TIMEOUT: "se agotó el tiempo de espera de la conexión",
  CERT_HAS_EXPIRED: "el certificado SSL del sitio está vencido",
  DEPTH_ZERO_SELF_SIGNED_CERT: "el sitio usa un certificado SSL autofirmado/no confiable",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "no se pudo verificar el certificado SSL del sitio",
  EAI_AGAIN: "error temporal de DNS, probá de nuevo en unos segundos",
}

/**
 * Recorre `error.cause` (que en Node puede venir anidado varias veces) y
 * arma tanto un mensaje legible para el admin como el detalle completo para
 * los logs.
 */
function describeFetchError(error: unknown): { humanMessage: string; logDetail: Record<string, unknown> } {
  const chain: Array<{ name?: string; message?: string; code?: string }> = []
  let current: any = error
  let depth = 0
  while (current && depth < 5) {
    chain.push({ name: current.name, message: current.message, code: current.code })
    current = current.cause
    depth++
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      humanMessage: `la página tardó más de ${FETCH_TIMEOUT_MS / 1000}s en responder`,
      logDetail: { chain },
    }
  }

  const codeWithMessage = chain.find((c) => c.code && CAUSE_CODE_MESSAGES[c.code])
  if (codeWithMessage?.code) {
    return { humanMessage: CAUSE_CODE_MESSAGES[codeWithMessage.code], logDetail: { chain } }
  }

  // Ningún código conocido — usar el mensaje más específico disponible (el
  // de más adentro en la cadena de causas suele ser el más útil).
  const deepest = chain[chain.length - 1]
  const fallbackMessage = deepest?.message || (error instanceof Error ? error.message : "error de red desconocido")
  return { humanMessage: fallbackMessage, logDetail: { chain } }
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

  logger.info("CLINIC-INFO-SCRAPER", `Iniciando fetch: ${url.toString()}`)

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
    const { humanMessage, logDetail } = describeFetchError(error)
    logger.error("CLINIC-INFO-SCRAPER", `Fetch falló para ${url.toString()}: ${humanMessage}`, logDetail)
    throw new ScrapeError(`No se pudo acceder a la URL (${humanMessage})`, "fetch_failed")
  } finally {
    clearTimeout(timeout)
  }

  logger.info(
    "CLINIC-INFO-SCRAPER",
    `Respuesta recibida: ${response.status} ${response.statusText} (content-type: ${response.headers.get("content-type") || "?"}, content-length: ${response.headers.get("content-length") || "?"})`,
  )

  if (!response.ok) {
    logger.warn("CLINIC-INFO-SCRAPER", `Estado no-OK para ${url.toString()}: ${response.status}`)
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

  logger.info("CLINIC-INFO-SCRAPER", `HTML: ${html.length} chars → texto extraído: ${text.length} chars (título: "${title || "?"}")`)

  if (!text || text.length < 30) {
    logger.warn("CLINIC-INFO-SCRAPER", `Contenido extraído insuficiente para ${url.toString()} (${text.length} chars)`, {
      htmlPreview: html.slice(0, 300),
    })
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
