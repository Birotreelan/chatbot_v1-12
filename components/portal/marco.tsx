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
import Link from "next/link"
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

/**
 * El prefijo de los archivos de `public/`.
 *
 * Vacío cuando el sitio se sirve en la raíz del dominio, que es el caso hoy.
 * Se deja igual para no tener que acordarse el día que deje de serlo.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ""

/**
 * El ancho de la columna, y de todo lo que tiene que alinearse con ella
 * (29/9/2026).
 *
 * 560px en teléfono y 640px desde tablet. No crece más: a partir de ahí las
 * líneas de texto se vuelven incómodas de leer, y este portal es sobre todo
 * texto y opciones en lista, no un tablero.
 *
 * Es una constante y no una clase copiada en cada lado porque son tres —la
 * banda de arriba, el contenido y el pie— y basta que una quede distinta para
 * que la pantalla se vea desalineada en una notebook. Es el mismo error que
 * tenía el encabezado antes de esto.
 */
const COLUMNA = "mx-auto w-full max-w-[560px] sm:max-w-[640px]"

/**
 * El ancho del paso de agenda, que necesita más (29/9/2026).
 *
 * El calendario y la grilla de horarios apilados no entran en la altura de
 * una notebook: el paciente elige un día, los horarios aparecen abajo del
 * pliegue y hay que desplazarse. Puestos uno al lado del otro entran, y
 * sobraba pantalla a los costados.
 *
 * Sólo desde 1024px, y sólo en esa pantalla. Los demás pasos son listas de
 * opciones y texto: a 1000px de ancho las líneas se leen mal y una lista de
 * tres opciones parece un formulario abandonado.
 */
const COLUMNA_AMPLIA = `${COLUMNA} lg:max-w-[1000px]`

export type AnchoDelMarco = "normal" | "amplio"

