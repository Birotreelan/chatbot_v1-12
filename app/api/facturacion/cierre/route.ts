/**
 * Reabrir un mes cerrado.
 *
 *   GET    /api/facturacion/cierre?mes=2026-09  → la cotización congelada
 *   DELETE /api/facturacion/cierre?mes=2026-09  → reabre el mes
 *
 * Borra el cierre guardado de TODOS los clientes para ese mes, con lo cual el
 * panel vuelve a calcularlo —con los datos y el dólar de hoy— y lo cierra de
 * nuevo la próxima vez que alguien lo abra.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * El cierre se hace solo, la primera vez que alguien mira un mes terminado. Si
 * ese día el proxy devolvía datos incompletos, el error queda congelado y no
 * hay forma de arreglarlo desde la interfaz. Esto es esa forma.
 *
 * ── Por qué es todo el mes y no un cliente ─────────────────────────────────
 *
 * Porque el cierre de un mes es una foto: reabrir un solo cliente dejaría la
 * tabla con unas filas calculadas con el dólar de septiembre y otras con el de
 * hoy, y el total general no sería comparable con nada. Si hay que corregir,
 * se corrige el mes.
 */

import { type NextRequest, NextResponse } from "next/server"

import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { cotizacionFueraDePeriodo, leerCierre, reabrirMes } from "@/lib/facturacion-cierre"

export const runtime = "nodejs"

/**
 * El estado del cierre de un mes, para el encabezado del panel.
 *
 *   GET /api/facturacion/cierre?mes=2026-09
 *
 * Devuelve la cotización con la que quedó cerrado el mes. Hace falta porque el
 * encabezado mostraba el dólar de HOY aunque se estuviera mirando septiembre:
 * las filas decían una cosa y el recuadro de arriba otra, y el que lo mira no
 * tiene forma de saber cuál manda.
 *
 * Alcanza con mirar el cierre de cualquier cliente: todos se cierran juntos, la
 * primera vez que alguien abre el mes, así que comparten la cotización.
 */
export async function GET(request: NextRequest) {
  const { session, error } = await requireBillingAgentForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const mes = new URL(request.url).searchParams.get("mes")
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Falta "mes" en formato YYYY-MM' }, { status: 400 })
  }

  const configs = await getAllWhatsAppConfigs()
  const clienteIds = Array.from(
    new Set(configs.map((c) => c.cliente_id).filter((id): id is string => Boolean(id))),
  )

  for (const id of clienteIds) {
    const cierre = await leerCierre(id, mes)
    if (cierre) {
      return NextResponse.json({
        exito: true,
        mes,
        cerrado: true,
        dolarVenta: cierre.dolarVenta,
        cerradoEl: cierre.cerradoEl,
        regla: cierre.regla,
        cotizacionFueraDePeriodo: cotizacionFueraDePeriodo(cierre),
      })
    }
  }

  return NextResponse.json({ exito: true, mes, cerrado: false })
}

export async function DELETE(request: NextRequest) {
  // Rol de facturación, el mismo que el resto del panel: reabrir un mes cambia
  // lo que se le cobra a un cliente.
  const { session, error } = await requireBillingAgentForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const mes = new URL(request.url).searchParams.get("mes")
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Falta "mes" en formato YYYY-MM' }, { status: 400 })
  }

  const configs = await getAllWhatsAppConfigs()
  const clienteIds = Array.from(
    new Set(configs.map((c) => c.cliente_id).filter((id): id is string => Boolean(id))),
  )

  await Promise.all(clienteIds.map((id) => reabrirMes(id, mes)))

  console.log(`[FACTURACION_CIERRE] ${mes} reabierto para ${clienteIds.length} clientes por ${session.username}`)

  return NextResponse.json({ exito: true, mes, clientes: clienteIds.length })
}
