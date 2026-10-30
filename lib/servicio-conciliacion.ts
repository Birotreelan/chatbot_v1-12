/**
 * La cuenta corriente entre lo que computamos y lo que cobró la tarjeta
 * (30/10/2026).
 *
 * ── Por qué una cuenta corriente y no una comparación mes a mes ────────────
 *
 * Porque los períodos no coinciden y no pueden coincidir. Nuestro panel cuenta
 * mensajes de un mes calendario; la tarjeta cierra en fechas móviles —27-Ago,
 * 01-Oct, 29-Oct— y encima Meta cobra por umbral, así que un cargo del 1-Oct
 * puede ser consumo de septiembre. Cualquier comparación mes contra mes va a
 * dar una diferencia, siempre, y esa diferencia no significa nada.
 *
 * Llevado como cuenta corriente, en cambio, cada mes suma lo computado y resta
 * lo imputado, y el saldo se arrastra. El mes suelto no cuadra; el ACUMULADO
 * cuadra al centavo. Es lo que se pidió.
 *
 * ── Se concilia el cargo NETO de Meta, no el costo con impuestos ───────────
 *
 * Esto es lo que hace que cierre. Los impuestos del resumen se calculan sobre
 * una base en pesos al dólar del banco, que nunca va a ser nuestro dólar del
 * mes: si intentáramos cuadrar el número con impuestos, la diferencia sería
 * permanente y por el tipo de cambio, no por los mensajes.
 *
 * Dólares contra dólares sobre el cargo de Meta, en cambio, son dos veces el
 * mismo número: los US$ 0,026 por mensaje que computamos contra los US$ que
 * Meta efectivamente cobró. Los impuestos se toman del resumen como lo que
 * fueron, no como un porcentaje estimado.
 *
 * ── Desde cuándo ───────────────────────────────────────────────────────────
 *
 * Desde el primer período con el costo discriminado (octubre 2026). Antes de
 * eso el costo era un único 0,0318 que no separa el cargo de Meta de sus
 * impuestos, así que no hay con qué conciliar: no existe el dato.
 */

import { COSTO_DESGLOSADO_DESDE, costoPorMensaje } from "./servicio-costos"
import type { ResumenGuardado } from "./servicio-tarjeta"

/** Los mensajes con cargo de un mes. `null` = no se sabe (mes sin cerrar). */
export interface MesComputado {
  periodo: string
  mensajesConCargo: number | null
}

export interface FilaDeConciliacion {
  periodo: string
  mensajesConCargo: number | null
  /** Lo que, según nosotros, Meta tendría que haber cobrado por esos mensajes. */
  computadoUSD: number | null
  /** Lo que la tarjeta cobró de Meta en los resúmenes imputados a este mes. */
  imputadoUSD: number
  /** Los cierres de los resúmenes imputados acá. */
  resumenes: string[]
  /** Costo fijo del mes: lo que no es Meta, con sus impuestos. */
  cargosFijosUSD: number
  /**
   * Saldo acumulado al final del mes: saldo anterior + computado − imputado.
   *
   * Positivo = computamos mensajes que la tarjeta todavía no cobró. Negativo =
   * la tarjeta ya cobró más de lo que computamos, lo que pasa cuando un resumen
   * abarca consumo de un mes anterior al primero conciliado.
   *
   * `null` cuando el mes no sabe sus mensajes: ahí la cadena se corta y no se
   * puede seguir arrastrando un número que no existe.
   */
  saldoUSD: number | null
}

export interface Conciliacion {
  desde: string
  filas: FilaDeConciliacion[]
  computadoAcumuladoUSD: number
  imputadoAcumuladoUSD: number
  /** La diferencia acumulada: lo computado que todavía no llegó al resumen. */
  saldoUSD: number | null
  /** Meses que no saben sus mensajes y por eso cortan el arrastre. */
  mesesSinDato: string[]
  /** Resúmenes imputados a meses que no están en la lista. */
  resumenesFueraDeRango: string[]
}

/**
 * Arma la cuenta corriente.
 *
 * Es una función pura: recibe los meses computados y los resúmenes, y devuelve
 * la cuenta. No consulta nada — así se puede simular, y así el endpoint decide
 * de dónde sale cada mes (de los cierres guardados, o del número que está en
 * pantalla para el mes en curso).
 */
export function conciliar(
  meses: MesComputado[],
  resumenes: ResumenGuardado[],
  desde: string = COSTO_DESGLOSADO_DESDE,
): Conciliacion {
  const enRango = meses
    .filter((m) => /^\d{4}-\d{2}$/.test(m.periodo) && m.periodo >= desde)
    .sort((a, b) => a.periodo.localeCompare(b.periodo))

  const periodos = new Set(enRango.map((m) => m.periodo))
  const resumenesFueraDeRango = resumenes
    .filter((r) => !periodos.has(r.periodoImputado))
    .map((r) => r.cierre)

  const filas: FilaDeConciliacion[] = []
  const mesesSinDato: string[] = []
  let saldo: number | null = 0
  let computadoAcumuladoUSD = 0
  let imputadoAcumuladoUSD = 0

  for (const mes of enRango) {
    const delMes = resumenes.filter((r) => r.periodoImputado === mes.periodo)
    const imputadoUSD = delMes.reduce((s, r) => s + (r.cargosDeMetaUSD || 0), 0)
    const cargosFijosUSD = delMes.reduce((s, r) => s + (r.cargosFijosUSD || 0), 0)

    // El cargo neto de Meta de ESE período: si la composición cambia, cada mes
    // usa la suya. Multiplicar todo por el valor de hoy reescribiría el pasado.
    const metaUSD = costoPorMensaje(mes.periodo).metaUSD
    const computadoUSD = mes.mensajesConCargo === null ? null : mes.mensajesConCargo * metaUSD

    if (computadoUSD === null) {
      mesesSinDato.push(mes.periodo)
      // Una vez que falta un mes, el saldo de los siguientes no se puede
      // afirmar: le faltaría un sumando. Se corta en vez de mostrar un número
      // que parece bueno.
      saldo = null
    } else {
      computadoAcumuladoUSD += computadoUSD
      if (saldo !== null) saldo = saldo + computadoUSD - imputadoUSD
    }
    imputadoAcumuladoUSD += imputadoUSD

    filas.push({
      periodo: mes.periodo,
      mensajesConCargo: mes.mensajesConCargo,
      computadoUSD,
      imputadoUSD,
      resumenes: delMes.map((r) => r.cierre),
      cargosFijosUSD,
      saldoUSD: saldo,
    })
  }

  return {
    desde,
    filas,
    computadoAcumuladoUSD,
    imputadoAcumuladoUSD,
    saldoUSD: mesesSinDato.length > 0 ? null : computadoAcumuladoUSD - imputadoAcumuladoUSD,
    mesesSinDato,
    resumenesFueraDeRango,
  }
}
