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
 * Lo que se cobra, y de dónde sale (7/10/2026).
 *
 * ── Por qué no se usa `mensajes_pagados` ───────────────────────────────────
 *
 * Porque lo que se factura es la suma de las dos partes que el cliente ve en
 * el panel: recordatorios enviados (`plantillas`) más mensajes de servicio con
 * cargo (`servicio.pagados`). `mensajes_pagados` debería valer exactamente eso
 * —el proxy lo calcula así—, pero es un tercer número que el proxy saca por su
 * cuenta, y tomarlo como total deja abierta la posibilidad de facturar algo que
 * no coincide con el desglose que se le muestra al cliente. Un total que no se
 * puede abrir no se puede defender.
 *
 * Se calcula acá y no en cada panel porque es la misma pregunta —"¿cuánto se
 * cobra?"— y ya estuvo contestada en dos lugares distintos.
 *
 * ── Cuando el proxy no manda el desglose ───────────────────────────────────
 *
 * Sin `servicio` no hay forma de saber cuántos mensajes de servicio tuvieron
 * cargo. Ahí se cae a `mensajes_pagados − plantillas`, que es lo mismo que
 * hacíamos antes: mantiene el total en `mensajes_pagados` y no inventa un cero
 * que se leería como "este mes no hubo mensajes de servicio pagos".
 */
export function facturable(consumo: ConsumoDeWpp | null): {
  recordatorios: number
  serviciosPagados: number
  total: number
} {
  if (!consumo) return { recordatorios: 0, serviciosPagados: 0, total: 0 }

  const recordatorios = consumo.plantillas
  const serviciosPagados = consumo.servicio
    ? consumo.servicio.pagados
    : Math.max(0, consumo.mensajesPagados - recordatorios)

  return { recordatorios, serviciosPagados, total: recordatorios + serviciosPagados }
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
