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
 * ── El color es de cada clínica, no nuestro ────────────────────────────────
 *
 * El widget tiene `sky-600` fijo en las clases. Acá no se puede: cada clínica
 * trae el suyo desde su configuración. Por eso el color viaja en una variable
 * CSS (`--marca`) que se declara una vez en el contenedor y de la que toman
 * todos los hijos. Tailwind para la estructura, la variable para la marca: ni
 * una clase de color inventada por cliente, ni una hoja de estilos por clínica.
 */

import type { ReactNode } from "react"
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
    <div
      className="min-h-screen bg-gray-50 text-gray-900"
      // `--marca` la leen los hijos con style={{ background: "var(--marca)" }}.
      // Declararla acá arriba es lo que evita tener que pasar el color por prop
      // a cada botón del árbol.
      style={{ ["--marca" as string]: marca.colorPrimario }}
    >
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
        className="flex items-center gap-3 px-4 py-4 text-white"
        style={{
          background: "var(--marca)",
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

      <footer className="mx-auto max-w-[560px] px-4 pb-8">
        <p className="text-sm text-gray-500">
          Si algo no funciona, escribinos por WhatsApp y lo resolvemos.
        </p>
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
}: {
  tipo: TipoDePaso
  children: ReactNode
  detalle?: ReactNode
}) {
  const Icono = ICONOS_DE_PASO[tipo]

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: "var(--marca)" }}
        >
          <Icono className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="text-lg font-medium text-gray-900">{children}</p>
      </div>
      {detalle && <p className="text-[15px] text-gray-500">{detalle}</p>}
    </div>
  )
}

/** El "Volver" del widget: discreto, arriba, sin competir con la acción. */
export function Volver({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="-ml-1 inline-flex items-center gap-1 py-1 text-sm text-gray-500"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden /> Volver
    </a>
  )
}

const TONOS = {
  neutro: { caja: "border-sky-200 bg-sky-50", texto: "text-sky-900", Icono: Info },
  atencion: { caja: "border-amber-200 bg-amber-50", texto: "text-amber-900", Icono: AlertTriangle },
  error: { caja: "border-red-200 bg-red-50", texto: "text-red-900", Icono: AlertCircle },
  exito: { caja: "border-green-200 bg-green-50", texto: "text-green-900", Icono: CheckCircle2 },
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
  const { caja, texto, Icono } = TONOS[tono]

  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-4 ${caja} ${texto}`}>
      <Icono className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{titulo}</p>
        {detalle && <p className="mt-1 text-[15px] opacity-90">{detalle}</p>}
      </div>
    </div>
  )
}

/** Una fila del resumen. Etiqueta gris a la izquierda, valor a la derecha. */
export function FilaDeResumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-gray-500">{etiqueta}</span>
      <span className="text-right font-medium text-gray-800">{valor}</span>
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
}: {
  turno: TurnoDelPortal
  titulo?: string
}) {
  const filas: Array<[string, string | undefined]> = [
    ["Fecha", turno.fechaFormateada || turno.fecha],
    ["Hora", turno.horaFormateada || turno.hora],
    ["Profesional", turno.profesional],
    ["Sede", turno.sede],
    ["Dirección", turno.direccion],
  ]

  const visibles = filas.filter(([, valor]) => !!valor) as Array<[string, string]>
  if (visibles.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {titulo && <p className="mb-3 font-medium">{titulo}</p>}
      <div className="space-y-2 text-[15px]">
        {visibles.map(([etiqueta, valor]) => (
          <FilaDeResumen key={etiqueta} etiqueta={etiqueta} valor={valor} />
        ))}
      </div>
    </div>
  )
}

/**
 * El botón primario, uno por pantalla.
 *
 * 56px de alto y ancho completo: lo toca con el pulgar alguien parado en una
 * sala de espera. Deshabilitado se pone gris y NO conserva el color de la
 * clínica — que un botón apagado se vea igual que uno activo es la forma más
 * rápida de que alguien lo toque cuatro veces.
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
    <button
      type={type}
      onClick={onClick}
      disabled={deshabilitado}
      className="w-full rounded-xl py-4 text-[17px] font-medium text-white transition-opacity disabled:cursor-default"
      style={{ background: deshabilitado ? "#9ca3af" : "var(--marca)" }}
    >
      {children}
    </button>
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
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-gray-300 bg-white py-4 text-[17px] font-medium text-gray-700"
    >
      {children}
    </button>
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
    agendaId?: string
  }
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
    // El bot lo muestra como "Id Turno" y sirve: es lo que el paciente le dice
    // a la clínica por teléfono si algo no cierra.
    ["N° de turno", turno.agendaId],
  ]

  const visibles = (filas: Array<[string, string | undefined]>) =>
    filas.filter(([, valor]) => !!valor) as Array<[string, string]>

  const bloque = (titulo: string, filas: Array<[string, string]>) =>
    filas.length === 0 ? null : (
      <div>
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">{titulo}</p>
        <div className="space-y-2 text-[15px]">
          {filas.map(([etiqueta, valor]) => (
            <FilaDeResumen key={etiqueta} etiqueta={etiqueta} valor={valor} />
          ))}
        </div>
      </div>
    )

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      {bloque("Datos del paciente", visibles(datosDelPaciente))}
      {bloque("Datos del turno", visibles(datosDelTurno))}
    </div>
  )
}
