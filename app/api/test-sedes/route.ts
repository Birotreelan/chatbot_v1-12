import { type NextRequest, NextResponse } from "next/server"
import { getSedes, getMedicos } from "@/lib/api-tools/api-functions"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clienteId = searchParams.get("cliente_id")
  const sedeId = searchParams.get("sede_id")

  if (!clienteId) {
    return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
  }

  console.log(`[TEST-SEDES] Probando APIs para cliente: ${clienteId}`)
  if (sedeId) {
    console.log(`[TEST-SEDES] Sede específica: ${sedeId}`)
  }

  const results: any = {
    clienteId,
    sedeId,
    timestamp: new Date().toISOString(),
    tests: {},
  }

  // Probar getSedes con sede específica
  if (sedeId) {
    console.log(`[TEST-SEDES] 🧪 Probando getSedes con sede específica...`)
    try {
      const sedeEspecifica = await getSedes(clienteId, sedeId)
      results.tests.sedeEspecifica = {
        success: sedeEspecifica.success,
        data: sedeEspecifica.data,
        error: sedeEspecifica.error,
      }
      console.log(`[TEST-SEDES] ✅ getSedes (específica) completado`)
    } catch (error) {
      console.error(`[TEST-SEDES] ❌ Error en getSedes (específica):`, error)
      results.tests.sedeEspecifica = {
        success: false,
        error: error.message,
      }
    }
  }

  // Probar getSedes sin sede específica
  console.log(`[TEST-SEDES] 🧪 Probando getSedes sin sede específica...`)
  try {
    const todasSedes = await getSedes(clienteId)
    results.tests.todasSedes = {
      success: todasSedes.success,
      data: todasSedes.data,
      error: todasSedes.error,
    }
    console.log(`[TEST-SEDES] ✅ getSedes (todas) completado`)
  } catch (error) {
    console.error(`[TEST-SEDES] ❌ Error en getSedes (todas):`, error)
    results.tests.todasSedes = {
      success: false,
      error: error.message,
    }
  }

  // Probar getMedicos
  console.log(`[TEST-SEDES] 🧪 Probando getMedicos...`)
  try {
    const medicos = await getMedicos(clienteId, sedeId)
    results.tests.medicos = {
      success: medicos.success,
      data: medicos.data,
      error: medicos.error,
    }
    console.log(`[TEST-SEDES] ✅ getMedicos completado`)
  } catch (error) {
    console.error(`[TEST-SEDES] ❌ Error en getMedicos:`, error)
    results.tests.medicos = {
      success: false,
      error: error.message,
    }
  }

  console.log(`[TEST-SEDES] 📊 Resultados completos:`, JSON.stringify(results, null, 2))

  return NextResponse.json(results)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clienteId, sedeId, action } = body

    if (!clienteId) {
      return NextResponse.json({ error: "clienteId es requerido" }, { status: 400 })
    }

    console.log(`[TEST-SEDES-POST] Ejecutando acción: ${action}`)
    console.log(`[TEST-SEDES-POST] Cliente: ${clienteId}, Sede: ${sedeId}`)

    let result: any

    switch (action) {
      case "getSedes":
        result = await getSedes(clienteId, sedeId)
        break
      case "getMedicos":
        result = await getMedicos(clienteId, sedeId)
        break
      default:
        return NextResponse.json({ error: `Acción no válida: ${action}` }, { status: 400 })
    }

    return NextResponse.json({
      action,
      clienteId,
      sedeId,
      timestamp: new Date().toISOString(),
      result,
    })
  } catch (error) {
    console.error(`[TEST-SEDES-POST] Error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
