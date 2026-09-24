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
import {
  decidirPaso,
  ofreceVerTodos,
  opcionesDeBusqueda,
  type TipoDeBusqueda,
} from "@/lib/portal/pasos"
import { marcaDelPortal } from "@/lib/portal/marca"
import { agendaParaReprogramar, agendaParaTurnoNuevo, turnosDeEjemplo } from "@/lib/portal/agenda"
import {
  obtenerEspecialidades,
  obtenerTodosLosProfesionales,
  obtenerTodasLasSedes,
} from "@/lib/api-tools/api-functions"
import { getWhatsAppConfigById } from "@/lib/db"
import { Marco, Aviso, ResumenDelTurno, TituloDePaso, Volver } from "@/components/portal/marco"
import { ElegirFiltro } from "@/components/portal/elegir-filtro"
import { SelectorDeTurnos } from "@/components/portal/selector-de-turnos"
import { PedirDNI, DarseDeAlta } from "@/components/portal/identificarse"

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
  searchParams: Promise<{
    /** Volver a un paso anterior a propósito. Ver PASOS_REVISITABLES. */
    paso?: string
    sedeId?: string
    tipoBusqueda?: string
    especialidadId?: string
    profesionalId?: string
    sinFiltro?: string
  }>
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
          tono="atencion"
          titulo="Este enlace ya no está disponible"
          detalle="Puede haber vencido o haberse usado. Escribinos por WhatsApp y te mandamos uno nuevo."
        />
      </Marco>
    )
  }

  const { contexto, estado, dispositivoDistinto } = lectura
  const config = await getWhatsAppConfigById(contexto.configId)
  const marca = marcaDelPortal(config)
  // El nombre para saludar sale del token cuando el bot ya lo conocía, y de lo
  // que el paciente cargó en el portal cuando no. Sólo el primero: "Hola,
  // Nicolas" y no "Hola, Nicolas DE SANTIAGO".
  const nombre = (contexto.pacienteNombre || contexto.identidad?.nombre)
    ?.trim()
    .split(/\s+/)[0]

  if (!permiteVerDatos(estado)) {
    return (
      <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso
          tono="atencion"
          titulo="Este enlace venció"
          detalle="Escribinos por WhatsApp y te mandamos uno nuevo."
        />
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
        <p className="text-gray-600">Te va a llegar la confirmación por WhatsApp.</p>
      </Marco>
    )
  }

  if (!permiteGestionar(estado)) {
    return (
      <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
        <Aviso
          tono="atencion"
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
  const filtros: {
    sedeId?: string
    tipoBusqueda?: TipoDeBusqueda
    especialidadId?: string
    profesionalId?: string
    sinFiltro: boolean
  } = {
    // La del query gana sobre la del token: si el paciente eligió otra sede,
    // eligió otra sede.
    sedeId: filtrosCrudos.sedeId || contexto.sedeId,
    tipoBusqueda: filtrosCrudos.tipoBusqueda as TipoDeBusqueda | undefined,
    especialidadId: filtrosCrudos.especialidadId,
    profesionalId: filtrosCrudos.profesionalId,
    sinFiltro: filtrosCrudos.sinFiltro === "1",
  }

  /**
   * Lo elegido hasta ahora, para arrastrarlo en los enlaces de los pasos
   * siguientes y en el "Volver".
   *
   * Sólo va lo que el paciente eligió EN el portal (`filtrosCrudos`), no lo que
   * venía en el token: si la sede la trajo el enlace, no tiene sentido
   * repetirla en la URL de cada paso.
   */
  const elegido: Record<string, string> = {}
  if (filtrosCrudos.sedeId) elegido.sedeId = filtrosCrudos.sedeId
  if (filtrosCrudos.tipoBusqueda) elegido.tipoBusqueda = filtrosCrudos.tipoBusqueda
  if (filtrosCrudos.especialidadId) elegido.especialidadId = filtrosCrudos.especialidadId

  /** La URL de este mismo portal con un subconjunto de lo ya elegido. */
  const urlCon = (campos: Record<string, string>) => {
    const params = new URLSearchParams(campos)
    const query = params.toString()
    return query ? `/p/${token}?${query}` : `/p/${token}`
  }

  /**
   * A dónde vuelve el "Volver", quitando el último filtro elegido.
   *
   * Los pasos son: sede → cómo buscar → (especialidad | profesional) →
   * horarios. Volver es sacar el último que se puso, y `decidirPaso` recalcula
   * la pantalla sola. Escribir la cadena una vez acá evita que cada paso
   * invente la suya — que es lo que había, y por eso dos pasos volvían a
   * lugares distintos desde la misma situación.
   *
   * `null` cuando no hay a dónde volver: el primer paso del portal.
   */
  const volverQuitando = (): string | null => {
    const quedan = { ...elegido }
    for (const campo of ["profesionalId", "especialidadId", "tipoBusqueda", "sedeId"]) {
      if (quedan[campo]) {
        delete quedan[campo]
        return urlCon(quedan)
      }
    }

    // ── Y de ahí para atrás, a los pasos de identidad ─────────────────────
    //
    // La cadena no terminaba acá por casualidad: `decidirPaso` sólo avanza, así
    // que sin un pedido explícito nunca vuelve a pedir el DNI. El que se
    // equivocó un dígito al darse de alta no tenía cómo arreglarlo y el turno
    // se reservaba con el DNI equivocado.
    //
    // Sólo se ofrece cuando hay algo que corregir: si al paciente lo reconoció
    // el bot, sus datos vienen de la ficha de la clínica y no se editan desde
    // acá — mandarlo a una pantalla que no cambia nada sería peor que no
    // ofrecerla.
    if (contexto.identidad?.tieneFicha === false) return urlCon({ paso: "registrar" })
    if (contexto.identidad?.dni) return urlCon({ paso: "pedir_dni" })

    return null
  }
  // ── Quién es el paciente ─────────────────────────────────────────────────
  //
  // Cuando el bot lo reconoció por su teléfono, el token ya trae DNI y obra
  // social y estos campos salen de ahí. Cuando no, `contexto.identidad` es lo
  // que el propio portal fue averiguando: primero el DNI, después la ficha (o
  // el alta). Se unifican acá para que el resto de la página no tenga que
  // preguntarse de dónde vino cada dato.
  const identidad = {
    dni: contexto.identidad?.dni || contexto.pacienteDNI,
    fichaConsultada: contexto.identidad?.fichaConsultada,
    // Si el token ya traía DNI es porque el bot encontró al paciente: tiene ficha.
    tieneFicha: contexto.identidad?.tieneFicha ?? (contexto.pacienteDNI ? true : undefined),
    nombre: contexto.identidad?.nombre,
    apellido: contexto.identidad?.apellido,
    email: contexto.identidad?.email,
    obraSocialId: contexto.identidad?.obraSocialId || contexto.obraSocialId,
    obraSocialNombre: contexto.identidad?.obraSocialNombre,
    obraSocialBloqueada: contexto.identidad?.obraSocialBloqueada,
  }

  // Lo que se muestra en el repaso previo a confirmar. El nombre completo, no
  // el de pila: acá el paciente está verificando que el turno quede a nombre de
  // quien corresponde, que es justo el caso del turno para un familiar.
  /**
   * A dónde va "Corregir mis datos" desde la pantalla de confirmación.
   *
   * `null` para el paciente que reconoció el bot: sus datos salen de la ficha
   * de la clínica y no se editan desde el portal.
   */
  const corregirDatosEn =
    contexto.identidad?.tieneFicha === false
      ? `/p/${token}?paso=registrar`
      : contexto.identidad?.dni
        ? `/p/${token}?paso=pedir_dni`
        : null

  const datosParaElResumen = {
    nombre:
      contexto.pacienteNombre ||
      [identidad.nombre, identidad.apellido].filter(Boolean).join(" ") ||
      undefined,
    obraSocial: identidad.obraSocialNombre,
  }

  const paso = decidirPaso(contexto.intencion, permisos, filtros, identidad, filtrosCrudos.paso)
  const clienteId = contexto.clienteId || ""

  // El aviso de prueba va arriba de todo y en todas las pantallas. Si alguien
  // abre este enlace sin saber qué es, tiene que enterarse antes de tocar nada.
  const avisoDemo = contexto.demo ? (
    <Aviso
      titulo="Enlace de prueba"
      detalle="Podés recorrer todas las pantallas. No se reserva ni se cancela ningún turno real."
      tono="atencion"
    />
  ) : null

  const marco = (hijos: React.ReactNode) => (
    <Marco marca={marca} cookieNueva={secretoNuevo} nombreCookie={COOKIE_DISPOSITIVO}>
      {avisoDemo}
      {hijos}
    </Marco>
  )

  // El turno puede no ser para quien abrió el enlace: la opción 2 del menú es
  // "Solicitar turno para un familiar". Todo lo que se pida de acá en adelante
  // es de la persona que se va a atender, y los textos tienen que decirlo — si
  // dicen "tu DNI", el paciente carga el suyo y el turno queda a nombre
  // equivocado.
  const paraFamiliar = contexto.intencion === "familiar"

  // ── Decir quién sos ─────────────────────────────────────────────────────
  if (paso === "pedir_dni") {
    return marco(
      <>
        {/* Se llegó acá a propósito, para corregir: tiene que haber salida sin
            cambiar nada. */}
        {filtrosCrudos.paso && <Volver href={urlCon({})} />}
        <TituloDePaso
          tipo="dni"
          detalle={
            paraFamiliar
              ? "Si ya se atendió en la clínica, con esto alcanza: traemos sus datos solos."
              : "Si ya te atendiste en la clínica, con esto alcanza: traemos tus datos solos."
          }
        >
          {paraFamiliar ? "¿Cuál es el DNI de la persona que se va a atender?" : "¿Cuál es tu DNI?"}
        </TituloDePaso>
        <PedirDNI token={token} paraFamiliar={paraFamiliar} valorInicial={contexto.identidad?.dni} />
      </>,
    )
  }

  // ── No tiene ficha: alta ────────────────────────────────────────────────
  if (paso === "registrar") {
    return marco(
      <>
        {filtrosCrudos.paso && <Volver href={urlCon({})} />}
        <TituloDePaso
          tipo="datos"
          detalle={
            paraFamiliar
              ? "Completá los datos de la persona que se va a atender y seguimos con el turno."
              : "Completá estos datos y seguimos con el turno."
          }
        >
          {paraFamiliar ? "Es su primera vez con nosotros" : "Es tu primera vez con nosotros"}
        </TituloDePaso>
        <DarseDeAlta
          token={token}
          dni={identidad.dni}
          paraFamiliar={paraFamiliar}
          valoresIniciales={contexto.identidad}
        />
      </>,
    )
  }

  // ── La obra social no saca turnos online ────────────────────────────────
  //
  // Se corta ACÁ, antes de mostrar un solo horario. Es la lección del caso
  // Zelmira: la paciente recorrió sede, profesional y especialidad completas
  // para enterarse recién al final de que su obra social no podía. Hacerle
  // elegir un turno que no va a poder sacar es peor que decírselo de entrada.
  if (paso === "derivar_obra_social") {
    const nombreOS = identidad.obraSocialNombre
    return marco(
      <>
        <Aviso
          tono="atencion"
          titulo={
            nombreOS
              ? `Los turnos de ${nombreOS} se gestionan por teléfono`
              : "Tu turno se gestiona por teléfono"
          }
          detalle={
            config?.escalationPhoneNumber
              ? `Comunicate con la clínica al ${config.escalationPhoneNumber} y te lo dan enseguida.`
              : "Escribinos por WhatsApp y te pasamos el contacto de la clínica."
          }
        />
        <p className="text-[15px] text-gray-600">
          Tus datos quedaron guardados, así que no vas a tener que repetirlos.
        </p>
      </>,
    )
  }

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
            tono="atencion"
          />
        )}
        <TituloDePaso tipo="agenda">
          {nombre ? `Hola, ${nombre}. ` : ""}Elegí el nuevo horario
        </TituloDePaso>

        {contexto.turno && <ResumenDelTurno turno={contexto.turno} titulo="Tu turno actual" />}

        {/* Si no se pudo identificar al profesional se ofrecen turnos de la
            sede, y hay que decirlo: el paciente asume que ve los de su médico. */}
        {!agenda.filtradoPorProfesional && agenda.total > 0 && contexto.turno?.profesional && (
          <Aviso
            titulo="Estos son todos los horarios de la sede"
            detalle={`No pudimos filtrar sólo por ${contexto.turno.profesional}. Mirá el profesional antes de confirmar.`}
            tono="atencion"
          />
        )}

        {agenda.filtradoPorProfesional && agenda.profesionalNombre && dias.length > 0 && (
          <p className="text-[15px] text-gray-500">
            Horarios disponibles con {agenda.profesionalNombre}.
          </p>
        )}

        {/* Pantalla vacía nunca (23/9/2026).
            Antes, con la agenda en cero el selector se dibujaba sin nada y el
            paciente se quedaba mirando un cuadro blanco. La compuerta de
            `permiteReprogramarOnline` evita que se llegue acá en el caso
            conocido, pero hay otros —la agenda se llenó entre el recordatorio
            y el clic— y el paciente merece una frase igual.
            Cuando el proxy explica por qué no hay turnos, se usa SU mensaje:
            sabe cosas que nosotros no. */}
        {dias.length === 0 && (
          <Aviso
            tono="atencion"
            titulo="No hay horarios para reprogramar"
            detalle={
              mensajeSinTurnos(agenda.infoSinTurnos) ||
              "Puede que se hayan ocupado. Escribinos por WhatsApp y te ayudamos."
            }
          />
        )}

        {dias.length > 0 && (
          <SelectorDeTurnos
            token={token}
            dias={dias}
            paciente={datosParaElResumen}
            corregirDatosEn={corregirDatosEn}
            etiquetaConfirmar="Confirmar el cambio"
          />
        )}
      </>,
    )
  }

  // ── Elegir sede ─────────────────────────────────────────────────────────
  //
  // Con una sola sede no se pregunta: se usa y se sigue. Preguntarle a alguien
  // entre una sola opción es hacerlo tocar por nada.
  if (paso === "elegir_sede") {
    const sedes = (await obtenerTodasLasSedes(clienteId).catch(() => null))?.sedes || []
    const opciones = sedes
      .map((sede: any) => ({
        id: String(sede?.Id ?? ""),
        nombre: String(sede?.Nombre_Completo ?? "").trim(),
        detalle: [sede?.Domicilio, sede?.Localidad].filter(Boolean).join(" — ") || undefined,
      }))
      .filter((o) => o.id && o.nombre)

    if (opciones.length > 1) {
      return marco(
        <>
          <TituloDePaso tipo="elegir" detalle="Vas a ver los horarios de la sede que elijas.">
            {nombre ? `Hola, ${nombre}. ` : ""}¿A qué sede querés ir?
          </TituloDePaso>
          <ElegirFiltro token={token} campo="sedeId" opciones={opciones} />
        </>,
      )
    }

    // Una sola sede (o ninguna que se pueda leer): se sigue sin preguntar. Que
    // el proxy no devuelva sedes NO frena al paciente — la búsqueda sin sede
    // es lo que hacía el portal hasta ahora y sigue funcionando.
    if (opciones.length === 1) filtros.sedeId = opciones[0].id
  }

  // ── Cómo querés buscar ──────────────────────────────────────────────────
  //
  // Las tres opciones del bot, con los mismos nombres. Son caminos
  // alternativos: elegir una lleva directo a los horarios filtrados por ella,
  // no a otro filtro encima.
  if (paso === "elegir_tipo_busqueda") {
    const opciones = opcionesDeBusqueda(permisos).map((o) => ({
      id: o.id,
      nombre: o.nombre,
      detalle: o.detalle,
    }))

    return marco(
      <>
        {volverQuitando() && <Volver href={volverQuitando()!} />}
        <TituloDePaso tipo="elegir">
          {nombre ? `Hola, ${nombre}. ` : ""}¿Cómo querés buscar tu turno?
        </TituloDePaso>
        <ElegirFiltro
          token={token}
          campo="tipoBusqueda"
          opciones={opciones}
          conservar={filtrosCrudos.sedeId ? { sedeId: filtrosCrudos.sedeId } : undefined}
        />
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
          {volverQuitando() && <Volver href={volverQuitando()!} />}
          <TituloDePaso tipo="elegir">
            {nombre ? `Hola, ${nombre}. ` : ""}¿Qué tipo de consulta necesitás?
          </TituloDePaso>
          <ElegirFiltro token={token} campo="especialidadId" opciones={opciones} conservar={elegido} />
          {ofreceVerTodos(permisos) && (
            <VerTodos token={token} etiqueta="Ver todos los horarios" conservar={elegido} />
          )}
        </>,
      )
    }
  }

  // ── Elegir profesional ──────────────────────────────────────────────────
  //
  // Antes esta condición incluía `paso === "elegir_especialidad"`, para que
  // cuando no hubiera especialidades se cayera acá. Con los tipos de búsqueda
  // eso ya no corresponde: quien eligió "por especialidad" y se encuentra con
  // que no hay ninguna cargada no quiere elegir un profesional — quiere ver
  // los horarios. El salto ahora lo hace el bloque de especialidad.
  if (paso === "elegir_profesional") {
    const opciones = normalizarOpciones(await obtenerTodosLosProfesionales(clienteId).catch(() => null))

    if (opciones.length > 0) {
      // Se conserva TODO lo elegido, no sólo la especialidad: antes la sede
      // elegida se perdía al pasar a este paso y la agenda volvía a buscarse
      // sin ella.
      const conservar = elegido
      const volverA = volverQuitando()
      return marco(
        <>
          {volverA && <Volver href={volverA} />}
          <TituloDePaso tipo="elegir">
            {nombre ? `Hola, ${nombre}. ` : ""}¿Con qué profesional querés atenderte?
          </TituloDePaso>
          <ElegirFiltro token={token} campo="profesionalId" opciones={opciones} conservar={conservar} />
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
    // Del contexto unificado, no del token: un paciente que se identificó en
    // el portal tiene su DNI y su obra social sólo acá.
    pacienteDNI: identidad.dni,
    obraSocialId: identidad.obraSocialId,
  })

  const conEjemplos = contexto.demo === true && agendaNueva.total === 0
  const diasNuevos = conEjemplos ? turnosDeEjemplo() : agendaNueva.dias

  return marco(
    <>
      {conEjemplos && (
        <Aviso
          titulo="Horarios de ejemplo"
          detalle="La agenda real no devolvió turnos con estos filtros, así que estos son inventados para poder seguir probando."
          tono="atencion"
        />
      )}

      {volverQuitando() && <Volver href={volverQuitando()!} />}
      <TituloDePaso tipo="agenda">
        {nombre ? `Hola, ${nombre}. ` : ""}Elegí el horario que te quede mejor
      </TituloDePaso>

      {agendaNueva.total === 0 && !conEjemplos && (
        <Aviso
          titulo="No encontramos horarios con esos filtros"
          detalle="Probá sin elegir profesional, o escribinos por WhatsApp."
          tono="atencion"
        />
      )}

      <SelectorDeTurnos
        token={token}
        dias={diasNuevos}
        paciente={datosParaElResumen}
        corregirDatosEn={corregirDatosEn}
        etiquetaConfirmar="Confirmar mi turno"
      />
    </>,
  )
}

