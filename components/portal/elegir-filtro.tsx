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
 * El estado vive en la query string y no en el token: lo que el paciente está
 * eligiendo todavía no es una decisión, y si lo guardáramos en Redis habría que
 * limpiarlo cuando abandona a mitad de camino.
 *
 * Son tarjetas y no una lista con viñetas, igual que el widget: cada opción es
 * una superficie tocable con su nombre y, si la hay, una aclaración debajo.
 */

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
          <a
            key={opcion.id}
            href={`/p/${token}?${params.toString()}`}
            // 60px: el paciente lo toca con el pulgar, parado, a veces con poca
            // vista. Un enlace chico acá es una barrera real.
            className="flex min-h-[60px] items-center rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-900 no-underline"
          >
            <span
              aria-hidden
              className="mr-3 w-1 self-stretch rounded-sm"
              style={{ background: "var(--marca)" }}
            />
            <span className="min-w-0">
              <span className="block font-medium">{opcion.nombre}</span>
              {opcion.detalle && (
                <span className="mt-0.5 block text-sm text-gray-500">{opcion.detalle}</span>
              )}
            </span>
          </a>
        )
      })}
    </div>
  )
}
