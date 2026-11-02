/**
 * El dólar fijado a mano para un mes abierto de Facturación.
 *
 *   GET /api/facturacion/dolar-mes?mes=2026-11  → { fijado, vivo }
 *   PUT /api/facturacion/dolar-mes              → { mes, valor }
 *
 * Devuelve el fijado y el vivo por separado, para que la interfaz pueda decir
 * CUÁL está usando. Mostrar sólo el número que se aplica dejaría al que mira
 * sin saber si es un valor que alguien fijó o el de hoy — y eso cambia cómo se
 * lee el total.
 *
 * Un mes YA CERRADO no pasa por acá: su dólar vive en el cierre, y se corrige
 * con PATCH /api/facturacion/cierre. Ver lib/facturacion-dolar-mes.ts.
 */

import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getDolarDelMes, setDolarDelMes } from "@/lib/facturacion-dolar-mes"
import { getDolarVenta } from "@/lib/facturacion-dolar"

export const dynamic = "force-dynamic"

function periodoValido(periodo: unknown): periodo is string {
  return typeof periodo === "string" && /^\d{4}-\d{2}$/.test(periodo)
}

export async function GET(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

    const mes = new URL(request.url).searchParams.get("mes")
    if (!periodoValido(mes)) {
      return NextResponse.json({ error: "mes debe tener el formato YYYY-MM" }, { status: 400 })
    }

    const [fijado, vivo] = await Promise.all([
      getDolarDelMes(mes),
      getDolarVenta().catch(() => null),
    ])

    return NextResponse.json({ exito: true, mes, fijado, vivo })
  } catch (error) {
    console.error("[FACTURACION_DOLAR_MES] Error leyendo:", error)
    return NextResponse.json({ error: "Error al obtener el dólar del mes" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

    const body = await request.json().catch(() => null)
    const mes = body?.mes
    if (!periodoValido(mes)) {
      return NextResponse.json({ error: "mes debe tener el formato YYYY-MM" }, { status: 400 })
    }

    const crudo = body?.valor
    const valor = crudo === null || crudo === "" || crudo === undefined ? null : Number(crudo)
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      return NextResponse.json({ error: "valor debe ser un número > 0, o null" }, { status: 400 })
    }

    await setDolarDelMes(mes, valor)
    console.log(`[FACTURACION_DOLAR_MES] ${mes}: dólar fijado en ${valor} por ${session.username}`)

    const vivo = await getDolarVenta().catch(() => null)
    return NextResponse.json({ exito: true, mes, fijado: valor, vivo })
  } catch (error) {
    console.error("[FACTURACION_DOLAR_MES] Error guardando:", error)
    return NextResponse.json({ error: "Error al guardar el dólar del mes" }, { status: 500 })
  }
}
