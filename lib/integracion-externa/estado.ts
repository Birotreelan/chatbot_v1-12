/**
 * El estado de la integración de un cliente, listo para el tablero.
 *
 * Cruza tres cosas: el catálogo de lo que esperamos, lo que la clínica marcó
 * como no aplicable, y lo efectivamente observado.
 *
 * Vive separado de `registro.ts` porque son dos responsabilidades distintas:
 * aquél anota lo que pasa en el camino caliente del webhook, éste arma un
 * resumen que sólo se pide cuando alguien abre la pantalla.
 */

import { TIPOS_DEL_SISTEMA_EXTERNO, type TipoEsperado } from "./catalogo"
import { observaciones, type ObservacionDeTipo } from "./registro"

/**
 * Cuántos días sin recibir un tipo lo vuelven sospechoso.
 *
 * No es un error: hay tipos de baja frecuencia —una cancelación hecha por la
 * clínica puede no pasar en una semana tranquila—. Pero si el recordatorio,
 * que es diario, lleva siete días sin aparecer, algo se rompió. Por eso el
 * estado se llama "sin novedades" y no "error": dice lo que sabemos, que es
 * que hace rato que no llega, y deja el juicio a quien conoce la clínica.
 */
const DIAS_PARA_SOSPECHAR = 7

export type EstadoDelTipo =
  | "ok" // llegó completo, y hace poco
  | "incompleto" // llegó, pero faltándole campos que el flujo necesita
  | "sin_novedades" // llegó alguna vez, hace más de una semana
  | "nunca" // no se vio nunca
  | "no_aplica" // la clínica declaró que no lo usa

export interface FilaDeIntegracion extends TipoEsperado {
  estado: EstadoDelTipo
  completos: number
  incompletos: number
  ultimo?: string
  diasSinRecibir?: number
  faltantes?: string[]
  muestra?: string
}

export interface EstadoDeIntegracion {
  filas: FilaDeIntegracion[]
  /** Lo que llegó y no está en el catálogo. Suele ser un error de tipeo. */
  inesperados: ObservacionDeTipo[]
  /** `true` si nunca llegó nada: la integración no arrancó, no es que falte uno. */
  sinDatos: boolean
}

function diasDesde(iso?: string): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
}

function masReciente(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) >= Date.parse(b) ? a : b
}

export async function estadoDeIntegracion(
  clienteId: string,
  noAplicables: string[] = [],
): Promise<EstadoDeIntegracion> {
  const vistos = await observaciones(clienteId)

  const filas: FilaDeIntegracion[] = TIPOS_DEL_SISTEMA_EXTERNO.map((esperado) => {
    if (noAplicables.includes(esperado.tipo)) {
      return { ...esperado, estado: "no_aplica", completos: 0, incompletos: 0 }
    }

    const visto = vistos[esperado.tipo]
    if (!visto || (visto.completos === 0 && visto.incompletos === 0)) {
      return { ...esperado, estado: "nunca", completos: 0, incompletos: 0 }
    }

    const ultimo = masReciente(visto.ultimoCompleto, visto.ultimoIncompleto)
    const dias = diasDesde(ultimo)

    // El incompleto manda sobre la antigüedad: un tipo que llega todos los días
    // sin la hora es un problema abierto, y mostrarlo como "ok" porque llegó
    // recién sería esconderlo. Se compara cuál de los dos fue el último: si
    // después del incompleto llegaron completos, el problema se arregló.
    const ultimoIncompleto = Date.parse(visto.ultimoIncompleto || "")
    const ultimoCompleto = Date.parse(visto.ultimoCompleto || "")
    const elIncompletoEsElUltimo =
      visto.incompletos > 0 &&
      !Number.isNaN(ultimoIncompleto) &&
      (Number.isNaN(ultimoCompleto) || ultimoIncompleto >= ultimoCompleto)

    let estado: EstadoDelTipo = "ok"
    if (elIncompletoEsElUltimo) {
      estado = "incompleto"
    } else if (dias !== undefined && dias >= DIAS_PARA_SOSPECHAR) {
      estado = "sin_novedades"
    }

    return {
      ...esperado,
      estado,
      completos: visto.completos,
      incompletos: visto.incompletos,
      ultimo,
      diasSinRecibir: dias,
      faltantes: visto.faltantes,
      muestra: visto.muestra,
    }
  })

  const conocidos = new Set(TIPOS_DEL_SISTEMA_EXTERNO.map((t) => t.tipo))
  const inesperados = Object.values(vistos).filter((v) => v.desconocido && !conocidos.has(v.tipo))

  return {
    filas,
    inesperados,
    sinDatos: Object.keys(vistos).length === 0,
  }
}
