"use client"

/**
 * La selección de horario (22/9/2026; calendario desde el 24/9).
 *
 * ── Por qué un calendario y no una lista ───────────────────────────────────
 *
 * La búsqueda mira 60 días. Una clínica con agenda floja devuelve treinta
 * horarios repartidos en doce días, y la lista plana obliga a scrollear doce
 * encabezados para descubrir cuáles son. El calendario muestra el mes entero de
 * un vistazo, con los días sin agenda apagados: el paciente ve dónde hay antes
 * de tocar nada.
 *
 * Es el mismo control que usa el widget web, por el mismo motivo y con el mismo
 * componente (`components/ui/calendar`). Si mañana se arregla algo ahí, se
 * arregla en los dos lados.
 *
 * ── Lo que se pierde, dicho de frente ──────────────────────────────────────
 *
 * Los pasos de filtro del portal son enlaces y funcionan sin JavaScript. Esto
 * no: el calendario lo necesita. Se aceptó a sabiendas —el navegador interno de
 * WhatsApp ejecuta JS sin problema— pero es una propiedad que esta pantalla ya
 * no tiene.
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

import { useMemo, useState } from "react"
import { Calendar } from "@/components/ui/calendar"
import { es } from "date-fns/locale"
import { Loader2 } from "lucide-react"
import type { DiaConTurnos } from "@/lib/portal/agenda"
import { Aviso, BotonPrimario, BotonSecundario, ResumenDelTurno, TituloDePaso } from "./marco"

interface Props {
  token: string
  dias: DiaConTurnos[]
  /** Se muestran en el repaso previo a confirmar. */
  paciente?: { nombre?: string; obraSocial?: string }
  /** URL para volver a editar los datos personales. `null` si no hay nada que editar. */
  corregirDatosEn?: string | null
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

