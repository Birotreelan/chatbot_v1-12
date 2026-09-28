/**
 * El marco visual del portal (22/9/2026, rehecho el 24/9 sobre el widget).
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
 *
 * ── De dónde sale el diseño (24/9/2026) ────────────────────────────────────
 *
 * Del widget web (`components/widget-form.tsx`), que resuelve exactamente el
 * mismo problema y ya está probado con pacientes: banda de color con el nombre
 * de la clínica, un ícono en círculo que anuncia de qué se trata el paso, y
 * una sola acción primaria a ancho completo abajo.
 *
 * ── El color: del sistema, no de cada clínica (28/9/2026) ──────────────────
 *
 * Hasta hoy el portal se pintaba con el color que cada clínica había cargado
 * para su widget, en una variable `--marca`. Se cambió por el token `primary`
 * del sistema de diseño, que es el mismo de todas las pantallas.
 *
 * Lo que se gana: los colores del pliego pasaron una auditoría de contraste
 * WCAG AA; un hexadecimal cargado a mano en un formulario no pasó ninguna, y
 * un celeste claro sobre blanco dejaba texto ilegible justo en el público que
 * peor ve. Lo que se pierde: el paciente ya no reconoce los colores de su
 * clínica. Eso queda cubierto por el nombre de la clínica, que sigue en la
 * banda de arriba, que era de donde venía la mayor parte de la confianza.
 *
 * `widgetPrimaryColor` sigue existiendo y sigue mandando en el widget web. Acá
 * ya no se lee.
 *
 * ── Los tokens están acotados al portal ────────────────────────────────────
 *
 * La clase `.portal` del contenedor declara la paleta del pliego —otro azul y
 * otro radio de borde que los del dashboard— y todo lo que cuelga de ahí,
 * incluidos los componentes de shadcn, la toma. Ver `app/globals.css`.
 */

import type { ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

import type { MarcaDelPortal } from "@/lib/portal/marca"
import type { TurnoDelPortal } from "@/lib/portal/token"
import {
  CalendarDays,
  ChevronLeft,
  IdCard,
  ListChecks,
  ClipboardCheck,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  PencilLine,
  Phone,
  type LucideIcon,
} from "lucide-react"

/**
 * El ícono de cada paso.
 *
 * Mismo criterio que el widget: refuerza de qué se trata el paso sin obligar a
 * leer. Para alguien que ve poco, el ícono llega antes que el título.
 */
export const ICONOS_DE_PASO = {
  dni: IdCard,
  datos: PencilLine,
  elegir: ListChecks,
  agenda: CalendarDays,
  confirmar: ClipboardCheck,
  listo: CheckCircle2,
  telefono: Phone,
} satisfies Record<string, LucideIcon>

export type TipoDePaso = keyof typeof ICONOS_DE_PASO

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
    // `portal` trae la paleta del pliego; el resto de la app conserva la suya.
    <div className="portal min-h-screen bg-background text-foreground">
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

      <header
        className="sticky top-0 z-10 flex items-center gap-3 bg-primary/95 px-4 py-4 text-primary-foreground backdrop-blur supports-[backdrop-filter]:bg-primary/90"
        style={{
          // En un iPhone el navegador de WhatsApp mete la barra de estado
          // encima del contenido; sin esto el nombre de la clínica queda tapado.
          paddingTop: "max(env(safe-area-inset-top), 16px)",
        }}
      >
        <CalendarDays className="h-6 w-6 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{marca.clinica}</p>
          <p className="text-sm opacity-90">Gestión de turnos</p>
        </div>
      </header>

      <main className="mx-auto max-w-[560px] space-y-4 px-4 pb-12 pt-5 text-base leading-relaxed">
        {children}
      </main>
    </div>
  )
}

/**
 * El encabezado de cada paso: ícono en círculo + qué hay que hacer.
 *
 * `detalle` es la línea de abajo, en gris. Va lo que ayuda pero no es la
 * instrucción — "Si ya te atendiste acá, traemos tus datos solos". Separarlo
 * del título importa: si todo tiene el mismo peso, no hay nada destacado.
 */
export function TituloDePaso({
  tipo,
  children,
  detalle,
}: {
  tipo: TipoDePaso
  children: ReactNode
  detalle?: ReactNode
}) {
  const Icono = ICONOS_DE_PASO[tipo]

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icono className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="text-lg font-medium text-foreground">{children}</p>
      </div>
      {detalle && <p className="text-[15px] text-muted-foreground">{detalle}</p>}
    </div>
  )
}

/** El "Volver" del widget: discreto, arriba, sin competir con la acción. */
export function Volver({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="-ml-1 inline-flex min-h-[44px] items-center gap-1 py-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden /> Volver
    </a>
  )
}

