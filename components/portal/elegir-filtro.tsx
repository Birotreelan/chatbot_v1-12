/**
 * Elegir una especialidad o un profesional (22/9/2026).
 *
 * Son enlaces, no botones con JavaScript. Tres motivos, y los tres importan
 * para el público que abre esto:
 *
 *  - Funciona aunque el JavaScript falle o tarde, que en el navegador interno
 *    de WhatsApp con señal mala pasa.
 *  - El botón "atrás" del teléfono hace lo que el paciente espera: volver al
 *    paso anterior. Con estado en memoria, lo sacaría del portal.
 *  - Cada paso tiene su propia URL, así que recargar no pierde lo elegido.
 *
 * ── `Link` y no `<a>` (28/9/2026) ─────────────────────────────────────────
 *
 * Con `<a>` cada paso era una recarga completa: pantalla en blanco, la banda
 * de la clínica desapareciendo y volviendo a aparecer, el desplazamiento
 * perdido. En un recorrido de cinco pasos eso son cinco parpadeos, y cada uno
 * es una oportunidad de que alguien que ya salió de WhatsApp para sacar un
 * turno crea que algo se rompió y cierre.
 *
 * `Link` navega del lado del cliente: la página se reemplaza sin recargar el
 * documento. Las tres propiedades de arriba se conservan —sigue siendo un
 * ancla real, con su `href`, que funciona con JavaScript apagado y que el
 * botón "atrás" entiende—.
 *
 * El estado vive en la query string y no en el token: lo que el paciente está
 * eligiendo todavía no es una decisión, y si lo guardáramos en Redis habría que
 * limpiarlo cuando abandona a mitad de camino.
 *
 * Son tarjetas y no una lista con viñetas, igual que el widget: cada opción es
 * una superficie tocable con su nombre y, si la hay, una aclaración debajo.
 */

import Link from "next/link"

export function ElegirFiltro({
  token,
  campo,
  opciones,
  conservar,
}: {
  token: string
  campo: "sedeId" | "tipoBusqueda" | "especialidadId" | "profesionalId"
  opciones: Array<{ id: string; nombre: string; detalle?: string }>
  /** Lo ya elegido en pasos anteriores, para no perderlo. */
  conservar?: Record<string, string>
}) {
  return (
    <div className="space-y-2">
      {opciones.map((opcion) => {
        const params = new URLSearchParams({ ...(conservar || {}), [campo]: opcion.id })
        return (
          <Link
            key={opcion.id}
            href={`/p/${token}?${params.toString()}`}
            // 60px: el paciente lo toca con el pulgar, parado, a veces con poca
            // vista. Un enlace chico acá es una barrera real.
            className="flex min-h-[60px] items-center rounded-xl border bg-card px-4 py-3 text-card-foreground no-underline transition-colors hover:bg-accent active:bg-accent sm:min-h-[56px] sm:px-5"
          >
            <span
              aria-hidden
              className="mr-3 w-1 self-stretch rounded-sm bg-primary"
            />
            <span className="min-w-0">
              <span className="block font-medium">{opcion.nombre}</span>
              {opcion.detalle && (
                <span className="mt-0.5 block text-sm text-muted-foreground sm:text-[15px]">{opcion.detalle}</span>
              )}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
