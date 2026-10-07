import { NextResponse } from "next/server"
import { facturable, getConsumoDeWpp } from "@/lib/consumos-wpp"
import { requireBillingAgentForApi } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { getAppointmentStatsByClienteIdFiltered } from "@/lib/appointment-stats"
import {
  getPorcentajesPorSede,
  repartirInteraccionesPorSede,
  CLIENTES_EXCLUIDOS_FACTURACION,
} from "@/lib/facturacion-sedes"
import { getDolarVenta } from "@/lib/facturacion-dolar"
import { getPrecioUnidad } from "@/lib/facturacion-precios"
import {
  guardarCierre,
  leerCierre,
  mesTerminado,
  periodoDe,
  reglaDelPeriodo,
  type CierreDeMes,
} from "@/lib/facturacion-cierre"

interface FacturacionClienteRow {
  clienteId: string
  // clienteId "real" (sin el sufijo de sede), usado para asociar el precio
  // por unidad editable, que es un único valor por cliente.
  clienteIdBase: string
  nombreCliente: string
  totalInteracciones: number
  /**
   * El cierre guardado, cuando la fila viene de un mes congelado.
   *
   * Lo usa la tabla para mostrar el precio y el dólar con los que se facturó,
   * en vez de los de hoy: un cierre sin su desglose no se puede defender ante
   * el cliente. Ver lib/facturacion-cierre.ts.
   */
  cierre?: CierreDeMes
  /**
   * De dónde salen las unidades, desde octubre 2026. Ausente con la regla
   * anterior, donde el total incluía conversaciones iniciadas y las dos partes
   * no sumaban el total.
   */
  recordatorios?: number
  serviciosPagados?: number
  /**
   * `true` si el proxy devolvió partes que no suman su propio
   * `mensajes_pagados`.
   *
   * Se calcula en el servidor sobre los valores crudos y viaja como dato, en
   * lugar de que la tabla lo deduzca comparando las columnas que muestra: con
   * varias sedes esas columnas están prorrateadas y redondeadas, y la
   * comparación inventaría inconsistencias donde no hay ninguna.
   */
  desgloseInconsistente?: boolean
}

/**
 * El desglose de UNA sede, prorrateado.
 *
 * El total del cliente se reparte entre sedes por porcentaje, así que el
 * desglose tiene que repartirse igual. Los recordatorios se prorratean y los
 * servicios pagos salen por RESTA contra el total de esa sede: si se
 * prorratearan los dos por separado, los redondeos harían que las partes no
 * sumen el total de la fila, y una tabla donde 12 + 7 da 20 es una tabla en la
 * que uno deja de confiar.
 *
 * Esta resta es distinta de la que se sacó de `facturable`: acá no disimula
 * nada del proxy —reparte un total del cliente que ya es consistente— y lo que
 * evita es un artefacto nuestro, el redondeo del prorrateo.
 *
 * Sin `serviciosPagadosDelCliente` no hay desglose que repartir: se devuelve
 * vacío y la fila muestra un guion.
 */
