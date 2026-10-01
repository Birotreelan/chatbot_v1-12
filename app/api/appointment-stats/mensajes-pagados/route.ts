/**
 * El consumo de WhatsApp del cliente, para la tarjeta "Total de Interacciones".
 *
 * El nombre de la ruta quedó viejo —desde el 1/10/2026 devuelve bastante más
 * que `mensajes_pagados`— y se mantiene a propósito: cambiarlo obliga a
 * desplegar la ruta y el panel al mismo tiempo, y en el medio hay un rato en
 * que el navegador de alguien todavía tiene el bundle anterior cargado.
 *
 * Por el mismo motivo la respuesta sigue incluyendo `mensajes_pagados` en la
 * raíz: un panel viejo que llegue acá durante el despliegue sigue encontrando
 * lo que busca. Ver lib/consumos-wpp.ts para qué significa cada campo ahora.
 */

import { type NextRequest, NextResponse } from "next/server"

import { getConsumoDeWpp } from "@/lib/consumos-wpp"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const fechaInicio = searchParams.get("fecha_inicio")
    const fechaFin = searchParams.get("fecha_fin")

    if (!clienteId || !fechaInicio || !fechaFin) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    const consumo = await getConsumoDeWpp(clienteId, fechaInicio, fechaFin)

    if (!consumo) {
      // 502 y no un cero: el panel tiene que poder distinguir "no hubo
      // consumo" de "no pudimos averiguarlo", que es justo lo que el `|| 0`
      // anterior borraba.
      return NextResponse.json({ error: "No se pudo obtener el consumo" }, { status: 502 })
    }

    return NextResponse.json({
      exito: true,
      /** Recordatorios enviados. Es lo que muestra la tarjeta. */
      plantillas: consumo.plantillas,
      /** Lo facturable: plantillas + servicio pagos. Lo usa Facturación. */
      mensajes_pagados: consumo.mensajesPagados,
      servicio: consumo.servicio,
    })
  } catch (error) {
    console.error("[API] Error in mensajes-pagados route:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
