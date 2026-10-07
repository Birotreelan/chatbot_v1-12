/**
 * El consumo de WhatsApp de una clínica, según el proxy (1/10/2026).
 *
 * ── Por qué existe este módulo ─────────────────────────────────────────────
 *
 * La misma llamada estaba copiada en tres rutas, cada una armando la URL a
 * mano y leyendo un solo campo con `|| 0`. Cuando el proxy cambió el formato,
 * hubo que buscar los tres; si se escapaba uno, Facturación y Estadísticas
 * empezaban a mostrar números distintos del mismo mes sin que nada fallara.
 *
 * ── El formato nuevo ───────────────────────────────────────────────────────
 *
 *     {
 *       "cliente": "...",
 *       "fecha_inicio": "2026-10-01",
 *       "fecha_fin": "2026-10-31",
 *       "mensajes_pagados": 1300,
 *       "plantillas": 1000,
 *       "servicio": { "total": 1300, "gratis": 1000, "pagados": 300 }
 *     }
 *
 * Lo importante del cambio, y la razón de que haya que tocar el panel:
 * `mensajes_pagados` YA NO es la cantidad de recordatorios enviados. Ahora es
 * `plantillas + servicio.pagados`, o sea todo lo que Meta cobra. Los
 * recordatorios son `plantillas`.
 *
 * Mientras tanto el panel seguía mostrando `mensajes_pagados` bajo la etiqueta
 * "Recordatorios enviados", así que informaba de más: en el ejemplo, 1300
 * recordatorios cuando se mandaron 1000.
 *
 * ── Qué se usa dónde ───────────────────────────────────────────────────────
 *
 *  - Estadísticas: "Recordatorios enviados" = `plantillas`, y el total de
 *    interacciones = plantillas + conversaciones iniciadas.
 *  - Facturación, desde octubre 2026: `plantillas + servicio.pagados`, que es
 *    lo que se cobra. Ver `facturable` más abajo.
 *
 * Decisión de Nicolás (1/10/2026): los dos paneles dejan de mostrar el mismo
 * total a propósito —Estadísticas informa actividad, Facturación cobra—, y por
 * eso Estadísticas suma el desglose de mensajes de servicio: para que el
 * cliente pueda reconstruir de dónde sale la diferencia.
 *
 * ── `null` no es cero ──────────────────────────────────────────────────────
 *
 * El `|| 0` de antes hacía que un cambio de contrato fuera invisible: si el
 * campo se renombraba, el panel mostraba cero recordatorios como si el mes
 * hubiera estado sin movimiento. Acá un fallo devuelve `null` y el llamador
 * decide; la interfaz muestra un guion, no un cero.
 */

const BASE = "https://proxy.santiagovulliez.com/proxy_service/wpp_consumos.php"

export interface MensajesDeServicio {
  total: number
  gratis: number
  pagados: number
}

export interface ConsumoDeWpp {
  /** Recordatorios enviados: plantillas despachadas en el período. */
  plantillas: number
  /** Lo facturable: plantillas + mensajes de servicio pagos. */
  mensajesPagados: number
  /** `null` si el proxy todavía no manda el desglose. */
  servicio: MensajesDeServicio | null
  /**
   * `true` si la respuesta no traía `plantillas` y hubo que caer a
   * `mensajes_pagados`. Ver `leerConsumo`.
   */
  formatoViejo: boolean
}

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? parseFloat(valor) : valor
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Traduce la respuesta cruda, tolerando el formato anterior.
 *
 * El proxy y nosotros no se despliegan al mismo tiempo, así que durante un rato
 * puede contestar cualquiera de los dos. Sin `plantillas`, lo más cercano a
 * "recordatorios enviados" que hay es `mensajes_pagados`, que es exactamente lo
 * que el panel venía mostrando: se cae a eso y se deja marcado, en vez de
 * mostrar cero recordatorios durante la ventana del despliegue.
 */
export function leerConsumo(crudo: any): ConsumoDeWpp | null {
  if (!crudo || typeof crudo !== "object") return null

  const mensajesPagados = numero(crudo.mensajes_pagados)
  const traePlantillas = crudo.plantillas !== undefined && crudo.plantillas !== null

  const servicio =
    crudo.servicio && typeof crudo.servicio === "object"
      ? {
          total: numero(crudo.servicio.total),
          gratis: numero(crudo.servicio.gratis),
          pagados: numero(crudo.servicio.pagados),
        }
      : null

  return {
    plantillas: traePlantillas ? numero(crudo.plantillas) : mensajesPagados,
    mensajesPagados,
    servicio,
    formatoViejo: !traePlantillas,
  }
}

