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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Calendar } from "@/components/ui/calendar"
import { es } from "date-fns/locale"
import { LoadingState } from "@/components/ui/loading-state"
import type { DiaConTurnos } from "@/lib/portal/agenda"
import {
  Avance,
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
  /**
   * Dirección de cada sede, por id.
   *
   * La agenda devuelve el nombre de la sede pero no su domicilio, y con varias
   * sedes de la misma institución el nombre solo no dice a dónde ir. Se
   * resuelve por el `sedeId` del turno que el paciente eligió —no por el
   * filtro— porque quien buscó sin elegir sede puede terminar en cualquiera.
   * Sin entrada para esa sede, la fila no se muestra.
   */
  direccionesPorSede?: Record<string, string>
}

interface Elegido {
  agendaId: string
  fecha: string
  fechaFormateada: string
  hora: string
  profesional?: string
  sede?: string
  direccion?: string
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
  direccionesPorSede,
}: Props) {
  const router = useRouter()
  const [diaElegido, setDiaElegido] = useState<string | null>(null)
  const horariosRef = useRef<HTMLDivElement | null>(null)
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

  // Se mira el día que se está mostrando, no toda la agenda: un día puede ser
  // de un solo profesional y el siguiente de tres.
  const variosProfesionales =
    new Set(turnosDelDia.map((t) => t.profesionalNombre).filter(Boolean)).size > 1

  // ── Llevar la pantalla a los horarios al elegir un día (28/9/2026) ────────
  //
  // El calendario ocupa casi toda la pantalla de un teléfono. Al tocar un día,
  // los horarios aparecen DEBAJO del pliegue: el paciente ve que el día quedó
  // marcado, no pasa nada más a la vista, y se queda esperando o vuelve a
  // tocar. La grilla estaba ahí todo el tiempo, abajo.
  //
  // `scroll-mt-24` en el contenedor y no un cálculo de posición: el
  // encabezado es `sticky`, así que sin ese margen el título del día queda
  // tapado justo por la banda azul y el paciente aterriza en una grilla de
  // horas sin saber de qué día son.
  //
  // `prefers-reduced-motion` se respeta: un desplazamiento animado le revuelve
  // el estómago a quien tiene sensibilidad vestibular, y el salto instantáneo
  // cumple la misma función.
  useEffect(() => {
    if (!diaElegido) return
    const destino = horariosRef.current
    if (!destino) return

    const sinAnimacion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

    destino.scrollIntoView({ behavior: sinAnimacion ? "auto" : "smooth", block: "start" })
  }, [diaElegido])

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
        <Avance actual="Confirmar" />
        <TituloDePaso tipo="listo" sinIcono>
          {accion === "cambiar"
            ? resultado.pendiente
              ? "Pedimos el cambio"
              : "¡Turno reagendado!"
            : resultado.pendiente
              ? "Pedimos tu turno"
              : "¡Tu turno está confirmado!"}
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
              direccion: elegido.direccion,
              agendaId: elegido.agendaId,
            }}
            titulo={
              resultado.pendiente
                ? "El turno que pediste"
                : accion === "cambiar"
                  ? "Tu turno nuevo"
                  : "Los datos de tu turno"
            }
          />
        )}
        <p className="text-[15px] text-muted-foreground">
          {resultado.pendiente
            ? "Te avisamos por WhatsApp apenas la clínica la apruebe."
            : "Te va a llegar la confirmación por WhatsApp. Guardá estos datos para tu próxima visita."}
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
        <Avance actual="Revisar" />
        <TituloDePaso
          tipo="confirmar"
          sinIcono
          detalle={
            accion === "cambiar" ? (
              <>
                <p>Verificá que los datos sean correctos antes de continuar.</p>
                <p>
                  Al confirmar, cancelamos tu turno actual y queda reservado el nuevo. Te
                  enviaremos la confirmación por WhatsApp.
                </p>
              </>
            ) : (
              <>
                <p>Verificá que los datos sean correctos antes de continuar.</p>
                <p>
                  Al confirmar, el turno queda reservado a tu nombre. Te enviaremos la
                  confirmación por WhatsApp.
                </p>
              </>
            )
          }
        >
          {accion === "cambiar" ? "Revisá y confirmá el cambio" : "Revisá y confirmá tu turno"}
        </TituloDePaso>

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
            direccion: elegido.direccion,
            agendaId: elegido.agendaId,
          }}
          tituloDelTurno={accion === "cambiar" ? "Nuevo turno" : "Datos del turno"}
          reemplaza={accion === "cambiar" ? { cuando: cuandoElViejo } : undefined}
        />

        {error && (
          <Aviso
            titulo={sinTurno ? "Quedaste sin turno: elegí otro horario" : "No pudimos reservarlo"}
            detalle={
              <>
                {error}
                {hayQueRecargar && (
                  <button
                    type="button"
                    // `refresh` y no `reload`: vuelve a pedirle los horarios
                    // al servidor sin recargar el documento, así el paciente
                    // no pierde la pantalla ni el desplazamiento.
                    onClick={() => router.refresh()}
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
          <Link href={corregirDatosEn} className="block text-[15px] text-muted-foreground underline">
            Corregir mis datos
          </Link>
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
  //
  // Hasta 1024px, uno abajo del otro. Desde ahí, al lado: el calendario a la
  // izquierda con su ancho natural y los horarios ocupando el resto.
  //
  // El motivo no es estético. Apilados no entran en la altura de una
  // notebook: el paciente elige un día, los horarios aparecen abajo del
  // pliegue, y hay que desplazarse para ver lo que acaba de pedir. Al lado
  // entran los dos, y el espacio horizontal que sobraba pasa a usarse.
  //
  // `items-start` para que la columna de horarios no se estire a la altura del
  // calendario, y `minmax(0,1fr)` porque sin el 0 la grilla de chips no deja
  // que la columna se achique y desborda.
  return (
    <div className="space-y-4">
      {encabezado}
      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
        {/* La tarjeta va a lo ancho de la columna —así se alinea con el resto—
          pero el calendario adentro se acota y se centra.
          Las celdas son un séptimo del ancho disponible: sin tope, en una
          columna de 640px quedarían de 88px, que es un calendario gigante con
          números perdidos en el medio de cada casilla. */}
        <div className="rounded-xl border bg-card p-2 sm:p-4">
          <div className="mx-auto w-full max-w-[360px]">
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
                // Ancho fluido con piso táctil (29/9/2026). Antes eran 44px
                // fijos: 7 columnas × 44 = 308px, más el borde de la tarjeta y los
                // 32px de margen del contenedor, no entraban en un teléfono de
                // 320px y el calendario desbordaba. Ahora cada celda toma un
                // séptimo del ancho disponible y nunca baja de 40px.
                head_cell: "w-[14.28%] min-w-10 pb-1 text-xs font-normal text-muted-foreground",
                cell: "h-11 w-[14.28%] min-w-10 p-0 text-center",
                // El alto lo pone la celda; las filas no tienen que sumar el
                // suyo. El `mt-2` por defecto de shadcn, por seis filas, eran
                // 96px de aire que estiraban la tarjeta muy por debajo del
                // último día (30/9/2026).
                row: "flex w-full",
                month: "space-y-2",
                caption: "relative flex items-center justify-center pt-0",
                // Sin color acá: lo pone el modificador que corresponda.
                day: "h-11 w-full rounded-lg p-0 text-base",
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
        </div>

        {!diaElegido && (
          <p className="text-[15px] text-muted-foreground lg:pt-2">
            Los días con turnos disponibles aparecen resaltados. Seleccioná uno para ver los
            horarios de ese día.
          </p>
        )}

        {diaElegido && (
          // `lg:pt-2` alinea el título del día con el del mes, que arranca más
          // abajo por el padding de la tarjeta. Sin eso las dos columnas
          // empiezan a alturas distintas y se leen como dos bloques sueltos.
          <div ref={horariosRef} className="scroll-mt-24 space-y-3 lg:scroll-mt-0 lg:pt-2">
          {/* `capitalize` de Tailwind pone en mayúscula CADA palabra, y la
              etiqueta es una frase: "miércoles 30 de septiembre" salía
              "Miércoles 30 De Septiembre". Sólo la primera letra. */}
          <p className="font-medium text-foreground first-letter:uppercase">
            {dias.find((d) => d.fecha === diaElegido)?.etiqueta}
          </p>
          <p className="text-[15px] text-muted-foreground">
            Seleccioná el horario que prefieras.
          </p>
          {/* Dos columnas sólo en los teléfonos más angostos —un iPhone SE de
              320px, donde tres chips con el nombre del profesional quedan
              ilegibles—, tres desde 360px, que es lo que mide el teléfono
              típico, y más a medida que hay lugar. Antes eran tres siempre:
              apretadas abajo y con media pantalla vacía arriba.

              El corte va en 360 y no en 380: un iPhone estándar mide 375, y
              con 380 se quedaba con dos columnas justo el tamaño más común. */}
          {/* `auto-fill` con un mínimo, en vez de un número fijo de columnas:
              "07:00" en un chip de 130px de ancho parece un botón al que le
              falta la etiqueta. Así entran los que entren y quedan del tamaño
              de su contenido. El mínimo sube cuando hay nombre de profesional,
              que es texto largo. */}
          <div
            className="grid gap-2 sm:gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${variosProfesionales ? 150 : 96}px, 1fr))`,
            }}
          >
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
                    direccion: turno.sedeId ? direccionesPorSede?.[turno.sedeId] : undefined,
                  })
                }
                // 56px de alto: lo toca con el pulgar alguien parado, y este
                // portal lo usan pacientes mayores.
                className="min-h-[56px] rounded-xl border bg-card px-2 py-2 text-base font-medium text-card-foreground transition-colors hover:border-primary/40 hover:bg-accent active:bg-accent lg:min-h-[48px]"
              >
                {turno.hora}
                {/* El nombre sólo cuando los horarios del día son de
                    profesionales DISTINTOS. Si son todos del mismo, ya está
                    dicho arriba y repetirlo ocho veces hace que la grilla se
                    lea como un bloque de texto en vez de como ocho horarios.
                    Cuando difieren, en cambio, es el dato que decide cuál
                    tocar. */}
                {variosProfesionales &&
                  turno.profesionalNombre &&
                  turno.profesionalNombre !== "Sin asignar" && (
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
    </div>
  )
}
