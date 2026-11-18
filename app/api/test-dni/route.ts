import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { buscarPaciente } from "@/lib/api-tools/api-functions"

// Actualizar la ruta de prueba de DNI para utilizar los nuevos endpoints
/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Consulta datos de pacientes por documento contra el sistema de la clínica.
 *
 * La llama el dashboard desde el navegador, con la cookie de sesión: no hubo
 * que tocar ningún `fetch`.
 */
export async function GET(request: Request) {
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request as Request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }


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
    const proxy = "https://api.santiagovulliez.com/proxy_turnos.php"

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
