/**
 * Desde cuándo Servicio calcula por su cuenta (16/10/2026).
 *
 * Es un módulo puro —sin Redis— porque la decisión la toman las dos puntas: el
 * componente de cliente que dibuja la tabla y los endpoints del servidor.
 *
 * ── La regla, en una línea ─────────────────────────────────────────────────
 *
 * Hasta septiembre de 2026, Servicio muestra EXACTAMENTE lo mismo que
 * Facturación. Desde octubre, usa su propio valor por unidad y su propio dólar.
 *
 * ── Por qué un corte y no "Servicio siempre usa lo suyo" ───────────────────
 *
 * Porque los meses anteriores ya se facturaron. Si Servicio los recalculara con
 * otro precio, habría dos respuestas distintas a "¿cuánto fue septiembre?" en
 * dos pestañas del mismo panel, y la diferencia no significaría nada — sería
 * sólo que alguien cargó un precio nuevo después.
 *
 * Es el mismo criterio que ya rige para las reglas de cálculo
 * (lib/facturacion-reglas.ts): lo decide el PERÍODO que se está mirando, no la
 * fecha de hoy. Abrir septiembre en diciembre tiene que seguir dando lo de
 * septiembre.
 *
 * ── Lo que el corte NO toca ────────────────────────────────────────────────
 *
 * Los conteos. Recordatorios, mensajes de servicio y total de interacciones
 * salen del mismo lugar en las dos pestañas, siempre, incluido el desglose
 * congelado de un mes cerrado. Lo único que Servicio cambia es con qué precio
 * y con qué dólar se multiplican.
 */

/** Primer período en el que Servicio usa su propio precio y su propio dólar. */
export const SERVICIO_PRECIO_PROPIO_DESDE = "2026-10"

/**
 * ¿Este período se calcula con los valores propios de Servicio?
 *
 * La comparación es de strings "YYYY-MM", que para este formato ordena igual
 * que por fecha y no arrastra zonas horarias — el mismo truco que usa el resto
 * del módulo de facturación.
 */
export function servicioUsaValoresPropios(periodo: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(periodo)) return false
  return periodo >= SERVICIO_PRECIO_PROPIO_DESDE
}