function aFecha(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function aISO(fecha: Date): string {
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${fecha.getFullYear()}-${m}-${d}`
}

export function SelectorDeTurnos({
  token,
  dias,
  paciente,
  corregirDatosEn,
  etiquetaConfirmar = "Confirmar este horario",
}: Props) {
  const [diaElegido, setDiaElegido] = useState<string | null>(null)
  const [elegido, setElegido] = useState<Elegido | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hayQueRecargar, setHayQueRecargar] = useState(false)
  const [resultado, setResultado] = useState<{
    texto: string
    aviso?: boolean
    pendiente?: boolean
  } | null>(null)

  const fechasConAgenda = useMemo(() => new Set(dias.map((d) => d.fecha)), [dias])
  const primerDia = dias[0]?.fecha
  const turnosDelDia = dias.find((d) => d.fecha === diaElegido)?.turnos || []

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
        setResultado({
          texto: datos.texto,
          aviso: datos.avisoCancelacion,
          pendiente: datos.pendienteDeAprobacion === true,
        })
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

  // ── Listo ────────────────────────────────────────────────────────────────
  if (resultado) {
    return (
      <div className="space-y-4">
        {/* "Listo" sólo cuando de verdad está listo. Si la clínica todavía
            tiene que aprobarlo, decir "Listo" hace que el paciente se presente
            un día que puede no tener turno. */}
        <Aviso
          titulo={resultado.pendiente ? "Tu solicitud fue enviada" : "Listo"}
          detalle={resultado.texto}
          tono={resultado.pendiente ? "neutro" : "exito"}
        />
        {elegido && (
          <ResumenDelTurno
            turno={{
              fechaFormateada: elegido.fechaFormateada,
              horaFormateada: elegido.hora,
              profesional: elegido.profesional,
              sede: elegido.sede,
            }}
            titulo={resultado.pendiente ? "El turno que pediste" : "Tu turno"}
          />
        )}
        <p className="text-[15px] text-gray-600">
          {resultado.pendiente
            ? "Te avisamos por WhatsApp apenas la clínica la apruebe."
            : "Te va a llegar la confirmación por WhatsApp."}
        </p>
        {resultado.aviso && (
          <Aviso
            titulo="Revisemos tu turno anterior"
            detalle="Puede haber quedado activo. Escribinos por WhatsApp y lo cancelamos."
            tono="atencion"
          />
        )}
      </div>
    )
  }

  if (dias.length === 0) {
    return (
      <Aviso
        titulo="No hay horarios disponibles"
        detalle="No encontramos turnos en los próximos días. Escribinos por WhatsApp y buscamos una alternativa."
        tono="atencion"
      />
    )
  }

  // ── Repasar y confirmar ──────────────────────────────────────────────────
  //
  // Una pantalla aparte, como en el widget. Reservar un turno médico es
  // irreversible para el paciente: que lo último que vea antes de confirmar sea
  // la hora suelta que tocó, sin el profesional ni la sede, es pedirle que
  // confirme a ciegas.
  if (elegido) {
    return (
      <div className="space-y-4">
        <TituloDePaso tipo="confirmar">Repasá y confirmá</TituloDePaso>

        <ResumenDelTurno
          turno={{
            fechaFormateada: elegido.fechaFormateada,
            horaFormateada: elegido.hora,
            profesional: elegido.profesional,
            sede: elegido.sede,
          }}
          extras={[
            ["Paciente", paciente?.nombre],
            ["Obra social", paciente?.obraSocial],
          ]}
        />

        {error && (
          <Aviso
            titulo="No pudimos reservarlo"
            detalle={
              <>
                {error}
                {hayQueRecargar && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-2 block underline"
                  >
                    Ver los horarios actualizados
                  </button>
                )}
              </>
            }
            tono="error"
          />
        )}

        {/* Corregir los datos, desde el único lugar donde el paciente los ve
            todos juntos. El flujo conversacional ofrece acá "2. No, modificar";
            sin esto, quien se equivocó un dígito del DNI al darse de alta veía
            el error en el resumen y no tenía cómo arreglarlo. */}
        {corregirDatosEn && !enviando && (
          <a href={corregirDatosEn} className="block text-[15px] text-gray-500 underline">
            Corregir mis datos
          </a>
        )}

        <div className="space-y-2">
          <BotonPrimario onClick={confirmar} deshabilitado={enviando}>
            {enviando ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Reservando…
              </span>
            ) : (
              etiquetaConfirmar
            )}
          </BotonPrimario>
          {!enviando && (
            <BotonSecundario onClick={() => setElegido(null)}>Elegir otro horario</BotonSecundario>
          )}
        </div>
      </div>
    )
  }

  // ── Elegir día y hora ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex justify-center rounded-xl border border-gray-200 bg-white p-1">
        <Calendar
          mode="single"
          locale={es}
          defaultMonth={primerDia ? aFecha(primerDia) : undefined}
          selected={diaElegido ? aFecha(diaElegido) : undefined}
          onSelect={(fecha) => {
            if (!fecha) return
            setDiaElegido(aISO(fecha))
          }}
          // Los días sin agenda quedan apagados y no se pueden tocar. Es la
          // mitad del valor del calendario: se ve dónde hay antes de tocar.
          disabled={(fecha) => !fechasConAgenda.has(aISO(fecha))}
          // ── Dos correcciones sobre el calendario del dashboard ───────────
          //
          // 1. Celdas de 44px en vez de 36px. El resto del portal no baja de
          //    48px porque lo usan pacientes mayores en un teléfono; un
          //    calendario con celdas de 36 sería el único lugar donde alguien
          //    toca el día equivocado.
          //
          // 2. Colores explícitos en vez de los tokens del tema
          //    (`bg-primary`, `text-muted-foreground`). Esos tokens siguen el
          //    tema del dashboard, modo oscuro incluido. El portal es de un
          //    solo tema claro a propósito —el navegador interno de WhatsApp
          //    maneja el modo oscuro de forma inconsistente y un contraste roto
          //    acá deja a alguien sin poder sacar un turno—, así que el
          //    calendario tiene que respetar esa decisión igual que el resto.
          classNames={{
            caption_label: "text-base font-medium capitalize text-gray-900",
            head_cell: "w-11 text-xs font-normal text-gray-500",
            cell: "h-11 w-11 p-0 text-center",
            day: "h-11 w-11 rounded-lg p-0 text-base font-normal text-gray-900 hover:bg-gray-100",
            day_selected: "text-white hover:opacity-90",
            // El día de hoy sin turnos no debe parecer seleccionable: sólo se
            // marca con un borde.
            day_today: "border border-gray-300",
            day_disabled: "text-gray-300 hover:bg-transparent",
            day_outside: "text-gray-300",
          }}
          modifiersStyles={{
            // El color de la clínica. Va por `modifiersStyles` y no por clase
            // porque sale de la configuración de cada cliente.
            selected: { background: "var(--marca)", color: "#fff" },
          }}
        />
      </div>

      {!diaElegido && (
        <p className="text-[15px] text-gray-500">
          Los días con turno están resaltados. Tocá uno para ver los horarios.
        </p>
      )}

      {diaElegido && (
        <div className="space-y-2">
          <p className="font-medium capitalize text-gray-700">
            {dias.find((d) => d.fecha === diaElegido)?.etiqueta}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {turnosDelDia.map((turno) => (
              <button
                key={turno.id}
                type="button"
                onClick={() =>
                  setElegido({
                    agendaId: turno.id,
                    fecha: turno.fecha,
                    fechaFormateada: dias.find((d) => d.fecha === diaElegido)?.etiqueta || turno.fecha,
                    hora: turno.hora,
                    profesional: turno.profesionalNombre,
                    sede: turno.sedeNombre,
                  })
                }
                // 56px de alto: lo toca con el pulgar alguien parado, y este
                // portal lo usan pacientes mayores.
                className="min-h-[56px] rounded-xl border border-gray-200 bg-white px-1 py-2 text-base font-medium text-gray-800"
              >
                {turno.hora}
                {turno.profesionalNombre && turno.profesionalNombre !== "Sin asignar" && (
                  <span className="block break-words text-xs font-normal leading-tight text-gray-500">
                    {turno.profesionalNombre}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