export function Marco({
  marca,
  children,
  cookieNueva,
  nombreCookie,
  ancho = "normal",
}: {
  marca: MarcaDelPortal
  children: ReactNode
  /**
   * "amplio" en el paso de agenda, donde el calendario y los horarios van uno
   * al lado del otro.
   *
   * Lo toman la banda, el contenido y el pie a la vez: si sólo creciera el
   * contenido, quedaría más ancho que el encabezado y volvería la
   * desalineación que este mismo componente arregló. El costo es que el
   * nombre de la clínica se corre unos píxeles al entrar a la agenda, en
   * pantallas de más de 1024px. Es mucho menos molesto que la alternativa.
   */
  ancho?: AnchoDelMarco
  /** Se emite en la primera visita, para reconocer el dispositivo después. */
  cookieNueva?: string | null
  nombreCookie?: string
}) {
  const columna = ancho === "amplio" ? COLUMNA_AMPLIA : COLUMNA

  return (
    // `flex flex-col` + `main flex-1`: el pie queda abajo de la ventana aunque
    // la pantalla tenga tres renglones, sin `position: fixed` —que en el
    // navegador interno de WhatsApp pelea con la barra del teclado y termina
    // tapando el botón de confirmar—.
    //
    // `portal` trae la paleta del pliego; el resto de la app conserva la suya.
    <div className="portal flex min-h-screen flex-col bg-background text-foreground">
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

      {/* La banda ocupa todo el ancho —es el borde superior de la pantalla—
          pero su CONTENIDO va en la misma columna que el resto (29/9/2026).
          Antes el nombre de la clínica arrancaba a 16px del borde izquierdo
          mientras el contenido estaba centrado: en un teléfono no se nota, en
          una notebook el nombre quedaba flotando solo a la izquierda. */}
      <header
        className="sticky top-0 z-10 bg-primary/95 text-primary-foreground backdrop-blur supports-[backdrop-filter]:bg-primary/90"
        style={{
          // En un iPhone el navegador de WhatsApp mete la barra de estado
          // encima del contenido; sin esto el nombre de la clínica queda tapado.
          paddingTop: "max(env(safe-area-inset-top), 16px)",
        }}
      >
        <div className={`${columna} flex items-center gap-3 px-4 pb-4 sm:gap-4`}>
          <CalendarDays className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-lg font-medium sm:text-xl">{marca.clinica}</p>
            <p className="text-sm opacity-90">Gestión de turnos</p>
          </div>
        </div>
      </header>

      <main
        className={`${columna} flex-1 space-y-4 px-4 pb-12 pt-5 text-base leading-relaxed sm:space-y-5 sm:pt-7 sm:text-[17px]`}
        role="main"
      >
        {children}
      </main>

      {/* ── El pie ───────────────────────────────────────────────────────────
          Una línea de atribución y nada más. Sin enlaces, sin columnas, sin
          redes: esto es una herramienta para sacar un turno, no un sitio
          institucional, y cualquier cosa tocable acá abajo compite con el
          botón que el paciente vino a apretar.

          El ancho es el del contenido (560px) y no el `max-w-6xl` del pliego:
          ese número está escrito para una app de escritorio, y el motivo que
          lo acompaña —"que la línea no quede desalineada respecto del
          contenido"— acá se cumple con el ancho de acá.

          Es un <img> y no `next/image` a propósito: sobre un archivo estático
          de 9 KB el componente no aporta nada y agrega una forma más de
          romper el build. El `src` lleva el prefijo del basePath porque los
          archivos de `public/` no los reescribe el router: sin eso, servido
          desde una subcarpeta, da 404. Con el sitio en la raíz la variable
          queda vacía y el prefijo no molesta. */}
      <footer className="border-t py-6">
        <div className={`${columna} flex items-center justify-center gap-2 px-4`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${BASE_PATH}/treelan-logo.jpg`}
            alt="Treelan"
            className="h-4 w-4 rounded-sm object-contain"
          />
          <p className="text-center text-xs text-muted-foreground">
            Powered by Treelan S.A. 2026. Todos los derechos reservados.
          </p>
        </div>
      </footer>
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
  sinIcono = false,
}: {
  tipo: TipoDePaso
  children: ReactNode
  detalle?: ReactNode
  /**
   * El ícono en círculo sobra cuando arriba ya está el indicador de avance
   * (30/9/2026): dos señales de "estás acá" compitiendo, y la de abajo no
   * agrega nada que la de arriba no diga mejor.
   */
  sinIcono?: boolean
}) {
  const Icono = ICONOS_DE_PASO[tipo]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        {!sinIcono && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Icono className="h-[18px] w-[18px]" aria-hidden />
          </span>
        )}
        <p className="text-lg font-medium text-foreground sm:text-xl">{children}</p>
      </div>
      {/* `div` y no `p`: el detalle suele ser más de una frase y van en
          párrafos separados. Un <p> adentro de otro <p> es HTML inválido y el
          navegador lo cierra solo, dejando el segundo afuera del estilo. */}
      {detalle && (
        <div className="space-y-1.5 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
          {detalle}
        </div>
      )}
    </div>
  )
}

/**
 * Dónde está el paciente y qué le falta (30/9/2026).
 *
 * ── Por qué sin números ────────────────────────────────────────────────────
 *
 * Los pasos van numerados —1, 2, 3— pero NO como "paso 2 de 4". La diferencia
 * no es cosmética: acá el número es la posición de una etapa con nombre, y las
 * etapas son siempre tres. Un "de N" sería otra cosa y no se puede: el portal
 * no tiene una cantidad fija de pantallas. Según lo que el cliente tenga
 * habilitado y lo que el paciente elija, el flujo de turno nuevo pasa por
 * sede, tipo de búsqueda, especialidad o profesional —o por ninguno—. Quien
 * elige "por especialidad" recorre un paso más que quien elige "cualquier
 * profesional".
 *
 * Un total que cambia a mitad de camino es peor que no mostrar ninguno: el
 * paciente que leyó "de 4" y después ve "de 5" deja de confiar en todo lo
 * demás que le decimos.
 *
 * Los nombres, en cambio, son estables: siempre se elige, se revisa y se
 * confirma. Los filtros de adelante quedan todos bajo "Elegir", que es lo que
 * el paciente siente que está haciendo.
 *
 * ── Accesibilidad ──────────────────────────────────────────────────────────
 *
 * Es una lista ordenada de verdad, con `aria-current` en el actual. Para un
 * lector de pantalla eso se anuncia como posición; hecho con `div`s y colores
 * no se anunciaría nada.
 */
export const PASOS_DEL_AVANCE = ["Elegir", "Revisar", "Confirmar"] as const

export type PasoDelAvance = (typeof PASOS_DEL_AVANCE)[number]

export function Avance({ actual }: { actual: PasoDelAvance }) {
  const indiceActual = PASOS_DEL_AVANCE.indexOf(actual)

  return (
    <nav aria-label="Progreso">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium uppercase tracking-wide">
        {PASOS_DEL_AVANCE.map((paso, i) => {
          const esActual = i === indiceActual
          const yaPaso = i < indiceActual

          return (
            <li key={paso} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground/40">
                  ›
                </span>
              )}
              <span
                aria-current={esActual ? "step" : undefined}
                // El número va DENTRO del mismo span que el nombre para que el
                // lector de pantalla lo anuncie junto: "1 Elegir", no "1" y
                // después "Elegir" como si fueran dos cosas.
                className={
                  esActual
                    ? "text-primary"
                    : yaPaso
                      ? "text-muted-foreground"
                      : // Los que faltan, más apagados: se leen como "todavía
                        // no", no como algo que se pueda tocar.
                        "text-muted-foreground/50"
                }
              >
                <span aria-hidden>{i + 1}. </span>
                {paso}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * El paso atrás.
 *
 * ── Era demasiado discreto (28/9/2026) ────────────────────────────────────
 *
 * Estaba pensado como en el widget: gris, chico, sin competir con la acción
 * principal. En el portal no funciona igual. Acá el paciente atraviesa hasta
 * cinco filtros encadenados —sede, tipo de búsqueda, especialidad,
 * profesional, horario— y equivocarse en uno es normal; volver no es una
 * salida de emergencia, es parte del camino. Un texto gris del tamaño de una
 * nota al pie no se lee como algo que se puede tocar, y menos en el público
 * de este portal.
 *
 * Ahora es visiblemente un control: borde, fondo de tarjeta y el azul del
 * sistema, que es el color de todo lo tocable. Sigue sin competir con la
 * acción primaria —que es sólida, a ancho completo y está abajo— pero se ve.
 *
 * `Link` y no `<a>`: con `<a>` volver un paso recargaba el documento entero
 * —pantalla en blanco y la banda de la clínica parpadeando— cuando lo único
 * que cambia es el contenido. Ver `elegir-filtro.tsx`.
 */
export function Volver({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-[15px] font-medium text-primary no-underline hover:bg-accent"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden /> Volver
    </Link>
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
    <Card className="p-4 shadow-none sm:p-5">
      {titulo && <p className={detalle ? "font-medium" : "mb-3 font-medium"}>{titulo}</p>}
      {detalle && <p className="mb-3 mt-0.5 text-[15px] text-muted-foreground sm:text-base">{detalle}</p>}
      <div className="space-y-2 text-[15px] sm:text-base">
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
      // `flex` en vez del `inline-flex` de shadcn: hace falta para que
      // `mx-auto` centre. En teléfono va a ancho completo —se toca con el
      // pulgar—; desde tablet se acota, porque un botón de 640px de ancho y
      // 56px de alto operado con un mouse es un cartel.
      className="flex h-auto w-full py-4 text-[17px] font-medium sm:mx-auto sm:max-w-sm sm:py-3.5 sm:text-base"
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
      className="flex h-auto w-full py-4 text-[17px] font-medium sm:mx-auto sm:max-w-sm sm:py-3.5 sm:text-base"
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
        <div className="space-y-2 text-[15px] sm:text-base">
          {filas.map(([etiqueta, valor]) => (
            <FilaDeResumen key={etiqueta} etiqueta={etiqueta} valor={valor} />
          ))}
        </div>
      </div>
    )

  return (
    <Card className="space-y-4 p-4 shadow-none sm:space-y-5 sm:p-5">
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
