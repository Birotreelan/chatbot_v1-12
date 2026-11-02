/**
 * El PDF guardado de un resumen de tarjeta.
 *
 *   GET /api/servicio/tarjeta/pdf?cierre=2026-10-29
 *
 * Se sirve `inline` para que se abra en el visor del navegador en vez de
 * descargarse: en la conciliación uno lo abre para mirar una línea y volver, no
 * para quedarse con el archivo. Igual se puede guardar desde ahí.
 *
 * ── La compuerta ───────────────────────────────────────────────────────────
 *
 * `exigirSuperAdmin`, el mismo rol que el resto de /dashboard. Un resumen de
 * tarjeta de crédito trae el nombre del titular, su domicilio, los últimos
 * dígitos de la cuenta y el detalle de todos los consumos del período: es
 * bastante más sensible que los números que salen de él.
 */

import { NextResponse } from "next/server"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { leerPDFDelResumen } from "@/lib/servicio-tarjeta"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const cierre = new URL(request.url).searchParams.get("cierre")
    if (!cierre || !/^\d{4}-\d{2}-\d{2}$/.test(cierre)) {
      return NextResponse.json({ error: "cierre debe tener el formato YYYY-MM-DD" }, { status: 400 })
    }

    const pdf = await leerPDFDelResumen(cierre)
    if (!pdf) {
      return NextResponse.json(
        { error: `No hay un PDF guardado para el cierre ${cierre}` },
        { status: 404 },
      )
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="resumen-${cierre}.pdf"`,
        // Es un comprobante guardado: no cambia, pero tampoco tiene por qué
        // quedar en cachés intermedias. Privado y corto.
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch (error) {
    console.error("[SERVICIO_TARJETA_PDF] Error sirviendo el PDF:", error)
    return NextResponse.json({ error: "Error al obtener el PDF" }, { status: 500 })
  }
}
