import { type NextRequest, NextResponse } from "next/server"
import { getWhatsAppConfigByPhoneId } from "@/lib/db"
import * as apiFunctions from "@/lib/api-tools/api-functions"
import { resolveProxyUrl } from "@/lib/proxy-url-resolver"

// Actualizar la ruta de API de prueba para utilizar los nuevos endpoints
export async function POST(req: NextRequest) {
  try {
    const { phoneNumberId, testType, params } = await req.json()

    // Verificar parámetros requeridos
    if (!phoneNumberId || !testType) {
      return NextResponse.json({ success: false, error: "Se requieren phoneNumberId y testType" }, { status: 400 })
    }

    // Obtener la configuración para este número de teléfono
    const config = await getWhatsAppConfigByPhoneId(phoneNumberId)

    if (!config) {
      return NextResponse.json(
        { success: false, error: `No se encontró configuración para el número de teléfono ID: ${phoneNumberId}` },
        { status: 404 },
      )
    }

    // Verificar que la configuración tiene un cliente_id
    if (!config.cliente_id) {
      return NextResponse.json(
        { success: false, error: "La configuración no tiene un ID de cliente configurado" },
        { status: 400 },
      )
    }

    // Proxy dinámico por clínica (config.proxy), con fallback a las env vars
    // globales — ver lib/proxy-url-resolver.ts. Nota: esta ruta de test ya
    // llamaba a apiFunctions.* con una firma desactualizada (pasando "proxy"
    // como primer argumento, cuando esas funciones toman clienteId) — eso es
    // preexistente y no se modificó acá, solo se migró el origen de la URL.
    let proxy: string
    try {
      proxy = await resolveProxyUrl(config.cliente_id)
    } catch {
      return NextResponse.json(
        { success: false, error: "No hay Proxy URL configurada (ni por clínica ni en las variables de entorno globales)" },
        { status: 500 },
      )
    }

    // Ejecutar la prueba según el tipo
    let result
    switch (testType) {
      case "buscarPaciente":
        if (!params?.dni) {
          return NextResponse.json({ success: false, error: "Se requiere el parámetro dni" }, { status: 400 })
        }
        result = await apiFunctions.buscarPaciente(proxy, config.cliente_id, { dni: params.dni })
        break

      case "verificarDisponibilidad":
        if (!params?.fecha) {
          return NextResponse.json({ success: false, error: "Se requiere el parámetro fecha" }, { status: 400 })
        }
        result = await apiFunctions.obtenerTurnos(proxy, config.cliente_id, params.fecha, params.fecha, params.doctorId)
        break

      case "obtenerAgenda":
        if (!params?.fechaDesde || !params?.fechaHasta) {
          return NextResponse.json(
            { success: false, error: "Se requieren los parámetros fechaDesde y fechaHasta" },
            { status: 400 },
          )
        }
        result = await apiFunctions.obtenerTurnos(
          proxy,
          config.cliente_id,
          params.fechaDesde,
          params.fechaHasta,
          params.doctorId,
        )
        break

      case "obtenerDoctores":
        result = await apiFunctions.buscarProfesionales(proxy, config.cliente_id, "")
        break

      case "obtenerEspecialidades":
        result = await apiFunctions.obtenerEspecialidades(proxy, config.cliente_id)
        break

      case "obtenerSubespecialidades":
        result = await apiFunctions.obtenerSubespecialidades(proxy, config.cliente_id)
        break

      default:
        return NextResponse.json({ success: false, error: `Tipo de prueba no soportado: ${testType}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error("Error al probar la API:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido al probar la API",
      },
      { status: 500 },
    )
  }
}
