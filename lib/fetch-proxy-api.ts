/**
 * Utility function to make HTTP requests to proxy APIs
 * Handles common error cases and provides consistent logging
 */
export async function fetchProxyApi(url: string, data: any, options: { timeout?: number } = {}) {
  const { timeout = 30000 } = options

  console.log(`[PROXY] 📤 POST → ${url}`)
  console.log(`[PROXY] 📦 Payload:`, JSON.stringify(data, null, 2))

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    console.log(`[PROXY] 📥 ${response.status} ${response.statusText}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[PROXY] ❌ Error response: ${errorText}`)
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const responseData = await response.json()
    console.log(`[PROXY] ✅ Response:`, JSON.stringify(responseData, null, 2))

    return responseData
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`[PROXY] ⏰ Request timeout after ${timeout}ms`)
      throw new Error(`Request timeout after ${timeout}ms`)
    }

    console.error(`[PROXY] ❌ Network error:`, error)
    throw error
  }
}