/**
 * El "por qué no hay turnos" que manda el proxy, si lo mandó (23/9/2026).
 *
 * `info_sin_turnos` es la parte de la respuesta que explica un cero. En el caso
 * que motivó esto decía: "Hay profesionales con agenda disponible pero solo se
 * pueden reservar por teléfono". Eso es mucho mejor que cualquier texto nuestro,
 * porque es la razón real y no una suposición.
 *
 * Devuelve `null` cuando no vino nada, y ahí el llamador pone su texto genérico.
 * Lo que no se hace es inventar una causa: un "no hay turnos disponibles" a
 * secas, cuando en realidad sí los hay pero por teléfono, es información falsa.
 */
function mensajeSinTurnos(info: any): string | null {
  if (!info || typeof info !== "object") return null

  const mensaje = typeof info.mensaje === "string" ? info.mensaje.trim() : ""
  if (!mensaje) return null

  const soloTelefono = Array.isArray(info.profesionales_disponibles_solo_telefono)
    ? info.profesionales_disponibles_solo_telefono
    : []

  const nombres = soloTelefono
    .map((p: any) => (typeof p?.nombre === "string" ? p.nombre.trim() : ""))
    .filter(Boolean)

  if (nombres.length > 0) {
    return `${mensaje} (${nombres.join(", ")}). Escribinos por WhatsApp y te ayudamos.`
  }

  return `${mensaje} Escribinos por WhatsApp y te ayudamos.`
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
      className="mt-3 block min-h-[56px] rounded-xl border border-gray-300 bg-white px-4 py-4 text-center text-gray-800 no-underline"
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