/**
 * Cada tono, con la variante del `Alert` que le corresponde y su ícono.
 *
 * Los nombres de acá son los del portal —`atencion`, `exito`— y los de allá
 * los de shadcn —`warning`, `success`—. La tabla traduce y nada más: renombrar
 * las llamadas en cinco pantallas para que coincidan sería mucho ruido, y
 * dejar dos vocabularios sueltos sin un lugar donde se toquen es cómo se
 * termina con `bg-amber-50` escrito a mano en la sexta.
 *
 * `fondo` existe porque las variantes de shadcn pintan borde y texto pero
 * dejan el fondo transparente, y estos avisos se leen mejor con un fondo
 * suave. Sale del mismo token, así que no puede desafinar.
 */
const TONOS = {
  neutro: { variante: "info", fondo: "bg-primary/5", Icono: Info },
  atencion: { variante: "warning", fondo: "bg-warning/10", Icono: AlertTriangle },
  error: { variante: "destructive", fondo: "bg-destructive/5", Icono: AlertCircle },
  exito: { variante: "success", fondo: "bg-secondary/5", Icono: CheckCircle2 },
} as const

export type TonoDeAviso = keyof typeof TONOS

/**
 * Los cuatro tonos, con ícono.
 *
 * El tono no es decoración: "no hay horarios con estos filtros" y "se cortó la
 * conexión" son cosas distintas, y si se ven iguales el paciente no sabe si el
 * problema es suyo o nuestro. `atencion` es el que usan los casos que no son
 * un error de nadie —la obra social que sólo atiende por teléfono, la agenda
 * vacía— y que antes se mostraban con el mismo gris que todo lo demás.
 */
export function Aviso({
  titulo,
  detalle,
  tono = "neutro",
}: {
  titulo: string
  detalle?: ReactNode
  tono?: TonoDeAviso
}) {
  const { variante, fondo, Icono } = TONOS[tono]

  // El ícono va como hijo DIRECTO y los textos como hermanos, que es la forma
  // que espera `Alert`: sus selectores `[&>svg]` lo posicionan en absoluto y
  // le dan el margen izquierdo a lo que viene después. Envolver el título y el
  // detalle en un div rompía las dos cosas —el ícono quedaba flotando sobre el
  // texto— y el flex que yo había puesto peleaba con ese `position: absolute`.
  return (
    <Alert variant={variante} className={fondo}>
      <Icono className="h-5 w-5" aria-hidden />
      <AlertTitle className="font-medium">{titulo}</AlertTitle>
      {detalle && <AlertDescription className="text-[15px]">{detalle}</AlertDescription>}
    </Alert>
  )
}

/** Una fila del resumen. Etiqueta gris a la izquierda, valor a la derecha. */
export function FilaDeResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium text-foreground">{valor}</span>
    </div>
  )
}

/**
 * La tarjeta de resumen.
 *
 * Se usa para "tu turno actual" cuando se reprograma y para el repaso previo a
 * confirmar. Es la misma información en los dos casos, así que es el mismo
 * componente: dos tarjetas distintas para lo mismo terminarían mostrando
 * campos distintos.
 */
export function ResumenDelTurno({
  turno,
  titulo,
  detalle,
}: {
  turno: TurnoDelPortal
  titulo?: string
  /** La línea gris debajo del título: para qué está esta tarjeta acá. */
  detalle?: string
}) {
  const filas: Array<[string, string | undefined]> = [
    ["Fecha", turno.fechaFormateada || turno.fecha],
    ["Hora", turno.horaFormateada || turno.hora],
    ["Profesional", turno.profesional],
    ["Sede", turno.sede],
    ["Dirección", turno.direccion],
    // Es lo que el paciente le dice a la clínica por teléfono si algo no
    // cierra. En la pantalla final vale más que en ninguna otra.
    ["N° de turno", turno.agendaId],
  ]

  const visibles = filas.filter(([, valor]) => !!valor) as Array<[string, string]>
  if (visibles.length === 0) return null

  return (
    <Card className="p-4 shadow-none">
      {titulo && <p className={detalle ? "font-medium" : "mb-3 font-medium"}>{titulo}</p>}
      {detalle && <p className="mb-3 mt-0.5 text-[15px] text-muted-foreground">{detalle}</p>}
      <div className="space-y-2 text-[15px]">
        {visibles.map(([etiqueta, valor]) => (
          <FilaDeResumen key={etiqueta} etiqueta={etiqueta} valor={valor} />
        ))}
      </div>
    </Card>
  )
}

/**
 * El botón primario, uno por pantalla.
 *
 * 56px de alto y ancho completo: lo toca con el pulgar alguien parado en una
 * sala de espera. Bastante más que los 44px del mínimo táctil, y a propósito.
 *
 * Envuelve al `Button` de shadcn en vez de reemplazarlo: así el foco, el
 * disabled y los colores salen del mismo lugar que en el resto del sistema, y
 * acá sólo queda lo que es propio del portal —el alto y el ancho completo—.
 * El estado deshabilitado lo resuelve `Button` bajando la opacidad, que es lo
 * que hace en todas las pantallas.
 */
export function BotonPrimario({
  children,
  deshabilitado,
  onClick,
  type = "button",
}: {
  children: ReactNode
  deshabilitado?: boolean
  onClick?: () => void
  type?: "button" | "submit"
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={deshabilitado}
      className="h-auto w-full py-4 text-[17px] font-medium"
    >
      {children}
    </Button>
  )
}

