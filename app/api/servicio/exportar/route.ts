/**
 * El Excel del detalle de servicio, para mandárselo a la empresa.
 *
 *   POST /api/servicio/exportar  →  el .xlsx
 *
 * ── Por qué POST y no GET ──────────────────────────────────────────────────
 *
 * Porque las filas las manda el panel, ya calculadas: el archivo tiene que
 * decir exactamente lo que la persona vio y aprobó antes de mandarlo. Un GET
 * que recalculara del lado del servidor sería una segunda respuesta a la misma
 * pregunta, y el día que las dos difieran nos vamos a enterar por la empresa.
 *
 * Qué campos se mandan y cuáles no está decidido en
 * lib/servicio-exportacion.ts, en una lista escrita a mano a propósito.
 */

import { NextResponse } from "next/server"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import {
  construirPlanillaDeServicio,
  nombreDelArchivo,
  type FilaExportable,
  type GrupoExportable,
} from "@/lib/servicio-exportacion"

export const dynamic = "force-dynamic"

function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function numero(v: unknown): number {
  return numeroONull(v) ?? 0
}

export async function POST(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const body = await request.json().catch(() => null)

    const mes = body?.mes
    if (typeof mes !== "string" || !/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json({ error: "mes debe tener el formato YYYY-MM" }, { status: 400 })
    }

    const crudos = Array.isArray(body?.grupos) ? body.grupos : []
    const grupos: GrupoExportable[] = crudos.map((g: any) => ({
      titulo: String(g?.titulo ?? "").slice(0, 120),
      filas: (Array.isArray(g?.filas) ? g.filas : []).map(
        (f: any): FilaExportable => ({
          cliente: String(f?.cliente ?? "").slice(0, 200),
          recordatorios: numeroONull(f?.recordatorios),
          mensajesDeServicio: numeroONull(f?.mensajesDeServicio),
          interacciones: numero(f?.interacciones),
          costoMetaUSD: numeroONull(f?.costoMetaUSD),
          impuestosUSD: numeroONull(f?.impuestosUSD),
          valorUnitarioUSD: numero(f?.valorUnitarioUSD),
          valorTotalUSD: numero(f?.valorTotalUSD),
          valorTotalARS: numeroONull(f?.valorTotalARS),
        }),
      ),
    }))

    const conFilas = grupos.filter((g) => g.filas.length > 0)
    if (conFilas.length === 0) {
      return NextResponse.json(
        { error: "No hay filas para exportar en este período." },
        { status: 400 },
      )
    }

    const archivo = construirPlanillaDeServicio({
      mes,
      dolarVenta: numeroONull(body?.dolarVenta),
      detalleDeImpuestos: String(body?.detalleDeImpuestos ?? "IVA + sellos").slice(0, 200),
      costoMetaUnitarioUSD: numero(body?.costoMetaUnitarioUSD),
      grupos: conFilas,
    })

    const nombre = nombreDelArchivo(mes)
    console.log(
      `[SERVICIO_EXPORTAR] ${nombre}: ${conFilas.length} grupos, ` +
        `${conFilas.reduce((s, g) => s + g.filas.length, 0)} clínicas, ${archivo.length} bytes`,
    )

    return new NextResponse(new Uint8Array(archivo), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Length": String(archivo.length),
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[SERVICIO_EXPORTAR] Error armando la planilla:", error)
    return NextResponse.json({ error: "Error al generar el Excel" }, { status: 500 })
  }
}
