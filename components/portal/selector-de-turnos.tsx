"use client"

/**
 * La selección de horario (22/9/2026).
 *
 * Es el único componente del portal que corre en el navegador, y hace una sola
 * cosa: elegir un horario y mandarlo.
 *
 * ── Dos protecciones contra el mismo error ─────────────────────────────────
 *
 * El paciente toca "Confirmar" y no pasa nada visible durante los cuatro
 * segundos que tarda el proxy. El reflejo es volver a tocar.
 *
 * Por eso el botón se deshabilita en cuanto se envía y el estado cambia a
 * "Reservando…" de inmediato. Y por eso, además, el servidor rechaza el segundo
 * intento aunque llegue: el enlace ya quedó consumido. La protección de la
 * interfaz es por comodidad; la del servidor es la que cuenta.
 */

import { useState } from "react"
import type { DiaConTurnos } from "@/lib/portal/agenda"
import type { MarcaDelPortal } from "@/lib/portal/marca"

interface Props {
  token: string
  dias: DiaConTurnos[]
  marca: MarcaDelPortal
  /** Texto del botón de confirmación. */
  etiquetaConfirmar?: string
}

interface Elegido {
  agendaId: string
  fecha: string
  fechaFormateada: string
  hora: string
  profesional?: string
  sede?: string
}

export function SelectorDeTurnos({ token, dias, marca, etiquetaConfirmar = "Confirmar este horario" }: Props) {
  const [elegido, setElegido] = useState<Elegido | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hayQueRecargar, setHayQueRecargar] = useState(false)
  const [resultado, setResultado] = useState<{ texto: string; aviso?: boolean } | null>(null)

  async function confirmar() {
    if (!elegido || enviando) return
    setEnviando(true)
    setError(null)

    try {
      const r = await fetch("/api/portal/gestionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...elegido }),
      })
      const datos = await r.json()

      if (datos.ok) {
        setResultado({ texto: datos.texto, aviso: datos.avisoCancelacion })
        return
      }

      setError(datos.error || "No pudimos completar la gestión.")
      if (datos.recargar) setHayQueRecargar(true)
    } catch {
      setError("Se cortó la conexión. Revisá tu señal y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <div style={{ border: "1px solid #16a34a", background: "#f0fdf4", borderRadius: 12, padding: 16 }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Listo</p>
        <p style={{ margin: "8px 0 0" }}>{resultado.texto}</p>
        <p style={{ margin: "12px 0 0", color: "#374151", fontSize: 14 }}>
          Te va a llegar la confirmación por WhatsApp.
        </p>
        {resultado.aviso && (
          <p style={{ margin: "12px 0 0", color: "#92400e", fontSize: 14 }}>
            Tu turno anterior puede haber quedado activo. Escribinos por WhatsApp para que lo
            revisemos.
          </p>
        )}
      </div>
    )
  }

  if (dias.length === 0) {
    return (
      <div style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: 16, background: "#fff" }}>
        <p style={{ margin: 0 }}>
          No encontramos horarios disponibles en los próximos días. Escribinos por WhatsApp y
          buscamos una alternativa.
        </p>
      </div>
    )
  }

  return (
    <div>
      {dias.map((dia) => (
        <section key={dia.fecha} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 8px", textTransform: "capitalize" }}>
            {dia.etiqueta}
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {dia.turnos.map((turno) => {
              const seleccionado = elegido?.agendaId === turno.id
              return (
                <button
                  key={turno.id}
                  type="button"
                  onClick={() =>
                    setElegido({
                      agendaId: turno.id,
                      fecha: turno.fecha,
                      fechaFormateada: dia.etiqueta,
                      hora: turno.hora,
                      profesional: turno.profesionalNombre,
                      sede: turno.sedeNombre,
                    })
                  }
                  style={{
                    // 48px de alto: es el mínimo cómodo para un dedo, y este
                    // portal lo usan pacientes mayores en un teléfono.
                    minHeight: 48,
                    minWidth: 92,
                    padding: "12px 16px",
                    borderRadius: 10,
                    fontSize: 16,
                    cursor: "pointer",
                    border: seleccionado ? `2px solid ${marca.colorPrimario}` : "1px solid #d1d5db",
                    background: seleccionado ? marca.colorPrimario : "#fff",
                    color: seleccionado ? "#fff" : "#111827",
                  }}
                >
                  <span style={{ display: "block", fontWeight: 500 }}>{turno.hora}</span>
                  {turno.profesionalNombre && turno.profesionalNombre !== "Sin asignar" && (
                    <span style={{ display: "block", fontSize: 12, opacity: 0.85 }}>
                      {turno.profesionalNombre}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {error && (
        <div style={{ border: "1px solid #dc2626", background: "#fef2f2", borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <p style={{ margin: 0 }}>{error}</p>
          {hayQueRecargar && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid #dc2626", background: "#fff", cursor: "pointer" }}
            >
              Ver los horarios actualizados
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={confirmar}
        disabled={!elegido || enviando}
        style={{
          width: "100%",
          minHeight: 52,
          borderRadius: 12,
          border: "none",
          fontSize: 17,
          fontWeight: 500,
          color: "#fff",
          background: !elegido || enviando ? "#9ca3af" : marca.colorPrimario,
          cursor: !elegido || enviando ? "default" : "pointer",
        }}
      >
        {enviando ? "Reservando…" : elegido ? etiquetaConfirmar : "Elegí un horario"}
      </button>
    </div>
  )
}
