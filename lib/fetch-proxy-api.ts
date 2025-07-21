export async function fetchProxyApi(proxyUrl: string, payload: any): Promise<any> {
  console.log(`[PROXY] 📤 POST → ${proxyUrl}`)
  console.log(`[PROXY] 📋 Payload:`, JSON.stringify(payload, null, 2))

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    })

    const responseText = await response.text()
    console.log(
      `[PROXY] 📥 ${response.status} ${responseText.substring(0, 200)}${responseText.length > 200 ? "..." : ""}`,
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      console.error(`[PROXY] ❌ Error parsing response:`, parseError)
      return {
        exito: false,
        error: {
          codigo: "PARSE_ERROR",
          mensaje: `Invalid JSON response: ${responseText.substring(0, 100)}...`,
        },
      }
    }

    return data
  } catch (error) {
    console.error(`[PROXY] ❌ Error:`, error)

    if (error.name === "AbortError") {
      return {
        exito: false,
        error: {
          codigo: "TIMEOUT",
          mensaje: "Request timeout after 30 seconds",
        },
      }
    }

    return {
      exito: false,
      error: {
        codigo: "NETWORK_ERROR",
        mensaje: error instanceof Error ? error.message : "Unknown network error",
      },
    }
  }
}
