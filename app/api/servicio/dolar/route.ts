/**
 * El dólar de un período en la pestaña Servicio.
 *
 * GET devuelve el fijado y el vivo por separado, para que la interfaz pueda
 * decir CUÁL está usando. Mostrar sólo el número que se aplica dejaría al que
 * mira sin saber si es un valor que alguien fijó o el de hoy — y eso cambia
 * cómo se lee el total.
 */

import { NextResponse } from "next/server"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { getDolarServicio, setDolarServicio } from "@/lib/servicio-dolar"
import { getDolarVenta } from "@/lib/facturacion-dolar"

export const dynamic = "force-dynamic"

function periodoValido(periodo: unknown): periodo is string {
  return typeof periodo === "string" && /^\d{4}-\d{2}$/.test(periodo)
}

export async function GET(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const periodo = new URL(request.url).searchParams.get("mes")
    if (!periodoValido(periodo)) {
      return NextResponse.json({ error: "mes debe tener el formato YYYY-MM" }, { status: 400 })
    }

    const [fijado, vivo] = await Promise.all([
      getDolarServicio(periodo),
      getDolarVenta().catch(() => null),
    ])

    return NextResponse.json({ exito: true, periodo, fijado, vivo })
  } catch (error) {
    console.error("[SERVICIO_DOLAR] Error leyendo:", error)
    return NextResponse.json({ error: "Error al obtener el dólar" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const body = await request.json().catch(() => null)
    const periodo = body?.mes
    if (!periodoValido(periodo)) {
      return NextResponse.json({ error: "mes debe tener el formato YYYY-MM" }, { status: 400 })
    }

    // `null`, 0 o vacío borran el valor fijado y se vuelve al dólar vivo.
    const crudo = body?.valor
    const valor = crudo === null || crudo === "" || crudo === undefined ? null : Number(crudo)
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      return NextResponse.json({ error: "valor debe ser un número > 0, o null" }, { status: 400 })
    }

    await setDolarServicio(periodo, valor)
    const vivo = await getDolarVenta().catch(() => null)
    return NextResponse.json({ exito: true, periodo, fijado: valor, vivo })
  } catch (error) {
    console.error("[SERVICIO_DOLAR] Error guardando:", error)
    return NextResponse.json({ error: "Error al guardar el dólar" }, { status: 500 })
  }
}
