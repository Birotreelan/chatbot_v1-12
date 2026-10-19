import { NextResponse } from "next/server"
import { getAppointmentStatsByClienteId, getAppointmentStatsByClienteIdFiltered } from "@/lib/appointment-stats"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { type ConsumoDeWpp, getConsumoDeWpp } from "@/lib/consumos-wpp"
import { resolverCostoDeLasInteracciones } from "@/lib/costo-interacciones"
import { calcularImporteAproximado, textoDelImporte } from "@/lib/importe-aproximado"

/**
 * El consumo del período según el proxy de WhatsApp: la misma consulta que hace
 * el panel de estadísticas (`/api/appointment-stats/mensajes-pagados`).
 *
 * Se pide una sola vez y alimenta dos cosas de la respuesta:
 *  - `totalTemplatesSent`, que tiene que ser el mismo número que el panel
 *    muestra en "Recordatorios enviados".
 *  - `costoAproximado`.
 *
 * `null` si falta el período (el proxy se consulta por rango) o si no contestó.
 */
async function consumoDelPeriodo(clienteId: string, startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return null
  return getConsumoDeWpp(clienteId, startDate, endDate)
}

/**
 * El costo aproximado del período, el mismo que muestra el recuadro "Costo
 * aproximado" del panel (19/10/2026).
 *
 * Lo consulta un sistema externo junto con las estadísticas. Sale de las mismas
 * fuentes que el panel —el consumo del proxy y el precio por unidad cargado en
 * facturación para el cliente— y de la misma función, `calcularImporteAproximado`,
 * para que los dos números no puedan diferir.
 *
 * Devuelve `null` sin consumo: `null` y no cero, porque cero pesos se lee como
 * "este mes no se cobra nada".
 */
async function importeDelPeriodo(clienteId: string, consumo: ConsumoDeWpp | null) {
  if (!consumo) return null

  const costo = await resolverCostoDeLasInteracciones(clienteId)

  const importe = calcularImporteAproximado({
    recordatorios: consumo.plantillas,
    // Igual que el panel: todos los mensajes de servicio, o 0 si el proxy no
    // manda el desglose.
    mensajesDeServicio: consumo.servicio?.total ?? 0,
    precioUnitarioUsd: costo.precioUnitarioUsd,
    precioPropio: costo.precioPropio,
    dolarVenta: costo.dolarVenta,
  })

  return { ...importe, texto: textoDelImporte(importe) }
}

/**
 * `NextResponse.json` con el charset declarado (19/10/2026).
 *
 * Sin `charset=utf-8` en el Content-Type, el sistema externo que consume esta
 * ruta leía la respuesta como Latin-1 y el texto de `costoAproximado` llegaba
 * roto: "16.617 Ã— US$ 0,075 … Â· dÃ³lar venta". El JSON siempre fue UTF-8;
 * lo que faltaba era decirlo.
 */
function json(body: unknown, init?: ResponseInit) {
  const respuesta = NextResponse.json(body, init)
  respuesta.headers.set("Content-Type", "application/json; charset=utf-8")
  return respuesta
}

// GET - Obtener estadísticas por cliente_id o lista de todos los clientes con sus estadísticas
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("clienteId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    // Si se especifica un cliente, devolver sus estadísticas
    if (clienteId) {
      // En paralelo: las estadísticas salen de nuestra base y el consumo del
      // proxy; ninguna espera a la otra.
      const [statsInternas, consumo] = await Promise.all([
        startDate || endDate
          ? getAppointmentStatsByClienteIdFiltered(clienteId, startDate || undefined, endDate || undefined)
          : getAppointmentStatsByClienteId(clienteId),
        // Un fallo del proxy no tumba las estadísticas, que ya funcionaban.
        consumoDelPeriodo(clienteId, startDate, endDate).catch((error) => {
          console.error("[APPOINTMENT_STATS_API] Error consultando el consumo:", error)
          return null
        }),
      ])

      const costoAproximado = await importeDelPeriodo(clienteId, consumo).catch((error) => {
        console.error("[APPOINTMENT_STATS_API] Error calculando el importe:", error)
        return null
      })

      // ── totalTemplatesSent = "Recordatorios enviados" del panel (19/10/2026) ──
      //
      // Nuestra base cuenta las plantillas con un contador diario en Redis, y
      // el panel muestra las que informa el proxy (`plantillas`). No coinciden
      // —septiembre 2026, Salud Ocular: 5.410 acá contra 4.897 en el proxy y
      // en el panel— y el sistema externo que consume esta ruta compara con el
      // panel.
      // Manda el proxy, que es además lo que se factura.
      //
      // Sólo se reemplaza el total. Las tasas (confirmación, cancelación,
      // respuesta) quedan como las calcula lib/appointment-stats.ts porque el
      // panel las muestra así; recalcularlas acá haría que la API y el panel
      // pasen a diferir en otro lado. `templatesSentByDay` sigue siendo el
      // conteo interno: el proxy no manda el detalle por día.
      //
      // Si el proxy no contestó, queda el conteo interno y
      // `totalTemplatesSentFuente` lo dice, para que el que consume la API
      // sepa que ese número puede no coincidir con el panel.
      const totalTemplatesSentFuente = consumo ? "proxy" : "interno"
      const stats = statsInternas
        ? {
            ...statsInternas,
            totalTemplatesSent: consumo ? consumo.plantillas : statsInternas.totalTemplatesSent,
          }
        : null

      if (!stats) {
        return json({
          clienteId,
          clientName: "Sin datos",
          totalConfirmed: 0,
          totalCancelled: 0,
          totalRescheduled: 0,
          totalTemplatesSent: consumo ? consumo.plantillas : 0,
          totalTemplatesSentFuente,
          confirmedByDay: {},
          cancelledByDay: {},
          rescheduledByDay: {},
          templatesSentByDay: {},
          confirmationRate: 0,
          cancellationRate: 0,
          responseRate: 0,
          avgResponseTime: 0,
          avgConfirmationTime: 0,
          avgCancellationTime: 0,
          lastUpdated: new Date().toISOString(),
          costoAproximado,
        })
      }

      return json({ ...stats, totalTemplatesSentFuente, costoAproximado })
    }

    // Si no se especifica cliente, devolver resumen de todos los clientes
    const configs = await getAllWhatsAppConfigs()
    const clientsWithStats = []

    for (const config of configs) {
      if (config.cliente_id) {
        const stats =
          startDate || endDate
            ? await getAppointmentStatsByClienteIdFiltered(
                config.cliente_id,
                startDate || undefined,
                endDate || undefined,
              )
            : await getAppointmentStatsByClienteId(config.cliente_id)

        clientsWithStats.push({
          configId: config.id,
          clienteId: config.cliente_id,
          displayName: config.displayName,
          stats: stats || {
            totalConfirmed: 0,
            totalCancelled: 0,
            totalRescheduled: 0,
            totalTemplatesSent: 0,
            confirmationRate: 0,
            cancellationRate: 0,
            responseRate: 0,
          },
        })
      }
    }

    return json(clientsWithStats)
  } catch (error) {
    console.error("[APPOINTMENT_STATS_API] Error:", error)
    return json({ error: "Error al obtener estadísticas" }, { status: 500 })
  }
}
