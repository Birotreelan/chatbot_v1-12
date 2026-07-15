import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { getAppointmentStatsByClienteIdFiltered } from "@/lib/appointment-stats"
import {
  getPorcentajesPorSede,
  repartirInteraccionesPorSede,
  CLIENTES_EXCLUIDOS_FACTURACION,
} from "@/lib/facturacion-sedes"

interface FacturacionClienteRow {
  clienteId: string
  nombreCliente: string
  totalInteracciones: number
}

export async function GET(request: Request) {
  try {
    const { session, error } = await requireBillingAgentForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const fechaInicio = searchParams.get("fechaInicio")
    const fechaFin = searchParams.get("fechaFin")

    if (!fechaInicio || !fechaFin) {
      return NextResponse.json(
        { error: "Los parámetros fechaInicio y fechaFin son obligatorios." },
        { status: 400 },
      )
    }

    const configs = await getAllWhatsAppConfigs()
    const clientesConId = configs.filter(
      (c) => !!c.cliente_id && !CLIENTES_EXCLUIDOS_FACTURACION.includes(c.cliente_id!),
    )

    const filasPorCliente: FacturacionClienteRow[][] = await Promise.all(
      clientesConId.map(async (config): Promise<FacturacionClienteRow[]> => {
        const clienteId = config.cliente_id!

        // Mensajes pagados desde el servicio externo (mismo origen que /api/stats)
        let mensajesPagados = 0
        try {
          const externalResponse = await fetch(
            `https://proxy.santiagovulliez.com/proxy_service/wpp_consumos.php?cliente_id=${encodeURIComponent(clienteId)}&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`,
          )
          if (externalResponse.ok) {
            const externalData = await externalResponse.json()
            mensajesPagados = externalData.mensajes_pagados || 0
          }
        } catch (err) {
          console.warn(`[FACTURACION_API] Error consumos externos para ${clienteId}:`, err)
        }

        let stats = await getAppointmentStatsByClienteIdFiltered(clienteId, fechaInicio, fechaFin)
        if (!stats && config.id !== clienteId) {
          stats = await getAppointmentStatsByClienteIdFiltered(config.id, fechaInicio, fechaFin)
        }

        const totalInteracciones =
          mensajesPagados + (stats?.totalRescheduleStarted || 0) + (stats?.totalUserInitiated || 0)

        // Si el cliente tiene múltiples sedes, desglosar el total según los
        // porcentajes que devuelve el servicio externo de esa clínica.
        const porcentajesSedes = await getPorcentajesPorSede(clienteId, fechaInicio, fechaFin)
        if (porcentajesSedes) {
          const reparto = repartirInteraccionesPorSede(totalInteracciones, porcentajesSedes)
          return reparto.map((sede, idx) => ({
            clienteId: `${clienteId}::${idx}`,
            nombreCliente: `${config.displayName} - ${sede.nombre}`,
            totalInteracciones: sede.interacciones,
          }))
        }

        return [
          {
            clienteId,
            nombreCliente: config.displayName,
            totalInteracciones,
          },
        ]
      }),
    )

    const filas = filasPorCliente.flat()
    filas.sort((a, b) => a.nombreCliente.localeCompare(b.nombreCliente))

    return NextResponse.json({
      exito: true,
      filtroFechas: { fechaInicio, fechaFin },
      clientes: filas,
    })
  } catch (error) {
    console.error("[FACTURACION_API] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al obtener datos de facturación" },
      { status: 500 },
    )
  }
}
