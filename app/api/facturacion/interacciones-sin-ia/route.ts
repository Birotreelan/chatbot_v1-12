import { NextResponse } from "next/server"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { CLIENTES_EXCLUIDOS_FACTURACION } from "@/lib/facturacion-sedes"
import { getDolarVenta } from "@/lib/facturacion-dolar"
import { facturable, leerConsumo } from "@/lib/consumos-wpp"
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
  /**
   * Los mensajes que Meta sí nos cobra, base del costo de monotributo.
   *
   * Para estos clientes es el total mismo: lo que se les factura ES
   * `mensajes_pagados`. Se manda igual, como campo propio, porque la tabla es
   * el mismo componente que la de clientes con IA, donde las dos cosas no
   * coinciden —ahí el total incluye los mensajes de servicio gratuitos, que no
   * tienen costo—. Si acá se dejara vacío y la tabla cayera al total, el día
   * que estos clientes empiecen a facturar como los otros el costo se
   * calcularía sobre la base equivocada sin que nada avise.
   */
  mensajesConCargoDeMeta?: number
  /** De dónde salen las unidades, desde octubre 2026. Ver abajo. */
  recordatorios?: number
  serviciosFacturados?: number
}

/**
 * Desde el 7/10/2026 el endpoint sin IA devuelve la misma estructura que el de
 * clientes con IA, así que los campos son opcionales sólo por el período de
 * transición: un mes viejo consultado hoy puede venir sin ellos.
 */
interface ClienteSinIAExterno {
  cliente: string
  cliente_id: string
  mensajes_pagados: number
  plantillas?: number
  servicio?: { total: number; gratis: number; pagados: number }
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
    // Desde el 7/10/2026 el corte de octubre SÍ los afecta en el conteo: pasaron
    // a facturar `plantillas + servicio.total` como los clientes con IA. Los
    // meses anteriores siguen con `mensajes_pagados`, y los que ya estaban
    // cerrados ni se recalculan.
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
          .map((c) => {
            // ── Misma fórmula que los clientes con IA (7/10/2026) ──────────
            //
            // Desde octubre 2026 estos clientes también facturan
            // `plantillas + servicio.total`, o sea con los mensajes de servicio
            // gratuitos incluidos. Antes de octubre se facturaba
            // `mensajes_pagados`, y así tiene que seguir mostrándose: la regla
            // la decide el PERÍODO que se está mirando, no la fecha de hoy ni
            // el formato que haya devuelto el proxy.
            //
            // Se reusan `leerConsumo` y `facturable` en lugar de escribir la
            // suma acá: es la misma pregunta que contesta la otra tabla, y dos
            // copias de la fórmula de facturación es exactamente el tipo de
            // divergencia que después nadie puede explicar.
            const consumo = leerConsumo(c)
            const { recordatorios, serviciosFacturados, total, segunMeta } = facturable(consumo)

            // `serviciosFacturados` en null significa que esta respuesta vino
            // sin el desglose. Ahí no se aplica la fórmula nueva: se factura lo
            // que informa el proxy, y la fila muestra guiones en vez de un
            // desglose inventado.
            const aplicaFormulaNueva = regla === "solo_enviados" && serviciosFacturados !== null

            return {
              clienteId: c.cliente_id,
              clienteIdBase: c.cliente_id,
              nombreCliente: c.cliente,
              totalInteracciones: aplicaFormulaNueva ? total : c.mensajes_pagados || 0,
              ...(aplicaFormulaNueva ? { recordatorios, serviciosFacturados } : {}),
              mensajesConCargoDeMeta: segunMeta,
            }
          })

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
                return {
                  ...fila,
                  totalInteracciones: guardado.unidades,
                  recordatorios: guardado.desglose?.recordatorios,
                  serviciosFacturados: guardado.desglose?.serviciosFacturados,
                  // Del cierre, no del dato de hoy: es lo que hace que el costo
                  // de un mes ya facturado no se mueva.
                  mensajesConCargoDeMeta: guardado.mensajesConCargoDeMeta,
                  cierre: guardado,
                }
              }

              const precio = await getPrecioUnidad(fila.clienteId).catch(() => null)
              const nuevo: CierreDeMes = {
                periodo,
                unidades: fila.totalInteracciones,
                mensajesConCargoDeMeta: fila.mensajesConCargoDeMeta,
                // Congelado junto con el total: si se recalculara, un mes
                // cerrado podría mostrar partes que no suman lo facturado.
                desglose:
                  fila.recordatorios !== undefined && fila.serviciosFacturados !== undefined
                    ? {
                        recordatorios: fila.recordatorios,
                        serviciosFacturados: fila.serviciosFacturados,
                      }
                    : undefined,
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