/**
 * Lo que se cobra y sus partes, tal como llegan (7/10/2026).
 *
 * ── Se replica la API, no se corrige ───────────────────────────────────────
 *
 * Los tres números salen de la respuesta sin tocarlos: `plantillas`,
 * `servicio.pagados` y `mensajes_pagados`. La relación entre ellos tiene que
 * ser `plantillas + servicio.pagados === mensajes_pagados`, y en las
 * respuestas reales se cumple.
 *
 * Probamos derivar las partes por resta para que la suma cerrara siempre. Es
 * peor: una inconsistencia del proxy quedaba disimulada en números que
 * encajaban, el panel se veía bien y el error seguía ahí, facturándose.
 * Mostrando los tres como llegan, si alguna vez no coinciden se ve en el
 * front y se corrige donde está el problema, que es la API externa.
 *
 * `coincide` es esa verificación hecha una sola vez, acá, sobre los valores
 * crudos. La pantalla no la rehace comparando lo que muestra: con varias sedes
 * los números van prorrateados y redondeados, y el redondeo solo haría aparecer
 * inconsistencias que no existen — un diagnóstico que acusa a la otra parte de
 * algo que está haciendo bien es el peor error posible en un diagnóstico.
 *
 * `serviciosPagados` es `null`, y no 0, cuando el proxy no manda el desglose:
 * un cero ahí se leería como "este mes no hubo mensajes de servicio con cargo",
 * que es un dato, y lo que pasa es que no lo sabemos.
 */
export function facturable(consumo: ConsumoDeWpp | null): {
  recordatorios: number
  serviciosPagados: number | null
  /** `mensajes_pagados`, tal como llega: es lo que se factura. */
  total: number
  /** `false` si las partes no suman el total que informa el proxy. */
  coincide: boolean
} {
  if (!consumo) return { recordatorios: 0, serviciosPagados: null, total: 0, coincide: true }

  const recordatorios = consumo.plantillas
  const serviciosPagados = consumo.servicio ? consumo.servicio.pagados : null

  return {
    recordatorios,
    serviciosPagados,
    total: consumo.mensajesPagados,
    // Sin desglose no hay nada que contrastar: no se acusa de inconsistente a
    // una respuesta que simplemente no trae el dato.
    coincide: serviciosPagados === null || recordatorios + serviciosPagados === consumo.mensajesPagados,
  }
}

/**
 * Consulta el consumo de un cliente en un período.
 *
 * Devuelve `null` ante cualquier problema —red, estado HTTP, JSON ilegible—. No
 * lanza: ninguna de las pantallas que lo usan debe romperse porque el proxy no
 * conteste.
 */
export async function getConsumoDeWpp(
  clienteId: string,
  fechaInicio: string,
  fechaFin: string,
): Promise<ConsumoDeWpp | null> {
  const url =
    `${BASE}?cliente_id=${encodeURIComponent(clienteId)}` +
    `&fecha_inicio=${encodeURIComponent(fechaInicio)}&fecha_fin=${encodeURIComponent(fechaFin)}`

  try {
    const respuesta = await fetch(url, { cache: "no-store" })
    if (!respuesta.ok) {
      console.warn(`[CONSUMOS_WPP] ${respuesta.status} consultando ${clienteId}`)
      return null
    }

    const consumo = leerConsumo(await respuesta.json())

    // ── ¿Las dos cuentas coinciden? ────────────────────────────────────────
    //
    // `plantillas + servicio.pagados` tiene que dar `mensajes_pagados`: son la
    // misma cosa contada de dos formas, y en las respuestas reales coinciden.
    //
    // El log existe para el caso en que dejen de coincidir. Facturamos la suma
    // de las partes, así que una divergencia no rompe nada ni cambia el total
    // visible — y por eso justamente pasaría inadvertida. Si aparece, es un
    // cambio de contrato del proxy y hay que mirarlo antes de facturar el mes.
    if (consumo && !consumo.formatoViejo && consumo.servicio) {
      const suma = consumo.plantillas + consumo.servicio.pagados
      if (suma !== consumo.mensajesPagados) {
        console.warn(
          `[CONSUMOS_WPP] ${clienteId}: plantillas (${consumo.plantillas}) + servicio.pagados ` +
            `(${consumo.servicio.pagados}) = ${suma}, pero mensajes_pagados dice ` +
            `${consumo.mensajesPagados}. Se factura ${suma}.`,
        )
      }
    }

    if (consumo?.formatoViejo) {
      // Vale la pena el log: si aparece después de que el proxy nuevo esté
      // desplegado en todos lados, es que algún cliente quedó apuntando a una
      // versión vieja, y el panel estaría contando de más sin avisar.
      console.warn(`[CONSUMOS_WPP] ${clienteId} respondió sin 'plantillas' (formato anterior)`)
    }

    return consumo
  } catch (error) {
    console.warn(`[CONSUMOS_WPP] Error consultando ${clienteId}:`, error)
    return null
  }
}