function desgloseDeLaSede(
  interaccionesDeLaSede: number,
  recordatoriosDelCliente: number,
  serviciosPagadosDelCliente: number | null,
  totalDelCliente: number,
  regla: string,
): { recordatorios?: number; serviciosPagados?: number } {
  if (regla !== "solo_enviados" || serviciosPagadosDelCliente === null) return {}
  if (totalDelCliente <= 0) return { recordatorios: 0, serviciosPagados: 0 }

  const proporcion = interaccionesDeLaSede / totalDelCliente
  const recordatorios = Math.min(
    interaccionesDeLaSede,
    Math.round(recordatoriosDelCliente * proporcion),
  )

  return { recordatorios, serviciosPagados: interaccionesDeLaSede - recordatorios }
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

    const configs = await getAllWhatsAppConfigs()
    const clientesConId = configs.filter(
      (c) =>
        !!c.cliente_id &&
        !CLIENTES_EXCLUIDOS_FACTURACION.includes(c.cliente_id!) &&
        c.mostrarEnFacturacion !== false,
    )

    const filasPorCliente: FacturacionClienteRow[][] = await Promise.all(
      clientesConId.map(async (config): Promise<FacturacionClienteRow[]> => {
        const clienteId = config.cliente_id!

        // ── Un mes cerrado no se recalcula (7/10/2026) ──────────────────
        //
        // Si este mes ya terminó y quedó cerrado, se devuelve lo guardado y no
        // se consulta nada. Es lo que hace que un total facturado no cambie
        // nunca más: ni por el dólar del día, ni por un cambio de precio, ni
        // por un cambio de la lógica de cálculo. Ver lib/facturacion-cierre.ts.
        if (congelable) {
          const cerrado = await leerCierre(clienteId, periodo)
          if (cerrado) {
            // Con sedes se devuelven las mismas filas que se facturaron, con
            // el reparto tal como quedó. Recalcular los porcentajes ahora
            // podría repartir distinto el mismo total.
            if (cerrado.sedes?.length) {
              return cerrado.sedes.map((sede, idx) => ({
                clienteId: `${clienteId}::${idx}`,
                clienteIdBase: clienteId,
                nombreCliente: `${config.displayName} - ${sede.nombre}`,
                totalInteracciones: sede.interacciones,
                recordatorios: sede.recordatorios,
                serviciosPagados: sede.serviciosPagados,
                cierre: cerrado,
              }))
            }

            return [
              {
                clienteId,
                clienteIdBase: clienteId,
                nombreCliente: config.displayName,
                totalInteracciones: cerrado.unidades,
                recordatorios: cerrado.desglose?.recordatorios,
                serviciosPagados: cerrado.desglose?.serviciosPagados,
                cierre: cerrado,
              },
            ]
          }
        }

        const consumo = await getConsumoDeWpp(clienteId, fechaInicio, fechaFin)

        // ── Lo facturable y sus dos partes (7/10/2026) ────────────────────
        //
        // Los tres números se replican de la API sin tocarlos: se factura
        // `mensajes_pagados`, y las partes son `plantillas` y
        // `servicio.pagados`. Si alguna vez no cierran, `coincide` viene en
        // `false` y la tabla lo muestra, que es lo que permite corregirlo en la
        // API externa en vez de disimularlo acá. Ver lib/consumos-wpp.ts.
        const { recordatorios, serviciosPagados, total: totalFacturable, coincide } =
          facturable(consumo)

        // El desglose sólo viaja con la regla nueva, y sólo si el proxy mandó
        // las dos partes.
        const desglose =
          regla === "solo_enviados" && serviciosPagados !== null
            ? { recordatorios, serviciosPagados }
            : undefined

        let stats = await getAppointmentStatsByClienteIdFiltered(clienteId, fechaInicio, fechaFin)
        if (!stats && config.id !== clienteId) {
          stats = await getAppointmentStatsByClienteIdFiltered(config.id, fechaInicio, fechaFin)
        }

        // ── Qué se factura, según el período (7/10/2026) ────────────────
        //
        // Hasta septiembre 2026: lo que Meta cobra MÁS las conversaciones
        // iniciadas por el paciente. Desde octubre: sólo lo que Meta cobra.
        //
        // El corte existe porque la regla nueva da un número bastante menor, y
        // aplicarla a los meses ya facturados los haría dejar de coincidir con
        // las facturas emitidas. Ver `reglaDelPeriodo`.
        //
        // Lo decide el PERÍODO que se está mirando, no la fecha de hoy: abrir
        // septiembre en diciembre tiene que seguir dando el número de
        // septiembre.
        const totalInteracciones =
          regla === "solo_enviados"
            ? totalFacturable
            : totalFacturable + (stats?.totalUserInitiated || 0)

        // El reparto por sede se resuelve antes de cerrar: forma parte de lo
        // que hay que congelar.
        const porcentajesSedes = await getPorcentajesPorSede(clienteId, fechaInicio, fechaFin)
        const reparto = porcentajesSedes
          ? repartirInteraccionesPorSede(totalInteracciones, porcentajesSedes)
          : null

        // ── Se cierra la primera vez que se mira el mes terminado ───────
        //
        // Con el precio y el dólar DE ESTE MOMENTO, que es lo que hace el
        // cierre auditable: dentro de un año, "1.320 unidades a US$ 0,13 con
        // el dólar a $1.465" se puede explicar; un total suelto, no.
        //
        // Va con `void`: si el guardado falla, el panel igual muestra el
        // número. Un cierre que no se pudo escribir se vuelve a intentar la
        // próxima vez que alguien abra el mes.
        if (congelable) {
          void (async () => {
            const [precio, dolar] = await Promise.all([
              getPrecioUnidad(clienteId).catch(() => null),
              getDolarVenta().catch(() => null),
            ])
            await guardarCierre(clienteId, {
              periodo,
              unidades: totalInteracciones,
              // Sólo con la regla nueva: con la anterior el total incluía
              // conversaciones iniciadas y las dos partes no lo sumaban.
              desglose,
              precioUnitarioUsd: precio,
              dolarVenta: dolar,
              regla,
              cerradoEl: new Date().toISOString(),
              sedes: reparto?.map((sede) => ({
                nombre: sede.nombre,
                interacciones: sede.interacciones,
                ...desgloseDeLaSede(sede.interacciones, recordatorios, serviciosPagados, totalFacturable, regla),
              })),
            })
          })()
        }

        // Si el cliente tiene múltiples sedes, desglosar el total según los
        // porcentajes que devuelve el servicio externo de esa clínica.
        if (reparto) {
          return reparto.map((sede, idx) => ({
            clienteId: `${clienteId}::${idx}`,
            clienteIdBase: clienteId,
            nombreCliente: `${config.displayName} - ${sede.nombre}`,
            totalInteracciones: sede.interacciones,
            ...desgloseDeLaSede(sede.interacciones, recordatorios, serviciosPagados, totalFacturable, regla),
            ...(coincide ? {} : { desgloseInconsistente: true }),
          }))
        }

        return [
          {
            clienteId,
            clienteIdBase: clienteId,
            nombreCliente: config.displayName,
            totalInteracciones,
            ...(desglose ?? {}),
            ...(coincide ? {} : { desgloseInconsistente: true }),
          },
        ]
      }),
    )

    const filas = filasPorCliente.flat()
    filas.sort((a, b) => a.nombreCliente.localeCompare(b.nombreCliente))

    const dolarVenta = await getDolarVenta()

    return NextResponse.json({
      exito: true,
      filtroFechas: { fechaInicio, fechaFin },
      dolarVenta,
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
