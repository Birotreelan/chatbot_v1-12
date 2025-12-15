import { NextResponse } from "next/server"

// Modificar la ruta para usar la URL hardcodeada
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const dni = searchParams.get("dni")
  const clienteId = searchParams.get("cliente_id") || ""

  if (!dni) {
    return NextResponse.json({ error: "Se requiere el parámetro dni" }, { status: 400 })
  }

  if (!clienteId) {
    return NextResponse.json({ error: "Se requiere el parámetro cliente_id" }, { status: 400 })
  }

  try {
    // Usar la URL hardcodeada
    const proxy = "https://treelan.net/managment/proxy_service/"

    // Construir el cuerpo de la solicitud
    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_paciente",
      dni: dni,
    }

    console.log(`Realizando petición directa a: ${proxy}`)
    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    // Hacer la petición directamente
    const response = await fetch(proxy, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      return NextResponse.json({
        exito: false,
        error: {
          codigo: `HTTP_${response.status}`,
          mensaje: `Error: ${response.statusText}`,
        },
        requestBody,
        status: response.status,
        statusText: response.statusText,
      })
    }

    // Intentar obtener el texto de la respuesta
    const text = await response.text()

    // Intentar parsear como JSON
    let data
    try {
      data = JSON.parse(text)
    } catch (e) {
      data = { rawText: text }
    }

    return NextResponse.json({
      exito: true,
      datos: data,
      requestBody,
      message: "Respuesta directa de la API",
    })
  } catch (error) {
    console.error("Error al validar DNI directamente:", error)
    return NextResponse.json(
      {
        exito: false,
        error: {
          codigo: "ERROR_INTERNO",
          mensaje: error instanceof Error ? error.message : "Error desconocido al validar DNI",
        },
      },
      { status: 500 },
    )
  }
}
