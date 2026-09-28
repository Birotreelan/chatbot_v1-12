"use client"

/**
 * Las tres salidas de un turno, en una sola pantalla (25/9/2026).
 *
 * ── Por qué están juntas ───────────────────────────────────────────────────
 *
 * Por costo. Con el cobro por mensaje, cada vez que el paciente cambia de idea
 * en el chat hay que pagarle otra respuesta: tocó "cancelar", le preguntamos,
 * dijo que sí, le ofrecimos reagendar, dijo que sí, y arrancó otro flujo.
 * Cuatro mensajes para algo que acá son tres botones.
 *
 * Y de paso es mejor: el paciente que toca "Cancelar" porque no puede ese día
 * ve, en el mismo lugar, que puede cambiarlo de horario. En el chat esa opción
 * aparecía recién DESPUÉS de haber cancelado.
 *
 * ── Un solo toque para cancelar ────────────────────────────────────────────
 *
 * Sin pantalla de "¿estás seguro?". El doble chequeo nació porque en el chat un
 * "1" ambiguo podía cancelar sin querer —pasó: una paciente respondió "Jueves
 * 17\n2" y el "1" de "17" se leyó como confirmación—. Acá el turno está a la
 * vista, el botón dice exactamente qué hace y está separado de los otros dos.
 * Ese riesgo no existe igual.
 */

import { useState } from "react"
import { LoadingState } from "@/components/ui/loading-state"
import { Aviso, ResumenDelTurno, TituloDePaso } from "./marco"
import type { TurnoDelPortal } from "@/lib/portal/token"

type Estado = "eligiendo" | "enviando" | "listo"

export function GestionarTurno({
  token,
  turno,
  nombre,
  urlParaReagendar,
}: {
  token: string
  turno?: TurnoDelPortal
  nombre?: string
  /** A dónde lleva "cambiar de horario": el calendario de siempre. */
  urlParaReagendar: string
}) {
  const [estado, setEstado] = useState<Estado>("eligiendo")
  const [resultado, setResultado] = useState<{ accion: string; texto: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decidir(accion: "cancelar" | "confirmar") {
    if (estado === "enviando") return
    setEstado("enviando")
    setError(null)

    try {
      const r = await fetch("/api/portal/decidir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, accion }),
      })
      const datos = await r.json()

      if (datos.ok) {
        setResultado({ accion: datos.accion, texto: datos.texto })
        setEstado("listo")
        return
      }

      setError(datos.error || "No pudimos completar la gestión.")
      setEstado("eligiendo")
    } catch {
      setError("Se cortó la conexión. Revisá tu señal y probá de nuevo.")
      setEstado("eligiendo")
    }
  }

  if (estado === "listo" && resultado) {
    const cancelado = resultado.accion === "cancelar"
    return (
      <div className="space-y-4">
        <Aviso
          titulo={cancelado ? "Turno cancelado" : "Asistencia confirmada"}
          detalle={resultado.texto}
          tono={cancelado ? "neutro" : "exito"}
        />
        {turno && <ResumenDelTurno turno={turno} titulo="El turno" />}
        <p className="text-[15px] text-muted-foreground">
          {cancelado
            ? "Si más adelante querés sacar otro turno, escribinos por WhatsApp."
            : "Te esperamos. Si algo cambia, escribinos por WhatsApp."}
        </p>
      </div>
    )
  }

  const enviando = estado === "enviando"

  return (
    <div className="space-y-4">
      <TituloDePaso tipo="confirmar">
        {nombre ? `${nombre}, ¿qué querés hacer con tu turno?` : "¿Qué querés hacer con tu turno?"}
      </TituloDePaso>

      {turno && <ResumenDelTurno turno={turno} />}

      {error && <Aviso titulo="No pudimos completar la gestión" detalle={error} tono="error" />}

      <div className="space-y-2">
        {/* Primero la opción que conserva el turno para la clínica. Quien vino
            decidido a cancelar baja dos renglones; quien no puede ese día
            encuentra la alternativa antes de cancelar, que en el chat aparecía
            recién después. */}
        <a
          href={urlParaReagendar}
          className="block min-h-[64px] rounded-xl border bg-card px-4 py-3 text-card-foreground no-underline"
        >
          <span className="block font-medium">Cambiarlo de horario</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Elegís otro y este queda libre
          </span>
        </a>

        <button
          type="button"
          onClick={() => decidir("confirmar")}
          disabled={enviando}
          className="block min-h-[64px] w-full rounded-xl border bg-card px-4 py-3 text-left"
        >
          <span className="block font-medium text-card-foreground">Mantenerlo, voy a ir</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Confirmás tu asistencia</span>
        </button>

        {/* Separado del resto y en rojo: es la única acción de esta pantalla
            que el paciente no puede deshacer solo. */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => decidir("cancelar")}
            disabled={enviando}
            className="block min-h-[64px] w-full rounded-xl border border-destructive/50 bg-card px-4 py-3 text-left hover:bg-destructive/5"
          >
            <span className="block font-medium text-destructive">
              {enviando ? <LoadingState inline label="Un momento…" /> : "Cancelar el turno"}
            </span>
            {!enviando && (
              <span className="mt-0.5 block text-sm text-muted-foreground">No voy a poder asistir</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
