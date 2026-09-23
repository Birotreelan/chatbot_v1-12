/**
 * app/p/[token]/page.tsx — el portal del paciente.
 *
 * Se llega acá desde un botón de WhatsApp.
 *
 * ── Toda la E/S vive en esta página ────────────────────────────────────────
 *
 * Los componentes de abajo no consultan nada: reciben datos y dibujan. Hay dos
 * razones y ninguna es de estilo.
 *
 * La primera es de seguridad: el token se resuelve contra Redis y la agenda se
 * consulta con las credenciales de la clínica, todo del lado del servidor. Al
 * navegador le llega HTML ya armado. Si esto fuera una SPA consultando una API,
 * habría que exponer una API que devuelva turnos de pacientes — y protegerla
 * sería el problema del token otra vez, pero peor.
 *
 * La segunda es que con un solo lugar que hace E/S, el orden de las consultas
 * se lee de corrido y no hay forma de pedir la lista de profesionales para
 * después descubrir que ese cliente no deja elegir profesional.
 *
 * ── La cookie del dispositivo ──────────────────────────────────────────────
 *
 * En la primera apertura se genera un secreto y queda en una cookie; en las
 * siguientes se compara. NO bloquea: si no coincide, se deja pasar y se anota.
 * Bloquear dejaría afuera al paciente que tocó "abrir en Chrome" desde el
 * navegador interno de WhatsApp. Ese falso positivo cuesta más de lo que evita.
 */

import { cookies } from "next/headers"
import { randomBytes } from "crypto"
import { leerEnlace } from "@/lib/portal/token"
import { permiteGestionar, permiteVerDatos } from "@/lib/portal/vigencia"
import { decidirPaso, ofreceVerTodos } from "@/lib/portal/pasos"
import { marcaDelPortal } from "@/lib/portal/marca"
import { agendaParaReprogramar, agendaParaTurnoNuevo, turnosDeEjemplo } from "@/lib/portal/agenda"
import { obtenerEspecialidades, obtenerTodosLosProfesionales } from "@/lib/api-tools/api-functions"
import { getWhatsAppConfigById } from "@/lib/db"
import { Marco, Aviso, ResumenDelTurno } from "@/components/portal/marco"
import { ElegirFiltro } from "@/components/portal/elegir-filtro"
import { SelectorDeTurnos } from "@/components/portal/selector-de-turnos"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** El portal no se indexa: cada URL es de un paciente. */
export const metadata = {
  robots: { index: false, follow: false },
  title: "Gestión de turnos",
}

const COOKIE_DISPOSITIVO = "portal_dispositivo"

