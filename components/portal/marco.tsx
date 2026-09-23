/**
 * El marco visual del portal (22/9/2026).
 *
 * ── Por qué no usa los componentes del dashboard ───────────────────────────
 *
 * Porque el público es otro. El dashboard lo usan agentes entrenados en una
 * computadora; esto lo abre un paciente de oftalmología, muchas veces mayor,
 * en el navegador interno de WhatsApp, en un teléfono, posiblemente con
 * dificultad para ver.
 *
 * De ahí las decisiones: tipografía grande, un solo tema claro sin modo oscuro
 * —el navegador interno de WhatsApp lo maneja de forma inconsistente y un
 * contraste roto acá deja a alguien sin poder sacar un turno—, áreas tocables
 * generosas y una sola cosa por pantalla.
 */

import type { ReactNode } from "react"
import type { MarcaDelPortal } from "@/lib/portal/marca"
import type { TurnoDelPortal } from "@/lib/portal/token"

export function Marco({
  marca,
  children,
  cookieNueva,
  nombreCookie,
}: {
  marca: MarcaDelPortal
  children: ReactNode
  /** Se emite en la primera visita, para reconocer el dispositivo después. */
  cookieNueva?: string | null
  nombreCookie?: string
}) {
  return (
    <div style={{ minHeight: "100vh", background: marca.colorSecundario, color: "#111827" }}>
      {/* La cookie se escribe desde el cliente y no con Set-Cookie porque esta
          página se renderiza como Server Component sin acceso a la respuesta.
          Es un secreto de reconocimiento, no una credencial: si el navegador la
          descarta, el paciente entra igual. */}
      {cookieNueva && nombreCookie && (
        <script
          dangerouslySetInnerHTML={{
            __html: `document.cookie=${JSON.stringify(
              `${nombreCookie}=${cookieNueva}; Path=/p; Max-Age=2592000; SameSite=Lax`,
            )}`,
          }}
        />
      )}

      <header style={{ background: marca.colorPrimario, padding: "20px 16px" }}>
        <p style={{ margin: 0, color: "#fff", fontSize: 18, fontWeight: 500 }}>{marca.clinica}</p>
        <p style={{ margin: "4px 0 0", color: "#fff", opacity: 0.9, fontSize: 14 }}>Gestión de turnos</p>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 48px", fontSize: 16, lineHeight: 1.6 }}>
        {children}
      </main>

      <footer style={{ padding: "0 16px 32px", maxWidth: 560, margin: "0 auto" }}>
        <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
          Si algo no funciona, escribinos por WhatsApp y lo resolvemos.
        </p>
      </footer>
    </div>
  )
}

export function Aviso({
  titulo,
  detalle,
  tono = "neutro",
}: {
  titulo: string
  detalle?: string
  tono?: "neutro" | "exito" | "error"
}) {
  const borde = tono === "exito" ? "#16a34a" : tono === "error" ? "#dc2626" : "#d1d5db"
  const fondo = tono === "exito" ? "#f0fdf4" : tono === "error" ? "#fef2f2" : "#fff"

  return (
    <div style={{ border: `1px solid ${borde}`, background: fondo, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{titulo}</p>
      {detalle && <p style={{ margin: "8px 0 0", color: "#374151" }}>{detalle}</p>}
    </div>
  )
}

export function ResumenDelTurno({ turno, titulo }: { turno: TurnoDelPortal; titulo?: string }) {
  const filas: Array<[string, string | undefined]> = [
    ["Fecha", turno.fechaFormateada || turno.fecha],
    ["Hora", turno.horaFormateada || turno.hora],
    ["Profesional", turno.profesional],
    ["Sede", turno.sede],
    ["Dirección", turno.direccion],
  ]

  const visibles = filas.filter(([, valor]) => !!valor)
  if (visibles.length === 0) return null

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff", marginBottom: 16 }}>
      {titulo && <p style={{ margin: "0 0 12px", fontWeight: 500 }}>{titulo}</p>}
      {visibles.map(([etiqueta, valor]) => (
        <div key={etiqueta} style={{ display: "flex", gap: 12, padding: "4px 0" }}>
          <span style={{ color: "#6b7280", minWidth: 96 }}>{etiqueta}</span>
          <span>{valor}</span>
        </div>
      ))}
    </div>
  )
}
