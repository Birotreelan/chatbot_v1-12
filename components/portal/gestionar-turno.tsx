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
import { EnlaceDePaso } from "./enlace-de-paso"
import { LoadingState } from "@/components/ui/loading-state"
import { Avance, Aviso, ResumenDelTurno, TituloDePaso } from "./marco"
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
        {/* La pantalla final también lleva título. Sin él, el paciente pasa de
            una que le preguntaba algo a una sin encabezado y tiene que leer el
            aviso para saber qué pasó. */}
        <Avance actual="Confirmar" />
        <TituloDePaso tipo="listo" sinIcono>
          {cancelado ? "Cancelamos tu turno" : "Confirmamos tu asistencia"}
        </TituloDePaso>

        <Aviso titulo={resultado.texto} tono={cancelado ? "neutro" : "exito"} />
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
      <Avance actual="Elegir" />
      <TituloDePaso
        tipo="confirmar"
        sinIcono
        detalle="Seleccioná una de las opciones. Ninguna se aplica hasta que la elijas."
      >
        {nombre ? `${nombre}, ¿qué querés hacer con tu turno?` : "¿Qué querés hacer con tu turno?"}
      </TituloDePaso>

      {error && <Aviso titulo="No pudimos completar la gestión" detalle={error} tono="error" />}

      <div className="space-y-2">
        {/* Primero la opción que conserva el turno para la clínica. Quien vino
            decidido a cancelar baja dos renglones; quien no puede ese día
            encuentra la alternativa antes de cancelar, que en el chat aparecía
            recién después. */}
        <EnlaceDePaso
          href={urlParaReagendar}
          className="block min-h-[64px] rounded-xl border border-primary/50 bg-card px-4 py-3 text-card-foreground no-underline transition-colors hover:bg-primary/5 sm:min-h-[60px] sm:px-5"
        >
          <span className="block font-medium text-primary">Cambiarlo de horario</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Elegís otro y este queda libre
          </span>
        </EnlaceDePaso>

        <button
          type="button"
          onClick={() => decidir("confirmar")}
          disabled={enviando}
          className="block min-h-[64px] w-full rounded-xl border border-secondary/50 bg-card px-4 py-3 text-left transition-colors hover:bg-secondary/5 sm:min-h-[60px] sm:px-5"
        >
          <span className="block font-medium text-secondary">Mantenerlo, voy a ir</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">Confirmás tu asistencia</span>
        </button>

        {/* Separado del resto y en rojo: es la única acción de esta pantalla
            que el paciente no puede deshacer solo. */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => decidir("cancelar")}
            disabled={enviando}
            className="block min-h-[64px] w-full rounded-xl border border-destructive/50 bg-card px-4 py-3 text-left transition-colors hover:bg-destructive/5 sm:min-h-[60px] sm:px-5"
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

      {/* ── El turno, DEBAJO de las opciones (30/9/2026) ──────────────────
          Estaba arriba y empujaba las tres opciones fuera de la primera
          pantalla: el paciente abría el enlace y lo primero que veía era el
          turno que ya conoce, con lo que vino a hacer más abajo.

          Acá abajo sigue estando para verificar —"¿es este el turno?"— pero
          no le gana el lugar a la decisión, que es lo que la pantalla pide.

          Los tres colores no son decoración: verde la que conserva el turno,
          azul la alternativa, rojo la única que el paciente no puede deshacer
          solo. Son los mismos tres del resto del portal. */}
      {turno && <ResumenDelTurno turno={turno} titulo="El turno del que hablamos" />}
    </div>
  )
}
