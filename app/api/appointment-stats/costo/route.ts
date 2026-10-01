/**
 * Precio unitario y cotización del dólar para el panel de estadísticas.
 *
 * Existe porque `/api/facturacion/dolar` pide rol de agente de facturación y
 * esta pantalla la abre la clínica. Acá no se expone nada que la clínica no
 * pueda ver de todos modos: su propio precio por unidad —el que le cobramos a
 * ella— y una cotización pública.
 *
 * La multiplicación la hace el panel, que es el que sabe cuántas interacciones
 * hay en el período elegido. Traer el total de interacciones también acá sería
 * la misma suma calculada en dos lados, y el día que una cambie, los dos
 * números del panel dejan de cerrar entre sí.
 */

import { type NextRequest, NextResponse } from "next/server"

import { resolverCostoDeLasInteracciones } from "@/lib/costo-interacciones"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const clienteId = new URL(request.url).searchParams.get("cliente_id")
    if (!clienteId) {
      return NextResponse.json({ error: "cliente_id requerido" }, { status: 400 })
    }

    const costo = await resolverCostoDeLasInteracciones(clienteId)
    return NextResponse.json({ exito: true, ...costo })
  } catch (error) {
    console.error("[STATS_COSTO] Error:", error)
    return NextResponse.json({ error: "Error al obtener el costo" }, { status: 500 })
  }
}
