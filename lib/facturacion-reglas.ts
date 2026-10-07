/**
 * Las reglas de cálculo de la facturación, con su vigencia (7/10/2026).
 *
 * ── Por qué un registro y no una frase en la pantalla ──────────────────────
 *
 * El pedido fue que en el panel se vea que hasta septiembre 2026 el cálculo era
 * otro. Lo directo sería escribir esa oración en el componente. No sirve,
 * porque ya sabemos que van a venir más cambios: a la tercera, la pantalla
 * tendría tres `if` con fechas sueltas, y el día que uno quede viejo el panel
 * va a explicar mal lo que muestra — peor que no explicar nada, porque se le
 * cree.
 *
 * Acá cada regla está declarada una vez, con desde cuándo rige y qué cambió
 * respecto de la anterior. La pantalla no sabe ninguna fecha: pregunta qué
 * regla corresponde al mes que está mostrando y muestra su descripción. Agregar
 * un cambio futuro es agregar una entrada a esta lista, y el panel se actualiza
 * solo.
 *
 * ── Sin dependencias de servidor ───────────────────────────────────────────
 *
 * Este módulo lo importa el componente del dashboard, que corre en el
 * navegador. Por eso vive separado de `facturacion-cierre.ts`, que usa Redis:
 * importar aquél desde el cliente arrastraría todo el cliente de Redis al
 * bundle.
 */

export type ReglaDeCalculo =
  /** Hasta septiembre 2026: facturable + conversaciones iniciadas. */
  | "con_conversaciones"
  /** Desde octubre 2026: sólo lo que Meta cobra por mandar. */
  | "solo_enviados"

export interface ReglaDeFacturacion {
  /**
   * Identifica la FÓRMULA, y es lo que se guarda en el cierre de cada mes.
   *
   * Si alguna vez se vuelve a una fórmula anterior, se reusa su id: el cierre
   * tiene que poder decir con qué se calculó, y para eso la fórmula alcanza. El
   * tramo de vigencia lo marca `desde`.
   */
  id: ReglaDeCalculo
  /** Primer período en que rige, "YYYY-MM". La primera lleva "" (siempre rigió). */
  desde: string
  /** Para el encabezado: "Vigente desde octubre 2026". */
  nombre: string
  /** Qué se cuenta. Es lo que se le explica al cliente si pregunta. */
  queSeCuenta: string
  /** Qué cambió respecto de la regla anterior. Vacío en la primera. */
  queCambio?: string
}

/**
 * En orden cronológico. La última que arranca en un período menor o igual al
 * que se mira es la que rige.
 */
export const REGLAS: ReglaDeFacturacion[] = [
  {
    id: "con_conversaciones",
    desde: "",
    nombre: "Hasta septiembre 2026",
    queSeCuenta:
      "Mensajes facturables de WhatsApp (plantillas + mensajes de servicio con cargo) MÁS las conversaciones iniciadas por los pacientes.",
  },
  {
    id: "solo_enviados",
    desde: "2026-10",
    nombre: "Desde octubre 2026",
    queSeCuenta:
      "Todos los mensajes enviados por WhatsApp: recordatorios (plantillas) + mensajes de servicio, tengan cargo de Meta o no.",
    queCambio:
      "Dos cambios. Dejaron de contarse las conversaciones iniciadas por los pacientes: WhatsApp cobra los mensajes que se envían, no los que entran. Y empezaron a contarse todos los mensajes de servicio, incluidos los que caen en la franja sin cargo de Meta.",
  },
]

/** Qué regla rige para este período ("YYYY-MM"). */
export function reglaDelPeriodo(periodo: string): ReglaDeFacturacion {
  // De la más nueva a la más vieja: la primera que ya haya arrancado es la que
  // rige. Recorrerlo al revés evita tener que comparar con la siguiente.
  for (let i = REGLAS.length - 1; i >= 0; i--) {
    if (periodo >= REGLAS[i].desde) return REGLAS[i]
  }
  return REGLAS[0]
}

/** El id, para guardarlo en el cierre. */
export function idDeLaReglaDelPeriodo(periodo: string): ReglaDeCalculo {
  return reglaDelPeriodo(periodo).id
}

export function reglaPorId(id: string): ReglaDeFacturacion | undefined {
  return REGLAS.find((r) => r.id === id)
}

/**
 * `true` si este período NO usa la regla vigente hoy.
 *
 * Compara por `desde` y no por `id`. La diferencia importa: el id identifica la
 * FÓRMULA y dos reglas distintas podrían compartirla —volver a una anterior,
 * por ejemplo—, mientras que `desde` identifica el tramo de vigencia, que es
 * justo lo que acá se pregunta. Comparando por id, un período viejo con la
 * misma fórmula que la actual se mostraría como vigente y nadie se enteraría de
 * que hubo un cambio en el medio.
 */
export function esReglaAnterior(periodo: string): boolean {
  const ultima = REGLAS[REGLAS.length - 1]
  return reglaDelPeriodo(periodo).desde !== ultima.desde
}
