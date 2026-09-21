/**
 * A qué número del WABA corresponden los consumos que estamos mostrando
 * (21/9/2026).
 *
 * ── El bug ─────────────────────────────────────────────────────────────────
 *
 * La ruta de consumos hacía esto:
 *
 *     phoneNumber = messagingData.analytics.phone_numbers[0]
 *
 * Tomaba el PRIMER número del WABA, no el de la configuración que el usuario
 * estaba consultando. Mientras cada cliente tuvo su propio WABA daba lo mismo:
 * había un solo número y era el correcto.
 *
 * Al llegar al tope de números por empresa, varias clínicas pasaron a compartir
 * WABA. Desde entonces el dashboard de una clínica podía estar mostrando los
 * consumos de otra — la que Meta devolviera primero, que además no hay ninguna
 * garantía de que sea estable entre llamadas.
 *
 * La página se llama "Consumos y Facturación". El dato no es informativo: es el
 * que decide cuánto se le factura a cada clínica.
 *
 * ── El criterio ────────────────────────────────────────────────────────────
 *
 * No hay una respuesta "por defecto" razonable. Frente a la duda, esta función
 * se niega a elegir: es preferible una pantalla que dice "no puedo atribuir
 * esto" a una que muestra con total naturalidad el consumo del vecino.
 *
 * La única excepción es el WABA con un solo número, donde no hay ambigüedad
 * posible aunque la config no tenga el número cargado.
 */

export type ResolucionDeNumero =
  | { ok: true; numero: string; /** true si el WABA tiene un solo número. */ unico: boolean }
  | { ok: false; motivo: string }

/** Deja sólo los dígitos, para comparar "+54 9 11 1234-5678" con "5491112345678". */
function soloDigitos(valor: string | null | undefined): string {
  return (valor || "").replace(/\D/g, "")
}

/**
 * Elige el número del WABA que corresponde a esta configuración.
 *
 * `numerosDelWaba` viene de la respuesta de Meta, así que su formato es el que
 * la API espera de vuelta. Por eso se devuelve el string tal cual vino y no el
 * de la config: normalizarlo nosotros sería inventar un formato.
 */
export function elegirNumeroDelWaba(
  numerosDelWaba: unknown,
  numeroDeLaConfig: string | null | undefined,
): ResolucionDeNumero {
  const numeros = Array.isArray(numerosDelWaba)
    ? numerosDelWaba.map((n) => String(n)).filter((n) => soloDigitos(n).length > 0)
    : []

  if (numeros.length === 0) {
    return { ok: false, motivo: "Meta no devolvió ningún número para este WABA." }
  }

  if (numeros.length === 1) {
    // Sin ambigüedad: aunque la config no tenga el número cargado, sólo puede
    // ser ese. Se acepta incluso si no coincide, porque el dato de Meta es más
    // confiable que un campo que se carga a mano.
    return { ok: true, numero: numeros[0], unico: true }
  }

  const buscado = soloDigitos(numeroDeLaConfig)
  if (!buscado) {
    return {
      ok: false,
      motivo:
        "Este WABA tiene varios números y la configuración no tiene cargado el suyo. " +
        "Completá el Número de WhatsApp en la configuración del cliente para poder atribuir los consumos.",
    }
  }

  // Comparación por sufijo en los dos sentidos: Meta puede devolver el número
  // con o sin el prefijo internacional, y la config también. "5491112345678" y
  // "91112345678" son el mismo número escrito distinto.
  const coincidencias = numeros.filter((n) => {
    const d = soloDigitos(n)
    return d === buscado || d.endsWith(buscado) || buscado.endsWith(d)
  })

  if (coincidencias.length === 1) {
    return { ok: true, numero: coincidencias[0], unico: false }
  }

  if (coincidencias.length === 0) {
    return {
      ok: false,
      motivo:
        `El número configurado (${numeroDeLaConfig}) no está entre los de este WABA. ` +
        "Revisá que el Número de WhatsApp de la configuración sea el correcto.",
    }
  }

  return {
    ok: false,
    motivo:
      `El número configurado (${numeroDeLaConfig}) coincide con más de un número del WABA. ` +
      "Cargalo completo, con código de país, para que no haya ambigüedad.",
  }
}
