/**
 * Qué consultó esta pantalla del portal y qué le contestaron (28/10/2026).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Cuando una pantalla muestra "Sin turnos disponibles por ahora" hay como
 * cinco explicaciones posibles —la obra social, el deudor Particular que la
 * clínica llama de otra forma, un filtro que el proxy ignora, una agenda
 * realmente vacía— y desde afuera son indistinguibles. El log de Vercel
 * muestra los parámetros que se enviaron, pero no lo que volvió: la respuesta
 * cruda sólo se vuelca cuando vienen cero turnos.
 *
 * Esto junta las dos mitades y las pone en la pantalla.
 *
 * ── Un objeto por request, no una variable de módulo ───────────────────────
 *
 * Es lo único que hace que esto sea seguro. Una variable de módulo en un
 * servidor que atiende varias peticiones a la vez mezclaría la consulta de un
 * paciente con la de otro, y acá lo que se mezclaría son fichas médicas. El
 * recolector se crea en la página, se pasa explícitamente a quien tenga algo
 * que anotar, y muere con la respuesta.
 *
 * Por eso también el parámetro es opcional en todos lados: si nadie pasa un
 * recolector, no se anota nada y no cuesta nada.
 *
 * ── Qué NO hace ────────────────────────────────────────────────────────────
 *
 * No consulta. Anota lo que las consultas de la página ya hicieron. Un panel
 * que repitiera las llamadas mostraría una segunda respuesta, que puede ser
 * distinta de la que se usó para dibujar — y entonces estaríamos depurando
 * otra cosa.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface AnotacionDeDiagnostico {
  /** "get_turnos (obra social)", "deudor particular", "ficha por DNI"… */
  titulo: string
  /** Lo que se mandó. */
  parametros?: Record<string, unknown>
  /** Una línea con lo que volvió: "230 turnos", "sin coincidencia exacta". */
  resumen?: string
  /** La respuesta, o una muestra. Se recorta: un día entero de agenda son cientos de KB. */
  crudo?: unknown
  /** Cuánto tardó, en ms. Útil cuando la pantalla tarda y no se sabe en qué. */
  ms?: number
}

export interface Diagnostico {
  anotar(a: AnotacionDeDiagnostico): void
  anotaciones: AnotacionDeDiagnostico[]
}

/**
 * El recolector de ESTE pedido, para que no haya que pasarlo de mano en mano.
 *
 * ── Por qué hizo falta ─────────────────────────────────────────────────────
 *
 * La primera versión pasaba el recolector como parámetro. Funciona, pero sólo
 * anota donde alguien se acordó de enchufarlo: la agenda sí, las sedes sí, y
 * cualquier consulta que se agregue mañana no. Y el pedido fue justamente
 * "todas las llamadas a APIs externas".
 *
 * `AsyncLocalStorage` guarda el recolector para toda la cadena de llamadas de
 * una petición, incluidas las asíncronas. Así `fetchProxyApi` —el embudo por
 * donde pasan TODAS las consultas al sistema de la clínica— lo encuentra solo,
 * sin recibirlo por parámetro y sin que ningún llamador tenga que saber que
 * existe.
 *
 * Sigue siendo por pedido, no global: cada petición tiene su propio
 * almacenamiento. Dos pacientes a la vez no se mezclan — que es lo que haría
 * una variable de módulo, y lo que acá se mezclaría son fichas médicas.
 */
const almacen = new AsyncLocalStorage<Diagnostico>()

/** Corre `fn` con este recolector activo para toda su cadena de llamadas. */
export function conDiagnostico<T>(diagnostico: Diagnostico | undefined, fn: () => T): T {
  return diagnostico ? almacen.run(diagnostico, fn) : fn()
}

/**
 * Enciende el recolector para lo que reste de este pedido.
 *
 * `enterWith` en vez de `run(fn)` porque el componente del portal es una
 * función larga con una docena de salidas, y envolver todo su cuerpo en un
 * callback para esto sería reescribirla entera. La contrapartida está dicha:
 * `enterWith` afecta al contexto actual en adelante, así que hay que llamarlo
 * UNA vez y temprano. Se llama desde la página, apenas se decide que el modo
 * está habilitado.
 */
export function activarDiagnostico(diagnostico: Diagnostico): void {
  almacen.enterWith(diagnostico)
}

/** El recolector del pedido en curso, si el modo diagnóstico está encendido. */
export function diagnosticoActual(): Diagnostico | undefined {
  return almacen.getStore()
}

/** Un recolector nuevo, vacío. */
export function crearDiagnostico(): Diagnostico {
  const anotaciones: AnotacionDeDiagnostico[] = []
  return {
    anotaciones,
    anotar(a) {
      anotaciones.push(a)
    },
  }
}

/**
 * Mide y anota de una sola vez.
 *
 * Devuelve lo que devuelva la función, así se puede envolver una llamada sin
 * cambiar su forma: `const x = await medir(diag, "…", () => consulta(), r => …)`.
 */
export async function medir<T>(
  diagnostico: Diagnostico | undefined,
  titulo: string,
  parametros: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
  describir?: (resultado: T) => { resumen?: string; crudo?: unknown },
): Promise<T> {
  if (!diagnostico) return fn()

  const desde = Date.now()
  try {
    const resultado = await fn()
    const extra = describir ? describir(resultado) : {}
    diagnostico.anotar({ titulo, parametros, ms: Date.now() - desde, ...extra })
    return resultado
  } catch (error) {
    diagnostico.anotar({
      titulo,
      parametros,
      ms: Date.now() - desde,
      resumen: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    })
    throw error
  }
}

/**
 * Recorta cualquier cosa a algo que entre en una pantalla.
 *
 * Los arreglos se cortan a `maxItems` y se dice cuántos había: para entender
 * la forma de un turno alcanza con uno, y volcar doscientos convierte el panel
 * en un muro ilegible, que es la forma más común de que una herramienta de
 * diagnóstico no se use.
 */
export function muestra(valor: unknown, maxItems = 2, maxChars = 1500): unknown {
  try {
    if (Array.isArray(valor)) {
      const recorte = valor.slice(0, maxItems)
      return valor.length > maxItems
        ? { total: valor.length, primeros: recorte, nota: `… y ${valor.length - maxItems} más` }
        : { total: valor.length, items: recorte }
    }
    const texto = JSON.stringify(valor)
    if (texto && texto.length > maxChars) {
      return { recortado: true, muestra: texto.slice(0, maxChars) + "…" }
    }
    return valor
  } catch {
    return "(no se pudo serializar)"
  }
}
