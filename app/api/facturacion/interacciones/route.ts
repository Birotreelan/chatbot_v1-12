import { NextResponse } from "next/server"
import { getConsumoDeWpp } from "@/lib/consumos-wpp"
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

        // Lo facturable desde el servicio externo (mismo origen que /api/stats).
        //
        // `mensajesPagados` sigue siendo el campo correcto acá después del
        // cambio de formato del 1/10/2026: ahora vale plantillas + mensajes de
        // servicio pagos, que es exactamente lo que Meta cobra. Estadísticas,
        // en cambio, muestra `plantillas` bajo "Recordatorios enviados", así
        // que los dos paneles dejan de mostrar el mismo total — decisión
        // tomada, no un descuido. Ver lib/consumos-wpp.ts.
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
                cierre: cerrado,
              }))
            }

            return [
              {
                clienteId,
                clienteIdBase: clienteId,
                nombreCliente: config.displayName,
                totalInteracciones: cerrado.unidades,
                cierre: cerrado,
              },
            ]
          }
        }

        const consumo = await getConsumoDeWpp(clienteId, fechaInicio, fechaFin)
        const mensajesPagados = consumo?.mensajesPagados ?? 0

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
            ? mensajesPagados
            : mensajesPagados + (stats?.totalUserInitiated || 0)

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
              precioUnitarioUsd: precio,
              dolarVenta: dolar,
              regla,
              cerradoEl: new Date().toISOString(),
              sedes: reparto?.map((sede) => ({
                nombre: sede.nombre,
                interacciones: sede.interacciones,
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
          }))
        }

        return [
          {
            clienteId,
            clienteIdBase: clienteId,
            nombreCliente: config.displayName,
            totalInteracciones,
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
