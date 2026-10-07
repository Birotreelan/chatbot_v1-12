/**
 * Reabrir un mes cerrado.
 *
 *   DELETE /api/facturacion/cierre?mes=2026-09
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
import { reabrirMes } from "@/lib/facturacion-cierre"

export const runtime = "nodejs"

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