/** La acción secundaria: misma altura, sin color. */
export function BotonSecundario({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-auto w-full py-4 text-[17px] font-medium"
    >
      {children}
    </Button>
  )
}

/**
 * El repaso previo a confirmar, con los mismos datos que muestra el bot
 * (24/9/2026).
 *
 * ── Por qué dos bloques y no una lista ────────────────────────────────────
 *
 * Es la forma que ya tiene `buildConfirmationMessage` en
 * `conversation-state/shared/confirmation-handler.ts`: DATOS DEL PACIENTE y
 * DATOS DEL TURNO. Son dos preguntas distintas —"¿este soy yo?" y "¿este es
 * el turno que quiero?"— y separarlas hace que el paciente revise las dos en
 * vez de pasar los ojos por una lista de nueve renglones.
 *
 * ── Lo que no está, no se inventa ─────────────────────────────────────────
 *
 * Cuando al paciente lo reconoció el bot tenemos su nombre completo en una
 * sola cadena, sin saber dónde termina el nombre y empieza el apellido.
 * Partirlo por el primer espacio daría "DE" y "SANTIAGO, Nicolas" en la mitad
 * de los casos. Ahí se muestra un solo renglón "Paciente" con el nombre tal
 * como vino, y listo.
 */
export function ResumenDeConfirmacion({
  paciente,
  turno,
  tituloDelTurno = "Datos del turno",
  reemplaza,
}: {
  paciente: {
    nombre?: string
    apellido?: string
    dni?: string
    obraSocial?: string
  }
  turno: {
    fechaFormateada?: string
    horaFormateada?: string
    profesional?: string
    sede?: string
    direccion?: string
    agendaId?: string
  }
  /** "Nuevo turno" cuando se está reemplazando uno; si no, "Datos del turno". */
  tituloDelTurno?: string
  /**
   * El turno que este cambio deja sin efecto (28/9/2026).
   *
   * Va en su propio bloque, al final y después del turno nuevo, porque el
   * orden es el de la decisión: primero qué se llevan, después qué pierden.
   * Mezclar los dos turnos en una sola lista es lo que hacía que el paciente
   * no supiera cuál de las dos fechas estaba confirmando.
   */
  reemplaza?: { cuando?: string }
}) {
  const tieneNombreYApellido = Boolean(paciente.nombre && paciente.apellido)

  const datosDelPaciente: Array<[string, string | undefined]> = tieneNombreYApellido
    ? [
        ["Apellido", paciente.apellido],
        ["Nombre", paciente.nombre],
        ["DNI", paciente.dni],
        ["Obra social", paciente.obraSocial],
      ]
    : [
        ["Paciente", paciente.nombre],
        ["DNI", paciente.dni],
        ["Obra social", paciente.obraSocial],
      ]

  const datosDelTurno: Array<[string, string | undefined]> = [
    ["Fecha", turno.fechaFormateada],
    ["Hora", turno.horaFormateada],
    // Sin "Dr." adelante, a diferencia del bot: ese prefijo se agrega sin
    // saber si corresponde, y la agenda tiene instrumentadores quirúrgicos y
    // otros profesionales que no son médicos. Poner un título que puede estar
    // mal es peor que no poner ninguno.
    ["Profesional", turno.profesional],
    ["Sede", turno.sede],
    // Sede y dirección son una unidad cuando la institución tiene varias: el
    // nombre solo no le dice al paciente a dónde tiene que ir.
    ["Dirección", turno.direccion],
    // El bot lo muestra como "Id Turno" y sirve: es lo que el paciente le dice
    // a la clínica por teléfono si algo no cierra.
    ["N° de turno", turno.agendaId],
  ]

  const visibles = (filas: Array<[string, string | undefined]>) =>
    filas.filter(([, valor]) => !!valor) as Array<[string, string]>

  const bloque = (titulo: string, filas: Array<[string, string]>) =>
    filas.length === 0 ? null : (
      <div>
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <div className="space-y-2 text-[15px]">
          {filas.map(([etiqueta, valor]) => (
            <FilaDeResumen key={etiqueta} etiqueta={etiqueta} valor={valor} />
          ))}
        </div>
      </div>
    )

  return (
    <Card className="space-y-4 p-4 shadow-none">
      {bloque("Datos del paciente", visibles(datosDelPaciente))}
      {bloque(tituloDelTurno, visibles(datosDelTurno))}

      {reemplaza?.cuando && (
        <div className="border-t pt-4">
          <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Turno actual
          </p>
          <p className="text-[15px] font-medium first-letter:uppercase">{reemplaza.cuando}</p>
          {/* Dice la consecuencia de apretar el botón, no lo que va a pasar
              con el turno viejo en abstracto. "Vamos a cancelar tu turno"
              suena a amenaza; esto explica el intercambio. */}
          <p className="mt-1 text-[15px] text-muted-foreground">
            Al confirmar, tu turno actual será cancelado y reemplazado por el nuevo turno
            seleccionado.
          </p>
        </div>
      )}
    </Card>
  )
}
