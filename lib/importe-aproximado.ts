/**
 * La cuenta del "Costo aproximado" (19/10/2026).
 *
 * ── Por qué está acá y no en el componente ─────────────────────────────────
 *
 * Hasta ahora la multiplicación vivía en components/stats/costo-aproximado.tsx.
 * Desde que /api/appointment-stats también devuelve el importe —lo consulta un
 * sistema externo— la misma cuenta se hace en dos lados: el panel y la API. Si
 * cada uno la escribe a su manera, el día que una cambie el sistema externo y
 * el panel dicen números distintos del mismo mes, y no hay forma de saber cuál
 * está bien. Por eso los dos llaman a esta función.
 *
 * Es pura y no importa nada del servidor a propósito: el componente es "use
 * client", y si esto trajera Redis o fetch se lo llevaría al bundle del
 * navegador.
 *
 * ── Qué se cobra ───────────────────────────────────────────────────────────
 *
 *     unidades = recordatorios + TODOS los mensajes de servicio
 *     total    = unidades × precio por unidad (el de facturación del cliente)
 *
 * Ver `unidadesFacturables` en components/stats/tarjeta-de-interacciones.tsx.
 */

export interface ImporteAproximado {
  recordatorios: number
  mensajesDeServicio: number
  /** recordatorios + mensajesDeServicio. */
  unidades: number
  precioUnitarioUsd: number
  /** `true` si el precio es el cargado en facturación para el cliente. */
  precioPropio: boolean
  /** unidades × precio, redondeado a centavos. */
  totalUsd: number
  /** `null` si no se pudo obtener la cotización: no se inventa una. */
  dolarVenta: number | null
  /** totalUsd × dólar venta, redondeado a centavos. `null` sin cotización. */
  totalPesos: number | null
}

const redondear2 = (n: number) => Math.round(n * 100) / 100

export function calcularImporteAproximado({
  recordatorios,
  mensajesDeServicio,
  precioUnitarioUsd,
  precioPropio = false,
  dolarVenta,
}: {
  recordatorios: number
  mensajesDeServicio: number
  precioUnitarioUsd: number
  precioPropio?: boolean
  dolarVenta: number | null
}): ImporteAproximado {
  const unidades = recordatorios + mensajesDeServicio
  // Los pesos salen del total en dólares SIN redondear, igual que siempre los
  // calculó el panel: redondear primero y multiplicar después puede correr el
  // resultado en algunos pesos.
  const totalUsdExacto = unidades * precioUnitarioUsd
  const totalPesos = dolarVenta ? redondear2(totalUsdExacto * dolarVenta) : null

  return {
    recordatorios,
    mensajesDeServicio,
    unidades,
    precioUnitarioUsd,
    precioPropio,
    totalUsd: redondear2(totalUsdExacto),
    dolarVenta: dolarVenta || null,
    totalPesos,
  }
}

// ── Formato ─────────────────────────────────────────────────────────────────
//
// Los mismos formatos que el recuadro del panel, para que el texto que viaja
// por la API sea idéntico a lo que la clínica ve en pantalla.

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
const dolares = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
/** 3 decimales: con 2, US$ 0,075 se ve como 0,08. */
const precioUnitario = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
})
const num = (n: number) => n.toLocaleString("es-AR")

/** Intl usa espacios duros; un sistema externo los recibe como un carácter raro. */
const plano = (s: string) => s.replace(/ | /g, " ")

export interface ImporteAproximadoTexto {
  /** "$ 885.192" (o el total en dólares si no hubo cotización). */
  importe: string
  /** "2.557 recordatorios + 5.107 mensajes de servicio = 7.664 unidades" */
  unidades: string
  /** "7.664 × US$ 0,075 = US$ 574,80 · dólar venta $ 1.540" */
  calculo: string
}

export function textoDelImporte(i: ImporteAproximado): ImporteAproximadoTexto {
  const importe = i.totalPesos !== null ? pesos.format(i.totalPesos) : dolares.format(i.totalUsd)

  const unidades =
    `${num(i.recordatorios)} recordatorio${i.recordatorios === 1 ? "" : "s"} + ` +
    `${num(i.mensajesDeServicio)} mensaje${i.mensajesDeServicio === 1 ? "" : "s"} de servicio = ` +
    `${num(i.unidades)} unidad${i.unidades === 1 ? "" : "es"}`

  const calculo =
    `${num(i.unidades)} × ${precioUnitario.format(i.precioUnitarioUsd)} = ${dolares.format(i.totalUsd)}` +
    (i.dolarVenta !== null
      ? ` · dólar venta ${pesos.format(i.dolarVenta)}`
      : " · no pudimos obtener la cotización del dólar")

  return { importe: plano(importe), unidades: plano(unidades), calculo: plano(calculo) }
}
