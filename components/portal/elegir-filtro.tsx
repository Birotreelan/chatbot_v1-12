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
 */

import type { MarcaDelPortal } from "@/lib/portal/marca"

export function ElegirFiltro({
  token,
  campo,
  opciones,
  marca,
  conservar,
}: {
  token: string
  campo: "especialidadId" | "profesionalId"
  opciones: Array<{ id: string; nombre: string }>
  marca: MarcaDelPortal
  /** Lo ya elegido en pasos anteriores, para no perderlo. */
  conservar?: Record<string, string>
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {opciones.map((opcion) => {
        const params = new URLSearchParams({ ...(conservar || {}), [campo]: opcion.id })
        return (
          <a
            key={opcion.id}
            href={`/p/${token}?${params.toString()}`}
            style={{
              // 56px: el paciente lo toca con el pulgar, parado, a veces con
              // poca vista. Un enlace chico acá es una barrera real.
              minHeight: 56,
              display: "flex",
              alignItems: "center",
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#111827",
              textDecoration: "none",
              fontSize: 16,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 4,
                alignSelf: "stretch",
                borderRadius: 2,
                background: marca.colorPrimario,
                marginRight: 12,
              }}
            />
            {opcion.nombre}
          </a>
        )
      })}
    </div>
  )
}
