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
import {
  clientesCerrados,
  corregirDolarDelMes,
  corregirPrecioDelCierre,
  cotizacionFueraDePeriodo,
  leerCierre,
  reabrirMes,
} from "@/lib/facturacion-cierre"

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

  // Del índice y no de WhatsAppConfig: los clientes "sin IA" no tienen
  // configuración —sus ids vienen del servicio externo— y quedaban afuera.
  const clienteIds = await clientesCerrados(mes)

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

/**
 * Corregir un mes cerrado sin reabrirlo (2/11/2026).
 *
 *   PATCH /api/facturacion/cierre
 *   { mes, clienteId, precioUnitarioUsd }  → el precio de ese cliente
 *   { mes, dolarVenta }                    → el dólar de todo el mes
 *
 * Reabrir recalcula el mes con los datos y el dólar de HOY: para arreglar un
 * precio mal cargado había que aceptar que se moviera todo lo demás. Esto
 * corrige sólo lo que se pide y deja el resto congelado.
 *
 * Las unidades no se pueden tocar: son el consumo medido. Ver la nota en
 * lib/facturacion-cierre.ts.
 */
export async function PATCH(request: NextRequest) {
  const { session, error } = await requireBillingAgentForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const mes = body?.mes
  if (typeof mes !== "string" || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Falta "mes" en formato YYYY-MM' }, { status: 400 })
  }

  // ── El dólar del mes ─────────────────────────────────────────────────────
  if (body?.dolarVenta !== undefined) {
    const valor = body.dolarVenta === null || body.dolarVenta === "" ? null : Number(body.dolarVenta)
    if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
      return NextResponse.json({ error: "dolarVenta debe ser un número > 0, o null" }, { status: 400 })
    }
    const corregidos = await corregirDolarDelMes(mes, valor)
    if (corregidos === 0) {
      return NextResponse.json({ error: `No hay cierres guardados para ${mes}` }, { status: 404 })
    }
    console.log(`[FACTURACION_CIERRE] ${mes}: dólar a ${valor} por ${session.username}`)
    return NextResponse.json({ exito: true, mes, dolarVenta: valor, clientes: corregidos })
  }

  // ── El precio de un cliente ──────────────────────────────────────────────
  const clienteId = body?.clienteId
  if (typeof clienteId !== "string" || !clienteId) {
    return NextResponse.json(
      { error: "Hay que mandar dolarVenta, o clienteId con precioUnitarioUsd" },
      { status: 400 },
    )
  }

  const crudo = body?.precioUnitarioUsd
  const precio = crudo === null || crudo === "" || crudo === undefined ? null : Number(crudo)
  if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
    return NextResponse.json(
      { error: "precioUnitarioUsd debe ser un número >= 0, o null" },
      { status: 400 },
    )
  }

  const listo = await corregirPrecioDelCierre(clienteId, mes, precio)
  if (!listo) {
    return NextResponse.json(
      { error: `${clienteId} no tiene un cierre guardado para ${mes}` },
      { status: 404 },
    )
  }

  console.log(
    `[FACTURACION_CIERRE] ${clienteId} ${mes}: precio a ${precio} por ${session.username}`,
  )
  return NextResponse.json({ exito: true, mes, clienteId, precioUnitarioUsd: precio })
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

  const clienteIds = await clientesCerrados(mes)

  await Promise.all(clienteIds.map((id) => reabrirMes(id, mes)))

  console.log(`[FACTURACION_CIERRE] ${mes} reabierto para ${clienteIds.length} clientes por ${session.username}`)

  return NextResponse.json({ exito: true, mes, clientes: clienteIds.length })
}
