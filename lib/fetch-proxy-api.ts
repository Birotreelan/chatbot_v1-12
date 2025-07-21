/* -------------------------------------------------------------------------------------------------
 * fetchProxyApi
 * -----------------------------------------------------------------------------------------------*/
"use server"

/**
 * Minimal helper to call your proxy service with a JSON payload.
 *
 * @param proxyBaseUrl  Base URL of the proxy service, e.g. "https://treelan.net/managment/proxy_service/"
 * @param endpoint      Path of the endpoint inside the proxy, e.g. "set_turno"
 * @param payload       Data that will be JSON-stringified and sent in the request body
 * @param init          Optional fetch init overrides (headers, cache, etc.).  The method and body
 *                      will be supplied automatically.
 *
 * @throws Error        If the request fails or the proxy responds with a non-2xx status
 * @returns             Parsed JSON response (or plain text if the response is not JSON)
 */
export async function fetchProxyApi(
  proxyBaseUrl: string,
  endpoint: string,
  payload: unknown = {},
  init: Omit<RequestInit, "method" | "body"> = {},
) {
  /* ------------------------------------------------------------------------ */
  // Compose the final URL without duplicate slashes.
  /* ------------------------------------------------------------------------ */
  const url = proxyBaseUrl.replace(/\/+$/, "") + "/" + endpoint.replace(/^\/+/, "")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000) // 15 s hard-timeout

  try {
    const response = await fetch(url, {
      ...init,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    // Try to decode JSON but gracefully fall back to raw text
    const raw = await response.text()
    let data: unknown
    try {
      data = raw ? JSON.parse(raw) : null
    } catch {
      data = raw
    }

    if (!response.ok) {
      throw new Error(
        `Proxy API error ${response.status} ${response.statusText}: ${
          typeof data === "string" ? data : JSON.stringify(data)
        }`,
      )
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}
