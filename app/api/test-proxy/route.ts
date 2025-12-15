import { NextResponse } from "next/server"

// Modificar la ruta para usar la URL hardcodeada si no se proporciona
export async function POST(request: Request) {
  try {
    const { proxyUrl, clienteId, action, params } = await request.json()

    // Usar la URL hardcodeada si no se proporciona
    const actualProxyUrl = proxyUrl || "https://treelan.net/managment/proxy_service/"

    // Verificar parámetros requeridos
    if (!clienteId || !action) {
      return NextResponse.json({ success: false, error: "Se requieren clienteId y action" }, { status: 400 })
    }

    console.log(`Realizando prueba directa al proxy:`)
    console.log(`URL: ${actualProxyUrl}`)
    console.log(`Cliente ID: ${clienteId}`)
    console.log(`Action: ${action}`)
    console.log(`Parámetros:`, params || {})

    // Preparar el cuerpo de la solicitud - asegurarnos de que Cliente_Id está exactamente como se espera
    const requestBody = {
      Cliente_Id: clienteId.trim(), // Eliminar espacios en blanco por si acaso
      Action: action,
      ...(params || {}),
    }

    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    // Hacer la petición directamente
    const response = await fetch(actualProxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    // Obtener todos los detalles de la respuesta
    const responseInfo = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    }

    console.log(`Información de la respuesta:`, responseInfo)

    // Intentar obtener el texto de la respuesta
    const responseText = await response.text()
    console.log(`Respuesta (texto): ${responseText}`)

    // Intentar parsear la respuesta como JSON
    let responseData
    try {
      responseData = JSON.parse(responseText)
      console.log(`Respuesta (JSON):`, responseData)
    } catch (e) {
      console.log(`No se pudo parsear la respuesta como JSON:`, e)
      responseData = null
    }

    // Devolver toda la información para diagnóstico
    return NextResponse.json({
      success: response.ok,
      requestInfo: {
        url: actualProxyUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      },
      responseInfo,
      responseText,
      responseData,
    })
  } catch (error) {
    console.error("Error al probar el proxy:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al probar el proxy",
      },
      { status: 500 },
    )
  }
}
