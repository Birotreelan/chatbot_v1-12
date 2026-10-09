/**
 * El costo aproximado que la clínica ve en su panel de estadísticas (1/10/2026).
 *
 * ── Por qué "aproximado" y no "total" ──────────────────────────────────────
 *
 * Porque lo es, y la palabra tiene que estar: el período que la clínica elige
 * en el filtro no es necesariamente su período de facturación, la cotización
 * del dólar cambia entre que mira el panel y que se emite la factura, y el
 * consumo del mes en curso todavía está corriendo. Un número presentado como
 * definitivo que después no coincide con la factura es peor que no mostrarlo.
 *
 * ── De dónde sale el precio ────────────────────────────────────────────────
 *
 * Del mismo lugar que la factura: `facturacion:precio_unidad:<cliente_id>`, el
 * valor por unidad que se carga en /dashboard/facturacion. Si la clínica tiene
 * uno cargado, el panel muestra ESE y no el genérico — un panel que dijera
 * 0,15 mientras la factura dice otra cosa genera un reclamo por mes.
 *
 * El default existe para las clínicas a las que todavía no se les cargó el
 * precio. No reemplaza a `precio_unidad`: lo cubre mientras no esté.
 */

import { getPrecioUnidad } from "./facturacion-precios"
import { getDolarVenta } from "./facturacion-dolar"

/**
 * Precio por unidad en dólares, cuando la clínica no tiene uno cargado.
 *
 * Una unidad es un recordatorio enviado o un mensaje de servicio. Se cobran
 * todas: los mensajes de servicio entran completos, tengan cargo de Meta o no.
 *
 * ── Por qué 0,075 y por qué estaba en 0,15 (9/10/2026) ─────────────────────
 *
 * 0,075 es el precio final definido para el cliente. El 0,15 anterior venía de
 * cuando la unidad era otra cosa —se contaban también las conversaciones
 * iniciadas por el paciente— y quedó sin actualizar al cambiar la fórmula.
 *
 * Esto es un DEFAULT: sólo lo ven las clínicas a las que todavía no se les
 * cargó el precio en /dashboard/facturacion. Importa igual, porque mientras
 * estuvo desactualizado esas clínicas vieron el doble de lo que se les factura,
 * y un panel que informa de más no falla: convence.
 */
export const PRECIO_POR_INTERACCION_USD = 0.075

export interface CostoDeLasInteracciones {
  /** Precio unitario efectivo en dólares (el del cliente, o el default). */
  precioUnitarioUsd: number
  /** `true` si salió de la configuración del cliente y no del default. */
  precioPropio: boolean
  /**
   * Cotización del dólar venta, o `null` si la API no respondió.
   *
   * `null` no es un error que haya que esconder: el panel muestra el monto en
   * dólares y aclara que no pudo convertir. Inventar una cotización —usar una
   * vieja, o un valor "razonable"— sería mostrar un número en pesos que nadie
   * puede auditar.
   */
  dolarVenta: number | null
}

export async function resolverCostoDeLasInteracciones(
  clienteId: string,
): Promise<CostoDeLasInteracciones> {
  // En paralelo: son dos cosas independientes y el panel espera las dos.
  const [precioDelCliente, dolarVenta] = await Promise.all([
    getPrecioUnidad(clienteId).catch(() => null),
    getDolarVenta().catch(() => null),
  ])

  // `> 0` y no `!= null`: un precio en cero guardado por error haría que el
  // panel informe un costo de cero pesos, que se lee como "esto es gratis".
  const precioPropio = typeof precioDelCliente === "number" && precioDelCliente > 0

  return {
    precioUnitarioUsd: precioPropio ? (precioDelCliente as number) : PRECIO_POR_INTERACCION_USD,
    precioPropio,
    dolarVenta,
  }
}
