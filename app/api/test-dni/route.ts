import { NextResponse } from "next/server"
import { buscarPaciente } from "@/lib/api-tools/api-functions"

// Actualizar la ruta de prueba de DNI para utilizar los nuevos endpoints
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

    console.log(`Probando validación de DNI: ${dni} con Proxy: ${proxy} y Cliente ID: ${clienteId}`)

    // Construir el cuerpo de la solicitud manualmente para verificar
    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_paciente",
      dni: dni,
    }

    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    // Realizar la petición usando nuestra función
    const result = await buscarPaciente(clienteId, { dni })

    return NextResponse.json({
      result,
      requestBody,
      message: "Verificar que el cuerpo de la solicitud coincide con el esperado",
    })
  } catch (error) {
    console.error("Error al validar DNI:", error)
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
