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

import { useMemo, useState, type ReactNode } from "react"
import { Calendar } from "@/components/ui/calendar"
import { es } from "date-fns/locale"
import { LoadingState } from "@/components/ui/loading-state"
import type { DiaConTurnos } from "@/lib/portal/agenda"
import {
  Aviso,
  BotonPrimario,
  BotonSecundario,
  ResumenDeConfirmacion,
  ResumenDelTurno,
  TituloDePaso,
} from "./marco"

interface Props {
  token: string
  dias: DiaConTurnos[]
  /** Se muestran en el repaso previo a confirmar. */
  paciente?: { nombre?: string; apellido?: string; dni?: string; obraSocial?: string }
  /** URL para volver a editar los datos personales. `null` si no hay nada que editar. */
  corregirDatosEn?: string | null
  etiquetaConfirmar?: string
  /**
   * El título y el contexto de la pantalla de elegir horario (28/9/2026).
   *
   * ── Por qué lo recibe en vez de que lo ponga la página ────────────────────
   *
   * Esto tiene tres pantallas —elegir, repasar, listo— y las tres viven dentro
   * del mismo componente, porque el cambio entre ellas es estado del cliente y
   * no una navegación. La página, que se renderiza en el servidor, dibujaba su
   * encabezado arriba y ya no se enteraba de nada.
   *
   * El resultado lo vio el paciente: al llegar al repaso seguía leyendo "Elegí
   * el nuevo horario" con la tarjeta de su turno viejo y la línea "Horarios
   * disponibles con...", y abajo de todo eso aparecía "Repasá y confirmá". Dos
   * títulos contradictorios en la misma pantalla, y el de arriba —el que el ojo
   * lee primero— era el equivocado.
   *
   * Pasándolo como prop, el encabezado es parte de UNA de las tres pantallas y
   * desaparece con ella. Quien decide qué se ve en cada momento es el que sabe
   * en qué momento está.
   */
  encabezado?: ReactNode
  /**
   * Qué está haciendo el paciente, para que la pantalla final lo diga bien.
   *
   * "Tu turno quedó reservado" después de un cambio de horario no es falso,
   * pero no es lo que pasó: lo que pasó es que su turno se movió. El
   * componente no puede deducirlo —las dos pantallas se ven iguales— así que
   * lo dice quien lo usa.
   */
  accion?: "reservar" | "cambiar"
  /**
   * El turno que este cambio reemplaza (28/9/2026).
   *
   * En el repaso desaparece la tarjeta "Tu turno actual" —es de la pantalla
   * anterior— y el paciente se queda mirando sólo el turno nuevo justo en el
   * momento en que aprieta el botón que cancela el viejo. Una línea que diga
   * cuál se va evita que confirme creyendo que suma un turno en vez de
   * moverlo.
   */
  reemplazaA?: { fechaFormateada?: string; fecha?: string; horaFormateada?: string; hora?: string }
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
  encabezado,
  accion = "reservar",
  reemplazaA,
}: Props) {
  const [diaElegido, setDiaElegido] = useState<string | null>(null)
  const [elegido, setElegido] = useState<Elegido | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hayQueRecargar, setHayQueRecargar] = useState(false)
  // El turno anterior ya se canceló y el nuevo no salió. El paciente está sin
  // turno AHORA, y el título "No pudimos reservarlo" le suena a "no pasó nada".
  const [sinTurno, setSinTurno] = useState(false)
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
      if (datos.sinTurno) setSinTurno(true)
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
        {/* El título dice en qué terminó todo, igual que el aviso de abajo.
            Sin esto la pantalla final quedaba sin encabezado —el de la página
            se fue con el paso anterior— y el paciente pasaba de un título que
            le pedía algo a una pantalla sin ninguno. */}
        <TituloDePaso tipo="listo">
          {accion === "cambiar"
            ? resultado.pendiente
              ? "Pedimos el cambio"
              : "Tu turno cambió"
            : resultado.pendiente
              ? "Pedimos tu turno"
              : "Tu turno quedó reservado"}
        </TituloDePaso>

        {/* "Listo" sólo cuando de verdad está listo. Si la clínica todavía
            tiene que aprobarlo, decir "Listo" hace que el paciente se presente
            un día que puede no tener turno. */}
        <Aviso titulo={resultado.texto} tono={resultado.pendiente ? "neutro" : "exito"} />
        {elegido && (
          <ResumenDelTurno
            turno={{
              fechaFormateada: elegido.fechaFormateada,
              horaFormateada: elegido.hora,
              profesional: elegido.profesional,
              sede: elegido.sede,
            }}
            titulo={
              accion === "cambiar"
                ? resultado.pendiente
                  ? "El turno que pediste"
                  : "Tu turno nuevo"
                : resultado.pendiente
                  ? "El turno que pediste"
                  : "Tu turno"
            }
          />
        )}
        <p className="text-[15px] text-muted-foreground">
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
  const cuandoElViejo = [
    reemplazaA?.fechaFormateada || reemplazaA?.fecha,
    reemplazaA?.horaFormateada || reemplazaA?.hora,
  ]
    .filter(Boolean)
    .join(" a las ")

  if (elegido) {
    return (
      <div className="space-y-4">
        <TituloDePaso tipo="confirmar">Repasá y confirmá</TituloDePaso>

        <ResumenDeConfirmacion
          paciente={{
            nombre: paciente?.nombre,
            apellido: paciente?.apellido,
            dni: paciente?.dni,
            obraSocial: paciente?.obraSocial,
          }}
          turno={{
            fechaFormateada: elegido.fechaFormateada,
            horaFormateada: elegido.hora,
            profesional: elegido.profesional,
            sede: elegido.sede,
            agendaId: elegido.agendaId,
          }}
        />

        {/* Qué turno se va. Es lo único de la pantalla anterior que sigue
            haciendo falta acá: el resto era contexto para elegir, esto es
            contexto para decidir. */}
        {accion === "cambiar" && cuandoElViejo && (
          <p className="text-[15px] text-muted-foreground">
            Reemplaza tu turno del {cuandoElViejo}, que vamos a cancelar.
          </p>
        )}

        {error && (
          <Aviso
            titulo={sinTurno ? "Quedaste sin turno: elegí otro horario" : "No pudimos reservarlo"}
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
                {sinTurno && (
                  <span className="mt-2 block">
                    Si preferís resolverlo con alguien, escribinos por WhatsApp.
                  </span>
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
          <a href={corregirDatosEn} className="block text-[15px] text-muted-foreground underline">
            Corregir mis datos
          </a>
        )}

        <div className="space-y-2">
          <BotonPrimario onClick={confirmar} deshabilitado={enviando}>
            {enviando ? <LoadingState inline label="Reservando…" /> : etiquetaConfirmar}
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
      {encabezado}
      <div className="flex justify-center rounded-xl border bg-card p-1">
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
          // ── Los días se distinguen con estilos, no con clases ───────────
          //
          // Acá había un bug que dejaba el calendario todo del mismo color:
          // `day` traía `text-gray-900` y `day_disabled` traía `text-gray-300`,
          // y las dos clases caen sobre el MISMO elemento. Cuál gana no lo
          // decide el orden en que están escritas sino el orden en que Tailwind
          // las emite en la hoja de estilos — y ahí `text-gray-900` va después.
          // Resultado: los días sin turno se veían igual de negros que los
          // disponibles, con un cartel abajo diciendo "los días con turno están
          // resaltados".
          //
          // La lección: dos clases de Tailwind que pisan la misma propiedad no
          // son una jerarquía, son un empate que resuelve el compilador.
          //
          // Por eso el color de cada estado va por `modifiersStyles`, que son
          // estilos en línea y le ganan a cualquier clase sin ambigüedad.
          classNames={{
            caption_label: "text-base font-medium capitalize text-foreground",
            head_cell: "w-11 text-xs font-normal text-muted-foreground",
            cell: "h-11 w-11 p-0 text-center",
            // Sin color acá: lo pone el modificador que corresponda.
            day: "h-11 w-11 rounded-lg p-0 text-base",
            // El día de hoy sin turnos no debe parecer seleccionable: sólo se
            // marca con un borde.
            day_today: "border border-input",
            // Vacíos para anular los de `components/ui/calendar`, que usan
            // tokens del tema del dashboard (`bg-primary`, `text-muted-
            // foreground`, `opacity-50`). Esos tokens siguen el modo oscuro,
            // que este portal no tiene a propósito, y además el `opacity-50`
            // del deshabilitado se sumaba al gris y lo dejaba casi invisible.
            day_selected: "",
            day_disabled: "",
            day_outside: "",
          }}
          // `disponible` excluye al día ya elegido a propósito: así los tres
          // estados son mutuamente excluyentes y no depende del orden en que
          // react-day-picker aplique los modificadores. Un día no puede estar
          // disponible y elegido a la vez, ni disponible y deshabilitado.
          modifiers={{
            disponible: (fecha) => {
              const iso = aISO(fecha)
              return fechasConAgenda.has(iso) && iso !== diaElegido
            },
          }}
          modifiersStyles={{
            // Con turno: resaltado de verdad —fondo, color de la clínica y
            // negrita—, que es lo que el texto de abajo promete.
            // Los tres van con `hsl(var(--token))` y no con hexadecimales:
            // react-day-picker pide estilos en línea acá, pero las variables
            // son las mismas que usa el resto del portal, así que el día
            // resaltado no puede quedar de un azul distinto al de los botones.
            disponible: {
              background: "hsl(var(--primary) / 0.08)",
              color: "hsl(var(--primary))",
              fontWeight: 600,
            },
            // Sin turno: apagado y claramente no tocable.
            disabled: {
              color: "hsl(var(--muted-foreground) / 0.45)",
              fontWeight: 400,
              background: "transparent",
            },
            // El elegido, lleno.
            selected: {
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              fontWeight: 600,
            },
          }}
        />
      </div>

      {!diaElegido && (
        <p className="text-[15px] text-muted-foreground">
          Los días con turno están resaltados. Tocá uno para ver los horarios.
        </p>
      )}

      {diaElegido && (
        <div className="space-y-2">
          <p className="font-medium capitalize text-foreground">
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
                className="min-h-[56px] rounded-xl border bg-card px-1 py-2 text-base font-medium text-card-foreground hover:bg-accent"
              >
                {turno.hora}
                {turno.profesionalNombre && turno.profesionalNombre !== "Sin asignar" && (
                  <span className="block break-words text-xs font-normal leading-tight text-muted-foreground">
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