export default async function PaginaDelPortal({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ especialidadId?: string; profesionalId?: string; sinFiltro?: string }>
}) {
  const { token } = await params
  const filtrosCrudos = await searchParams
  const almacen = await cookies()

  let secreto = almacen.get(COOKIE_DISPOSITIVO)?.value
  let secretoNuevo: string | null = null
  if (!secreto) {
    secreto = randomBytes(16).toString("base64url")
    secretoNuevo = secreto
  }

  const lectura = await leerEnlace(token, secreto)

  // Un token inexistente y uno vencido hace rato se ven igual desde acá, y está
  // bien: no hay nada que decirle a quien tiene una URL que no le corresponde.
  if (!lectura) {
    return (
      <Marco marca={marcaDelPortal(null)} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso
          titulo="Este enlace ya no está disponible"
          detalle="Puede haber vencido o haberse usado. Escribinos por WhatsApp y te mandamos uno nuevo."
        />
      </Marco>
    )
  }

  const { contexto, estado, dispositivoDistinto } = lectura
  const config = await getWhatsAppConfigById(contexto.configId)
  const marca = marcaDelPortal(config)
  const nombre = contexto.pacienteNombre?.trim().split(/\s+/)[0]

  if (!permiteVerDatos(estado)) {
    return (
      <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso titulo="Este enlace venció" detalle="Escribinos por WhatsApp y te mandamos uno nuevo." />
      </Marco>
    )
  }

  // Ya gestionó: se muestra lo que quedó, sin botones. El paciente vuelve a
  // abrir el enlace para chequear, y encontrarse un error lo mandaría a
  // preguntarle al bot — un mensaje que pagamos y que no debería existir.
  if (estado === "gestionado" && contexto.resultado) {
    return (
      <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso titulo="Listo" detalle={contexto.resultado.texto} tono="exito" />
        {contexto.resultado.turno && <ResumenDelTurno turno={contexto.resultado.turno} />}
        <p style={{ color: "#374151" }}>Te va a llegar la confirmación por WhatsApp.</p>
      </Marco>
    )
  }

  if (!permiteGestionar(estado)) {
    return (
      <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso
          titulo="El plazo para gestionar por acá terminó"
          detalle="Escribinos por WhatsApp y lo resolvemos."
        />
        {contexto.turno && <ResumenDelTurno turno={contexto.turno} titulo="Tu turno" />}
      </Marco>
    )
  }

  if (dispositivoDistinto) {
    console.warn(`[PORTAL] ${contexto.phone} abrió su enlace desde otro dispositivo`)
  }

  const permisos = {
    porEspecialidad: config?.enableSearchBySpecialty,
    porProfesional: config?.enableSearchByProfessional,
    porCualquiera: config?.enableSearchByAnyDoctor,
  }
  const filtros = {
    especialidadId: filtrosCrudos.especialidadId,
    profesionalId: filtrosCrudos.profesionalId,
    sinFiltro: filtrosCrudos.sinFiltro === "1",
  }
  const paso = decidirPaso(contexto.intencion, permisos, filtros)
  const clienteId = contexto.clienteId || ""

  // El aviso de prueba va arriba de todo y en todas las pantallas. Si alguien
  // abre este enlace sin saber qué es, tiene que enterarse antes de tocar nada.
  const avisoDemo = contexto.demo ? (
    <div
      style={{
        border: "1px solid #d97706",
        background: "#fffbeb",
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>Enlace de prueba</p>
      <p style={{ margin: "4px 0 0", fontSize: 14, color: "#374151" }}>
        Podés recorrer todas las pantallas. No se reserva ni se cancela ningún turno real.
      </p>
    </div>
  ) : null

  const marco = (hijos: React.ReactNode) => (
    <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
      {avisoDemo}
      {hijos}
    </Marco>
  )

  // ── Reprogramar ─────────────────────────────────────────────────────────
  if (paso === "reprogramar") {
    const agenda = await agendaParaReprogramar({
      clienteId,
      phone: contexto.phone,
      sedeId: contexto.sedeId,
      profesionalId: contexto.turno?.profesionalId,
      profesionalNombre: contexto.turno?.profesional,
      pacienteDNI: contexto.pacienteDNI,
      obraSocialId: contexto.obraSocialId,
    })

    // En un enlace de prueba, si la agenda real vino vacía se muestran horarios
    // inventados para poder seguir probando — y se dice que lo son. Disimularlo
    // escondería justamente el dato de que la agenda no contestó.
    const usaEjemplos = contexto.demo === true && agenda.total === 0
    const dias = usaEjemplos ? turnosDeEjemplo() : agenda.dias

    return marco(
      <>
        {usaEjemplos && (
          <Aviso
            titulo="Horarios de ejemplo"
            detalle="La agenda real no devolvió turnos disponibles, así que estos son inventados para poder seguir probando."
          />
        )}
        <p style={{ fontSize: 18, margin: "0 0 16px" }}>
          {nombre ? `Hola, ${nombre}. ` : ""}Elegí el nuevo horario para tu turno.
        </p>

        {contexto.turno && <ResumenDelTurno turno={contexto.turno} titulo="Tu turno actual" />}

        {/* Si no se pudo identificar al profesional se ofrecen turnos de la
            sede, y hay que decirlo: el paciente asume que ve los de su médico. */}
        {!agenda.filtradoPorProfesional && agenda.total > 0 && contexto.turno?.profesional && (
          <Aviso
            titulo="Estos son todos los horarios de la sede"
            detalle={`No pudimos filtrar sólo por ${contexto.turno.profesional}. Mirá el profesional antes de confirmar.`}
          />
        )}

        {agenda.filtradoPorProfesional && agenda.profesionalNombre && (
          <p style={{ color: "#6b7280", margin: "0 0 16px" }}>
            Horarios disponibles con {agenda.profesionalNombre}.
          </p>
        )}

        <SelectorDeTurnos token={token} dias={dias} marca={marca} etiquetaConfirmar="Confirmar el cambio" />
      </>,
    )
  }

  // ── Elegir especialidad ─────────────────────────────────────────────────
  if (paso === "elegir_especialidad") {
    const opciones = normalizarOpciones(await obtenerEspecialidades(clienteId).catch(() => null))

    // Sin especialidades no se frena al paciente en una pantalla vacía: se
    // salta al paso siguiente con un enlace que ya trae el `sinFiltro`.
    if (opciones.length > 0) {
      return marco(
        <>
          <p style={{ fontSize: 18, margin: "0 0 16px" }}>
            {nombre ? `Hola, ${nombre}. ` : ""}¿Qué tipo de consulta necesitás?
          </p>
          <ElegirFiltro token={token} campo="especialidadId" opciones={opciones} marca={marca} />
          {ofreceVerTodos(permisos) && <VerTodos token={token} etiqueta="Ver todos los horarios" />}
        </>,
      )
    }
  }

  // ── Elegir profesional ──────────────────────────────────────────────────
  if (paso === "elegir_especialidad" || paso === "elegir_profesional") {
    const opciones = normalizarOpciones(await obtenerTodosLosProfesionales(clienteId).catch(() => null))

    if (opciones.length > 0) {
      const conservar = filtros.especialidadId ? { especialidadId: filtros.especialidadId } : undefined
      return marco(
        <>
          <p style={{ fontSize: 18, margin: "0 0 16px" }}>
            {nombre ? `Hola, ${nombre}. ` : ""}¿Con qué profesional querés atenderte?
          </p>
          <ElegirFiltro token={token} campo="profesionalId" opciones={opciones} marca={marca} conservar={conservar} />
          {ofreceVerTodos(permisos) && (
            <VerTodos token={token} etiqueta="Me da igual el profesional" conservar={conservar} />
          )}
        </>,
      )
    }
  }

  // ── Elegir horario ──────────────────────────────────────────────────────
  const agendaNueva = await agendaParaTurnoNuevo({
    clienteId,
    phone: contexto.phone,
    sedeId: contexto.sedeId,
    profesionalId: filtros.profesionalId,
    especialidadId: filtros.especialidadId,
    pacienteDNI: contexto.pacienteDNI,
    obraSocialId: contexto.obraSocialId,
  })

  const conEjemplos = contexto.demo === true && agendaNueva.total === 0
  const diasNuevos = conEjemplos ? turnosDeEjemplo() : agendaNueva.dias

  return marco(
    <>
      {conEjemplos && (
        <Aviso
          titulo="Horarios de ejemplo"
          detalle="La agenda real no devolvió turnos con estos filtros, así que estos son inventados para poder seguir probando."
        />
      )}

      <p style={{ fontSize: 18, margin: "0 0 16px" }}>
        {nombre ? `Hola, ${nombre}. ` : ""}Elegí el horario que te quede mejor.
      </p>

      {agendaNueva.total === 0 && !conEjemplos && (
        <Aviso
          titulo="No encontramos horarios con esos filtros"
          detalle="Probá sin elegir profesional, o escribinos por WhatsApp."
        />
      )}

      <SelectorDeTurnos token={token} dias={diasNuevos} marca={marca} etiquetaConfirmar="Confirmar mi turno" />
    </>,
  )
}

function VerTodos({
  token,
  etiqueta,
  conservar,
}: {
  token: string
  etiqueta: string
  conservar?: Record<string, string>
}) {
  const params = new URLSearchParams({ ...(conservar || {}), sinFiltro: "1" })
  return (
    <a
      href={`/p/${token}?${params.toString()}`}
      style={{
        display: "block",
        textAlign: "center",
        padding: "14px 16px",
        marginTop: 12,
        borderRadius: 12,
        border: "1px solid #d1d5db",
        background: "#fff",
        color: "#111827",
        textDecoration: "none",
      }}
    >
      {etiqueta}
    </a>
  )
}

/**
 * Las listas vienen con nombres de campo distintos según el endpoint y la
 * clínica. Se aceptan las variantes conocidas y se descarta lo que no tenga id
 * y nombre, en vez de mostrar opciones vacías que no llevan a ningún lado.
 */
function normalizarOpciones(respuesta: any): Array<{ id: string; nombre: string }> {
  const datos = respuesta?.datos ?? respuesta
  const lista = Array.isArray(datos) ? datos : datos?.especialidades || datos?.profesionales || []
  if (!Array.isArray(lista)) return []

  return lista
    .map((item: any) => ({
      id: String(item?.id ?? item?.Id ?? item?.codigo ?? ""),
      nombre: String(item?.nombre ?? item?.Nombre ?? item?.descripcion ?? "").trim(),
    }))
    .filter((o) => o.id && o.nombre)
}
