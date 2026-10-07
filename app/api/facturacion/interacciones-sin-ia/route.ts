import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { CLIENTES_EXCLUIDOS_FACTURACION } from "@/lib/facturacion-sedes"
import { getDolarVenta } from "@/lib/facturacion-dolar"
import { getPrecioUnidad } from "@/lib/facturacion-precios"
import {
  clientesCerrados,
  guardarCierre,
  leerCierre,
  mesTerminado,
  periodoDe,
  reglaDelPeriodo,
  type CierreDeMes,
} from "@/lib/facturacion-cierre"

interface FacturacionClienteRow {
  clienteId: string
  clienteIdBase: string
  nombreCliente: string
  totalInteracciones: number
  /**
   * El cierre guardado, cuando el mes está congelado: trae el precio y el
   * dólar con los que se facturó. La tabla lo usa para bloquear el valor por
   * unidad. Ver lib/facturacion-cierre.ts.
   */
  cierre?: CierreDeMes
}

interface ClienteSinIAExterno {
  cliente: string
  cliente_id: string
  mensajes_pagados: number
}

interface ConsumosSinIAResponse {
  fecha_inicio: string
  fecha_fin: string
  total: number
  clientes: ClienteSinIAExterno[]
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

    const periodo = periodoDe(fechaInicio)
    const regla = reglaDelPeriodo(periodo)
    const congelable = mesTerminado(periodo)

    // ── Un mes cerrado no se recalcula (7/10/2026) ────────────────────────
    //
    // Estos clientes se facturan igual que los otros y el valor por unidad les
    // va a cambiar en octubre, así que los meses anteriores tienen que quedar
    // con el precio que tenían. Antes esta tabla no se congelaba: el precio
    // seguía editable y el total se movía con cada cambio.
    //
    // La fórmula de estos clientes es siempre la misma —`mensajes_pagados`, sin
    // conversaciones iniciadas—, así que el corte de octubre no los afecta en
    // el conteo; lo que se congela acá es el precio y la cotización.
    const yaCerrados = congelable ? await clientesCerrados(periodo) : []

    let filas: FacturacionClienteRow[] = []
    try {
      const externalResponse = await fetch(
        `https://proxy.santiagovulliez.com/proxy_service/wpp_consumos_sin_ia.php?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`,
      )
      if (externalResponse.ok) {
        const data: ConsumosSinIAResponse = await externalResponse.json()

        // Clientes con mostrarEnFacturacion === false, cruzados por cliente_id
        // (los clientes "sin IA" pueden no tener WhatsAppConfig asociado; en
        // ese caso no están en este set y pasan el filtro por default).
        const configs = await getAllWhatsAppConfigs()
        const ocultos = new Set(
          configs.filter((c) => c.mostrarEnFacturacion === false && c.cliente_id).map((c) => c.cliente_id!),
        )

        filas = (data.clientes || [])
          .filter((c) => !CLIENTES_EXCLUIDOS_FACTURACION.includes(c.cliente_id))
          .filter((c) => !ocultos.has(c.cliente_id))
          .map((c) => ({
            clienteId: c.cliente_id,
            clienteIdBase: c.cliente_id,
            nombreCliente: c.cliente,
            totalInteracciones: c.mensajes_pagados || 0,
          }))

        // El cierre de cada fila: el guardado si ya existe, o uno nuevo con el
        // precio y el dólar de este momento.
        if (congelable) {
          const dolar = await getDolarVenta().catch(() => null)

          filas = await Promise.all(
            filas.map(async (fila) => {
              const guardado = yaCerrados.includes(fila.clienteId)
                ? await leerCierre(fila.clienteId, periodo)
                : null

              if (guardado) {
                return { ...fila, totalInteracciones: guardado.unidades, cierre: guardado }
              }

              const precio = await getPrecioUnidad(fila.clienteId).catch(() => null)
              const nuevo: CierreDeMes = {
                periodo,
                unidades: fila.totalInteracciones,
                precioUnitarioUsd: precio,
                dolarVenta: dolar,
                regla,
                cerradoEl: new Date().toISOString(),
              }
              // Se espera el guardado, al contrario que en la tabla con IA: acá
              // el cierre se devuelve EN la misma respuesta, y si la escritura
              // fallara la fila quedaría marcada como cerrada sin estarlo.
              await guardarCierre(fila.clienteId, nuevo)
              return { ...fila, cierre: nuevo }
            }),
          )
        }
      } else {
        console.warn(`[FACTURACION_SIN_IA_API] Error ${externalResponse.status} consultando servicio externo`)
      }
    } catch (err) {
      console.warn("[FACTURACION_SIN_IA_API] Error consultando servicio externo:", err)
    }

    filas.sort((a, b) => a.nombreCliente.localeCompare(b.nombreCliente))

    const dolarVenta = await getDolarVenta()

    return NextResponse.json({
      exito: true,
      filtroFechas: { fechaInicio, fechaFin },
      dolarVenta,
      clientes: filas,
    })
  } catch (error) {
    console.error("[FACTURACION_SIN_IA_API] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al obtener datos de facturación sin IA" },
      { status: 500 },
    )
  }
}
