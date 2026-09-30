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
  opciones: Array<{
    id: string
    nombre: string
    detalle?: string
    /**
     * La opción se ve pero no se puede elegir (30/9/2026).
     *
     * El caso: un profesional sin agenda en los próximos 60 días. Antes se
     * podía tocar y llevaba a una pantalla con dos mensajes de error
     * encadenados —"no encontramos horarios con esos filtros" y "no hay
     * horarios disponibles"—, o sea que el portal le daba a elegir algo que
     * ya sabía que no iba a funcionar.
     *
     * Se muestra apagada en vez de ocultarla: quien viene buscando a su
     * médico tiene que poder ver que existe y que hoy no tiene turnos. Si
     * desapareciera de la lista, pensaría que se equivocó de clínica.
     */
    deshabilitada?: boolean
  }>
  /** Lo ya elegido en pasos anteriores, para no perderlo. */
  conservar?: Record<string, string>
}) {
  return (
    <div className="space-y-2">
      {opciones.map((opcion) => {
        const params = new URLSearchParams({ ...(conservar || {}), [campo]: opcion.id })

        const contenido = (
          <>
            <span
              aria-hidden
              className={`mr-3 w-1 self-stretch rounded-sm ${
                opcion.deshabilitada ? "bg-muted-foreground/30" : "bg-primary"
              }`}
            />
            <span className="min-w-0">
              <span className="block font-medium">{opcion.nombre}</span>
              {opcion.detalle && (
                <span className="mt-0.5 block text-sm text-muted-foreground sm:text-[15px]">
                  {opcion.detalle}
                </span>
              )}
            </span>
          </>
        )

        // 60px: el paciente lo toca con el pulgar, parado, a veces con poca
        // vista. Un enlace chico acá es una barrera real.
        const forma =
          "flex min-h-[60px] items-center rounded-xl border px-4 py-3 sm:min-h-[56px] sm:px-5"

        if (opcion.deshabilitada) {
          // Un `div` y no un enlace apagado: un `<a>` sigue siendo tocable y
          // navegable con el teclado por más gris que se vea. `aria-disabled`
          // para que el lector de pantalla lo anuncie como no disponible en
          // vez de leerlo como una opción más.
          return (
            <div
              key={opcion.id}
              aria-disabled
              className={`${forma} cursor-not-allowed bg-muted/40 text-muted-foreground`}
            >
              {contenido}
            </div>
          )
        }

        return (
          <Link
            key={opcion.id}
            href={`/p/${token}?${params.toString()}`}
            className={`${forma} bg-card text-card-foreground no-underline transition-colors hover:bg-accent active:bg-accent`}
          >
            {contenido}
          </Link>
        )
      })}
    </div>
  )
}
