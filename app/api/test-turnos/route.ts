import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { obtenerTurnos } from "@/lib/api-tools/api-functions"

// Modificar la ruta para usar la URL hardcodeada
/**
 * ── Esta escritura exige sesión (18/11/2026) ───────────────────────────────
 *
 * Segunda tanda de la auditoría: después de cerrar las lecturas críticas
 * quedaban 37 rutas que ESCRIBEN o MANDAN sin verificar nada. El middleware
 * hace CORS y la cookie del SSO, pero no autentica.
 *
 * Consulta la agenda real de la clínica.
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
  const rangoFechas = searchParams.get("rangoFechas") || "2025-04-01 a 2025-04-30"
  const profesionalId = searchParams.get("profesionalId") || ""
  const clienteId = searchParams.get("cliente_id") || ""

  if (!clienteId) {
    return NextResponse.json({ error: "Se requiere el parámetro cliente_id" }, { status: 400 })
  }

  try {
    // Usar la URL hardcodeada
    const proxy = "https://api.santiagovulliez.com/proxy_turnos.php"

    console.log(`Probando búsqueda de turnos disponibles:
    - Rango de fechas: ${rangoFechas}
    - Profesional ID: ${profesionalId || "No especificado"}
    - Proxy: ${proxy}
    - Cliente ID: ${clienteId}`)

    // Extraer fechas desde y hasta del rango
    const [fechaDesde, fechaHasta] = rangoFechas.split(" a ")

    // Construir el cuerpo de la solicitud manualmente para verificar
    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_turnos",
      Fecha_Desde: fechaDesde,
      Fecha_Hasta: fechaHasta || fechaDesde,
    }

    if (profesionalId) {
      requestBody["Profesional_Id"] = profesionalId
    }

    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    // Realizar la petición usando nuestra función
    const result = await obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde, profesionalId)

    return NextResponse.json({
      result,
      requestBody,
      message: "Verificar que el cuerpo de la solicitud coincide con el esperado",
    })
  } catch (error) {
    console.error("Error al buscar turnos disponibles:", error)
    return NextResponse.json(
      {
        exito: false,
        error: {
          codigo: "ERROR_INTERNO",
          mensaje: error instanceof Error ? error.message : "Error desconocido al buscar turnos disponibles",
        },
      },
      { status: 500 },
    )
  }
}
