/**
 * El enlace del paciente en formato de PANTALLAS: el portal web (13/10/2026).
 *
 * Era `app/p/[token]/page.tsx`. Sigue siendo esa página y nada más —
 * `app/p/[token]/page.tsx` es su único llamador—; está como componente porque
 * durante unos días hubo un segundo formato que la reusaba.
 *
 * ── Lo que pasó con el chat (14/10/2026) ───────────────────────────────────
 *
 * `app/c/[token]/page.tsx` dibujaba ESTA máquina de pasos como burbujas. Se
 * veía como un chat y no lo era: los pasos del portal no son los del bot, así
 * que el paciente derivado desde WhatsApp se encontraba con un flujo distinto
 * del que venía teniendo, con el mismo aspecto. Ahora el chat tiene su propia
 * página y corre el motor conversacional de verdad — ver
 * `components/enlace/pagina-del-chat.tsx` y `lib/enlace/conversacion.ts`.
 *
 * Lo que las dos páginas SÍ comparten es lo que tiene que contestar igual en
 * las dos: las guardas de vigencia del enlace, en
 * `components/portal/pantalla-terminal.tsx`. Son los bordes que ya costaron
 * casos reales —el enlace vencido, el usado dos veces, el fuera de plazo— y
 * duplicarlos sería garantizar que un día se arregle uno y no el otro.
 *
 * `formato` quedó, acotado a "pantallas": es lo que el monitor usa para marcar
 * con qué interfaz se abrió el enlace. Está tipado así a propósito, para que
 * nadie vuelva a pasarle "chat" y renderice el híbrido sin darse cuenta.
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
import {
  decidirPaso,
  ofreceVerTodos,
  opcionesDeBusqueda,
  type TipoDeBusqueda,
} from "@/lib/portal/pasos"
import { marcaDelPortal } from "@/lib/portal/marca"
import { rutaDelFormato, type FormatoDelEnlace } from "@/lib/portal/token"
import { pantallaTerminal } from "@/components/portal/pantalla-terminal"

/** La cookie que ata el enlace al dispositivo que lo abrió primero. */
const COOKIE_DISPOSITIVO = "portal_dispositivo"
import { agendaParaReprogramar, agendaParaTurnoNuevo, turnosDeEjemplo } from "@/lib/portal/agenda"
import {
  obtenerEspecialidades,
  obtenerTodosLosProfesionales,
  obtenerTodasLasSedes,
} from "@/lib/api-tools/api-functions"
import { getWhatsAppConfigById } from "@/lib/db"
import { EnlaceDePaso } from "@/components/portal/enlace-de-paso"
import {
  Marco,
  Avance,
  Aviso,
  EncabezadoDelPaso,
  ResumenDelTurno,
  Volver,
} from "@/components/portal/marco"
import { AnotarHito } from "@/components/portal/anotar-hito"
import { lineasDeContactoParaWeb, telefonoParaMensajes} from "@/lib/utils/escalation-contact"
import type { AnchoDelMarco } from "@/components/portal/marco"
import { ElegirFiltro } from "@/components/portal/elegir-filtro"
import { SelectorDeTurnos } from "@/components/portal/selector-de-turnos"
import { PedirDNI, DarseDeAlta } from "@/components/portal/identificarse"
import { GestionarTurno } from "@/components/portal/gestionar-turno"
import { reemplazaElTurnoPrevio } from "@/lib/portal/vigencia"
import {
  correspondeOfrecerParticular,
  deudorParticular,
  ofreceTurnosParticulares,
} from "@/lib/portal/particular"
import { registroDelPortal, datosDeLaVisita } from "@/lib/portal/registro"

export async function PaginaDelEnlace({
  params,
  searchParams,
  formato,
}: {
  params: Promise<{ token: string }>
  /** Siempre "pantallas". Ver la cabecera: el chat tiene su propia página. */
  formato: Extract<FormatoDelEnlace, "pantallas">
  searchParams: Promise<{
    /** Volver a un paso anterior a propósito. Ver PASOS_REVISITABLES. */
    paso?: string
    /** Lo elegido en la pantalla de gestión del turno. */
    accion?: string
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

  // Las cuatro pantallas sin salida —enlace inexistente, vencido, ya
  // gestionado, fuera de plazo— viven en `pantallaTerminal`, compartidas con la
  // página del chat. Ver la cabecera de ese archivo.
  if (!lectura) {
    return (
      <>
        {pantallaTerminal({
          lectura: null,
          marca: marcaDelPortal(null),
          token,
          cookieNueva: secretoNuevo,
          nombreCookie: COOKIE_DISPOSITIVO,
          formato,
        })}
      </>
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

  const terminal = pantallaTerminal({
    lectura,
    marca,
    token,
    cookieNueva: secretoNuevo,
    nombreCookie: COOKIE_DISPOSITIVO,
    formato,
  })
  if (terminal) return <>{terminal}</>

  if (dispositivoDistinto) {
    console.warn(`[PORTAL] ${contexto.phone} abrió su enlace desde otro dispositivo`)
  }

  const permisos = {
    porEspecialidad: config?.enableSearchBySpecialty,
    porProfesional: config?.enableSearchByProfessional,
    porCualquiera: config?.enableSearchByAnyDoctor,
  }
  const filtros: {
    accion?: string
    sedeId?: string
    sedeResuelta?: boolean
    tipoBusqueda?: TipoDeBusqueda
    especialidadId?: string
    profesionalId?: string
    sinFiltro: boolean
  } = {
    // La del query gana sobre la del token: si el paciente eligió otra sede,
    // eligió otra sede.
    accion: filtrosCrudos.accion,
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

  /** La URL de este mismo enlace con un subconjunto de lo ya elegido. */
  const ruta = rutaDelFormato(formato)

  /** El "Volver" de arriba. `null` cuando no hay a dónde volver. */
  const volverArriba = (href: string | null | undefined) =>
    href ? <Volver href={href} /> : null
  const urlCon = (campos: Record<string, string>) => {
    const params = new URLSearchParams(campos)
    const query = params.toString()
    return query ? `/${ruta}/${token}?${query}` : `/${ruta}/${token}`
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
      ? urlCon({ paso: "registrar" })
      : contexto.identidad?.dni
        ? urlCon({ paso: "pedir_dni" })
        : null

  // Los mismos datos que muestra el bot antes de confirmar.
  //
  // Nombre y apellido van separados SÓLO cuando los tenemos separados —el
  // paciente que se dio de alta acá—. Cuando al paciente lo reconoció el bot
  // tenemos su nombre completo en una sola cadena y no se parte: "DE SANTIAGO,
  // Nicolas" partido por el primer espacio daría "DE" como apellido.
  const datosParaElResumen = {
    // Los nombres de pila cuando los tenemos separados —del alta o del
    // `Chatbot_Data`—; el nombre completo sólo como último recurso.
    nombre: identidad.nombre || contexto.pacienteNombres || contexto.pacienteNombre || undefined,
    apellido: identidad.apellido || contexto.pacienteApellido,
    dni: identidad.dni,
    // Lo que averiguó el portal manda sobre lo que trajo el token, que puede
    // ser de hace horas. Con el id solo no se puede escribir nada, así que si
    // no hay nombre la fila no aparece —que es mejor que mostrar un número—.
    obraSocial: identidad.obraSocialNombre || contexto.obraSocialNombre,
  }

  const clienteId = contexto.clienteId || ""

  /**
   * El deudor "Particular" de esta clínica, si corresponde ofrecerlo.
   *
   * Una función y no un valor: resolverlo cuesta una lectura de Redis y la
   * mayoría de los pasos del portal —el DNI, la sede, el alta— no lo
   * necesitan. Las dos pantallas que sí lo usan llaman a esto, así que la
   * regla —el switch del cliente, y que el paciente no sea ya particular— se
   * escribe una sola vez.
   */
  const resolverParticular = async () =>
    ofreceTurnosParticulares(config) ? await deudorParticular(clienteId).catch(() => null) : null

  // ── La sede se resuelve antes de decidir el paso (24/9/2026) ─────────────
  //
  // El bug que esto arregla: el bloque de la sede se resolvía DESPUÉS, y
  // cuando la clínica tenía una sola sede (o el proxy no devolvía ninguna) no
  // renderizaba nada y dejaba seguir. Pero `paso` ya valía "elegir_sede", así
  // que los `if` de tipo de búsqueda, especialidad y profesional —todos
  // comparados contra `paso`— daban falso, y la ejecución caía hasta el bloque
  // de horarios del final.
  //
  // Resultado: del DNI a elegir horario de una, salteando tres pasos. Lo que
  // falló no fue la lógica de `decidirPaso` sino calcularla con información
  // que todavía no estaba: hay que preguntarle a la clínica cuántas sedes
  // tiene antes de saber si hay algo que preguntar.
  let sedesParaElegir: Array<{ id: string; nombre: string; detalle?: string }> = []

  if (decidirPaso(contexto.intencion, permisos, filtros, identidad, filtrosCrudos.paso) === "elegir_sede") {
    const sedes = (await obtenerTodasLasSedes(clienteId).catch(() => null))?.sedes || []
    sedesParaElegir = sedes
      .map((sede: any) => ({
        id: String(sede?.Id ?? ""),
        nombre: String(sede?.Nombre_Completo ?? "").trim(),
        detalle: [sede?.Domicilio, sede?.Localidad].filter(Boolean).join(" — ") || undefined,
      }))
      .filter((o) => o.id && o.nombre)

    // Con una sola no se pregunta: se usa. Con ninguna tampoco, y se sigue sin
    // filtrar por sede — es lo que hacía el portal antes de este paso.
    if (sedesParaElegir.length === 1) {
      filtros.sedeId = sedesParaElegir[0].id
      filtros.sedeResuelta = true
    } else if (sedesParaElegir.length === 0) {
      filtros.sedeResuelta = true
    }
  }

  const paso = decidirPaso(contexto.intencion, permisos, filtros, identidad, filtrosCrudos.paso)

  // ── El recorrido queda en el log (26/10/2026) ─────────────────────────────
  //
  // Una línea por render, con el mismo formato que las de WhatsApp, para que
  // filtrar por el teléfono muestre el recorrido entero: el paciente aprieta un
  // botón en el chat, abre el enlace, elige sede, profesional y horario, y todo
  // eso se lee de corrido en vez de cortarse al salir de WhatsApp.
  //
  // Va DESPUÉS de resolver la identidad y los filtros a propósito: la línea
  // tiene que decir con qué datos se decidió el paso, que es lo que después
  // explica una agenda vacía o un turno sin obra social.
  const registro = registroDelPortal(contexto, paso)
  registro.info("Paso del portal", datosDeLaVisita({ token, contexto, identidad, filtros, formato }))

  // El aviso de prueba va arriba de todo y en todas las pantallas. Si alguien
  // abre este enlace sin saber qué es, tiene que enterarse antes de tocar nada.
  const avisoDemo = contexto.demo ? (
    <Aviso
      titulo="Enlace de prueba"
      detalle="Podés recorrer todas las pantallas. No se reserva ni se cancela ningún turno real."
      tono="atencion"
    />
  ) : null

  // `ancho` sólo lo pide el paso de agenda, donde el calendario y los horarios
  // van uno al lado del otro en pantallas grandes. Ver `Marco`.
  /** El envoltorio de cada paso. TODOS los pasos pasan por acá. */
  const marco = (hijos: React.ReactNode, ancho: AnchoDelMarco = "normal") => (
    <Marco
      marca={marca}
      cookieNueva={secretoNuevo}
      nombreCookie={COOKIE_DISPOSITIVO}
      ancho={ancho}
      token={token}
      formato={formato}
    >
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
        {/* SIN "Volver" (5/10/2026).
            
            Tenía uno que apuntaba a `urlCon({})`, o sea a la pantalla
            siguiente. Con el DNI ya resuelto eso era un bucle cerrado:
            desde la sede, "Volver" traía acá; desde acá, "Volver" devolvía a
            la sede. El paciente que quería corregir el documento rebotaba
            entre las dos pantallas sin llegar nunca a ningún lado.
            
            Este es el PRIMER paso del portal: no hay nada antes, así que no
            hay a dónde volver. La salida hacia adelante es el botón
            "Continuar" del formulario, que con el DNI sin cambios simplemente
            sigue. */}
        <EncabezadoDelPaso formato={formato} paso="pedir_dni" paraFamiliar={paraFamiliar} />
        <PedirDNI ruta={ruta} token={token} paraFamiliar={paraFamiliar} valorInicial={contexto.identidad?.dni} />
      </>,
    )
  }

  // ── No tiene ficha: alta ────────────────────────────────────────────────
  if (paso === "registrar") {
    return marco(
      <>
        {/* El paso anterior al alta es el DNI, no la sede (5/10/2026). Antes
            esto apuntaba a `urlCon({})` —hacia adelante— y el que se había
            equivocado un dígito no tenía cómo corregirlo: el único camino era
            completar un alta que sabía mal. */}
        {volverArriba(urlCon({ paso: "pedir_dni" }))}
        <EncabezadoDelPaso formato={formato} paso="registrar" paraFamiliar={paraFamiliar} />
        <DarseDeAlta ruta={ruta}
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
    const telefonosDeDerivacion = lineasDeContactoParaWeb(telefonoParaMensajes(config))

    return marco(
      <>
        <Aviso
          tono="atencion"
          titulo={
            nombreOS
              ? `Los turnos de ${nombreOS} se gestionan por teléfono`
              : "Tu turno se gestiona por teléfono"
          }
          // El mismo bloque de contacto que manda el bot por WhatsApp
          // (1/10/2026). El `escalationPhoneNumber` de estas clínicas no es un
          // número suelto: es el 0800 y el WhatsApp de cada sede, una línea
          // por sede. Antes se interpolaba en medio de una oración —"comunicate
          // al {bloque} y te lo dan enseguida"— y quedaba ilegible.
          detalle={
            telefonosDeDerivacion.length > 0 ? (
              <>
                <p>Para sacarlo, comunicate con la clínica:</p>
                <div className="mt-2 space-y-0.5 font-medium text-foreground">
                  {telefonosDeDerivacion.map((linea, i) => (
                    <div key={i}>{linea}</div>
                  ))}
                </div>
              </>
            ) : (
              "Escribinos por WhatsApp y te pasamos el contacto de la clínica."
            )
          }
        />
      </>,
    )
  }

  // ── Qué hacer con el turno ──────────────────────────────────────────────
  //
  // Las tres salidas juntas. Ver la nota de `GestionarTurno` sobre por qué
  // están en una sola pantalla y no en tres mensajes de WhatsApp.
  if (paso === "gestionar_turno") {
    return marco(
      <GestionarTurno
        token={token}
        turno={contexto.turno}
        nombre={nombre}
        urlParaReagendar={urlCon({ accion: "reagendar" })}
      />,
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
    const direcciones = dias.length > 0 ? await direccionesDeLasSedes(clienteId) : {}

    return marco(
      <>
        {usaEjemplos && (
          <Aviso
            titulo="Horarios de ejemplo"
            detalle="La agenda real no devolvió turnos disponibles, así que estos son inventados para poder seguir probando."
            tono="atencion"
          />
        )}
        {/* Pantalla vacía nunca (23/9/2026).
            Antes, con la agenda en cero el selector se dibujaba sin nada y el
            paciente se quedaba mirando un cuadro blanco. La compuerta de
            `permiteReprogramarOnline` evita que se llegue acá en el caso
            conocido, pero hay otros —la agenda se llenó entre el recordatorio
            y el clic— y el paciente merece una frase igual.
            Cuando el proxy explica por qué no hay turnos, se usa SU mensaje:
            sabe cosas que nosotros no. */}
        {dias.length === 0 && <AnotarHito token={token} hito="sin_horarios" formato={formato} />}

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
            formato={formato}
            dias={dias}
            paciente={datosParaElResumen}
            corregirDatosEn={corregirDatosEn}
            etiquetaConfirmar="Confirmar el cambio"
            accion="cambiar"
            reemplazaA={contexto.turno}
            profesionalFijo={
              agenda.filtradoPorProfesional ? agenda.profesionalNombre : undefined
            }
            direccionesPorSede={direcciones}
            // Va adentro y no acá arriba porque tiene que irse cuando el
            // paciente pasa al repaso: el turno viejo y "elegí el nuevo
            // horario" son de ESTA pantalla, no de las tres.
            encabezado={
              <>
                {/* El turno actual va PRIMERO (28/9/2026).
                    El orden de arriba abajo es el de la pregunta que el
                    paciente se hace: "¿cuál es el turno que tengo?" y recién
                    después "¿cuál elijo?". Con el título arriba, la tarjeta
                    quedaba entre la instrucción y el calendario, partiendo en
                    dos lo que hay que hacer. */}
                {contexto.turno && (
                  <ResumenDelTurno
                    turno={contexto.turno}
                    titulo="Tu turno actual"
                    detalle="Éste es el turno que vas a reemplazar. Verificá que sea el correcto antes de elegir el nuevo."
                  />
                )}

                {/* Sin "Hola, Nicolas": el saludo iba cuando el título era lo
                    primero de la pantalla. Ahora llega después de la tarjeta
                    del turno, donde ya quedó claro de qué se trata, y un
                    saludo a mitad de camino suena a que la página empezó dos
                    veces. */}
                <EncabezadoDelPaso formato={formato} paso="reprogramar" />

                {/* Si no se pudo identificar al profesional se ofrecen turnos
                    de la sede, y hay que decirlo: el paciente asume que ve los
                    de su médico. */}
                {!agenda.filtradoPorProfesional && agenda.total > 0 && contexto.turno?.profesional && (
                  <Aviso
                    titulo="Estos son todos los horarios de la sede"
                    detalle={`No pudimos filtrar sólo por ${contexto.turno.profesional}. Mirá el profesional antes de confirmar.`}
                    tono="atencion"
                  />
                )}

                {agenda.filtradoPorProfesional && agenda.profesionalNombre && (
                  <Aviso
                    tono="neutro"
                    titulo={`Horarios disponibles con ${agenda.profesionalNombre}.`}
                  />
                )}
              </>
            }
          />
        )}
      </>,
      "amplio",
    )
  }

  // ── Elegir sede ─────────────────────────────────────────────────────────
  //
  // La lista ya se trajo más arriba: acá sólo se muestra. Separar "averiguar"
  // de "mostrar" es lo que evita el bug de calcular el paso con datos que
  // todavía no existían.
  if (paso === "elegir_sede") {
    return marco(
      <>
        {volverArriba(volverQuitando())}
        <EncabezadoDelPaso formato={formato} paso="elegir_sede" />
        <ElegirFiltro ruta={ruta} token={token} campo="sedeId" opciones={sedesParaElegir} />
      </>,
    )
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
        {volverArriba(volverQuitando())}
        {/* El saludo va una sola vez, en la banda de arriba con el nombre de
            la clínica. Repetirlo en cada título hacía que todas las pantallas
            parecieran la primera. */}
        <EncabezadoDelPaso formato={formato} paso="elegir_tipo_busqueda" />
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
    const opciones = normalizarOpciones(await obtenerEspecialidades(clienteId).catch(() => null), "especialidades")

    // Sin especialidades no se frena al paciente en una pantalla vacía: se
    // salta al paso siguiente con un enlace que ya trae el `sinFiltro`.
    if (opciones.length > 0) {
      return marco(
        <>
          {volverArriba(volverQuitando())}
          <EncabezadoDelPaso formato={formato} paso="elegir_especialidad" />
          <ElegirFiltro ruta={ruta} token={token} campo="especialidadId" opciones={opciones} conservar={elegido} />
          {ofreceVerTodos(permisos) && (
            <VerTodos token={token} ruta={ruta} etiqueta="Ver todos los horarios" conservar={elegido} />
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
    const listaDeProfesionales = normalizarOpciones(
      await obtenerTodosLosProfesionales(clienteId).catch(() => null),
      "profesionales",
    )

    // ── Quién tiene agenda de verdad (30/9/2026) ─────────────────────────
    //
    // La lista de arriba es el directorio de la clínica: están todos, tengan
    // turnos o no. Elegir a uno sin agenda llevaba a una pantalla con dos
    // mensajes de error encadenados —"no encontramos horarios con esos
    // filtros" y "no hay horarios disponibles"—. El portal le ofrecía algo
    // que ya sabía que no iba a funcionar.
    //
    // La disponibilidad sale de UNA consulta de agenda sin filtrar por
    // profesional: los turnos traen su `profesionalId`, así que el conjunto
    // de los que aparecen es el de los que tienen algo en los próximos 60
    // días. Es la misma consulta que se hace un paso después si el paciente
    // elige "cualquier profesional", así que no es una llamada de más en el
    // camino, es la misma adelantada.
    //
    // Ante un fallo se deja TODO habilitado. Deshabilitar por no haber
    // podido preguntar sería bloquear al paciente por un problema nuestro;
    // que toque y se encuentre con el mensaje de siempre es menos malo.
    // ── La segunda consulta: ¿y de forma particular? (27/10/2026) ─────────
    //
    // Con una sola consulta —la de arriba, filtrada por la obra social del
    // paciente— "no tiene agenda" y "tiene agenda pero no atiende tu obra
    // social" son el mismo cero, y las dos terminaban en "Sin turnos
    // disponibles por ahora". En la segunda situación el paciente sí se podía
    // atender, pagando la consulta, y el portal se lo escondía.
    //
    // Así que se pregunta otra vez con el deudor Particular de esta clínica.
    // Las dos salen juntas: es una consulta más, no un paso más de espera.
    //
    // No se hace si la clínica no tiene un deudor "PARTICULAR" (ahí
    // `deudorParticular` devuelve null y todo queda como estaba), ni si el
    // paciente YA es particular —decirle que su obra social no es aceptada
    // sería falso—.
    const particular = await resolverParticular()
    const ofrecerParticular = correspondeOfrecerParticular(identidad.obraSocialId, particular)

    const [agendaParaSaberQuienTiene, agendaParticular] =
      listaDeProfesionales.length > 0
        ? await Promise.all([
            agendaParaTurnoNuevo({
              clienteId,
              phone: contexto.phone,
              sedeId: filtros.sedeId,
              especialidadId: filtros.especialidadId,
              pacienteDNI: identidad.dni,
              tieneFicha: identidad.tieneFicha === true,
              obraSocialId: identidad.obraSocialId,
            }).catch(() => null),
            ofrecerParticular
              ? agendaParaTurnoNuevo({
                  clienteId,
                  phone: contexto.phone,
                  sedeId: filtros.sedeId,
                  especialidadId: filtros.especialidadId,
                  pacienteDNI: identidad.dni,
                  tieneFicha: identidad.tieneFicha === true,
                  obraSocialId: particular!.id,
                }).catch(() => null)
              : Promise.resolve(null),
          ])
        : [null, null]

    const profesionalesDe = (agenda: { dias?: { turnos: { profesionalId?: string }[] }[] } | null) =>
      new Set(
        (agenda?.dias || [])
          .flatMap((d) => d.turnos.map((t) => String(t.profesionalId || "")))
          .filter(Boolean),
      )

    const conAgenda = profesionalesDe(agendaParaSaberQuienTiene)
    const conParticular = profesionalesDe(agendaParticular)

    const opciones = listaDeProfesionales.map((o) => {
      const id = String(o.id)
      if (conAgenda.size > 0 && conAgenda.has(id)) return o

      // No aparece con su obra social, pero sí bajo Particular: se ofrece, y
      // el enlace se lleva la marca para que todo lo que sigue —la agenda, el
      // aviso, el resumen y la reserva— use esa cobertura y no la suya.
      // Se ofrece, y la pantalla de horarios se encarga del resto: la agenda
      // fusionada va a traer sólo huecos particulares para este profesional y
      // los va a marcar uno por uno. No hace falta decírselo por la URL.
      if (conParticular.has(id)) {
        return { ...o, detalle: "Sólo de forma particular" }
      }

      const sinTurnos = conAgenda.size > 0 || conParticular.size > 0
      return sinTurnos
        ? { ...o, deshabilitada: true, detalle: "Sin turnos disponibles por ahora" }
        : o
    })

    // Nadie tiene agenda: se dice acá, no después de hacerlo elegir. La
    // consulta tiene que haber funcionado —si falló, `agendaParaSaberQuienTiene`
    // es null y no se afirma nada—, y el modo demo se saltea porque ahí la
    // agenda real está vacía a propósito y los horarios son inventados.
    if (
      !contexto.demo &&
      agendaParaSaberQuienTiene &&
      agendaParaSaberQuienTiene.total === 0 &&
      conAgenda.size === 0 &&
      // Y tampoco hay nada particular (27/10/2026). Sin esta línea, una
      // clínica donde ningún profesional atiende la obra social del paciente
      // pero varios tienen horarios particulares le diría "no hay turnos" y
      // no llegaría a ver la lista que acabamos de construir.
      conParticular.size === 0
    ) {
      const volverA = volverQuitando()
      return marco(
        <>
          {volverArriba(volverA)}
          <Avance actual="Elegir" />
          <Aviso
            tono="atencion"
            titulo="No hay turnos disponibles por ahora"
            detalle={
              mensajeSinTurnos(agendaParaSaberQuienTiene.infoSinTurnos) ||
              "Ningún profesional tiene horarios en los próximos 60 días. Escribinos por WhatsApp y buscamos una alternativa."
            }
          />
        </>,
      )
    }

    if (opciones.length > 0) {
      // Se conserva TODO lo elegido, no sólo la especialidad: antes la sede
      // elegida se perdía al pasar a este paso y la agenda volvía a buscarse
      // sin ella.
      const conservar = elegido
      const volverA = volverQuitando()
      return marco(
        <>
          {volverArriba(volverA)}
          <EncabezadoDelPaso formato={formato} paso="elegir_profesional" />
          <ElegirFiltro ruta={ruta} token={token} campo="profesionalId" opciones={opciones} conservar={conservar} />
          {/* "Cualquier profesional" y no "Me da igual el profesional": es la
              misma opción que la del paso anterior y tiene que llamarse igual,
              y además "me da igual" suena a resignación cuando en realidad es
              la vía más rápida al turno más próximo. */}
          {ofreceVerTodos(permisos) && (
            <VerTodos
              token={token}
              ruta={ruta}
              etiqueta="Cualquier profesional"
              detalle="Para ver los turnos más próximos disponibles"
              conservar={conservar}
            />
          )}
        </>,
      )
    }
  }

  // ── Elegir horario ──────────────────────────────────────────────────────
  // ── Los horarios que la obra social no cubre (27/10/2026) ────────────────
  //
  // La agenda se pide con las dos coberturas y vuelve fusionada: los huecos
  // que sólo existen bajo Particular llegan marcados con `soloParticular`.
  // Sirve igual para los tres flujos —un profesional, por especialidad y
  // cualquiera—, que es lo que no se podía hacer decidiéndolo por pantalla.
  //
  // `null` si la clínica no tiene ese deudor, y entonces no se fusiona nada:
  // esa clínica ve exactamente lo que veía antes.
  const particularDelTurno = await resolverParticular()
  const ofrecerParticularEnLaAgenda = correspondeOfrecerParticular(
    identidad.obraSocialId,
    particularDelTurno,
  )

  const agendaNueva = await agendaParaTurnoNuevo({
    clienteId,
    phone: contexto.phone,
    // La sede ELEGIDA, no la del token. Esto decía `contexto.sedeId`: el
    // paciente elegía una sede y la búsqueda salía con otra (o con ninguna).
    // El paso se veía y no servía para nada.
    sedeId: filtros.sedeId,
    profesionalId: filtros.profesionalId,
    especialidadId: filtros.especialidadId,
    // Del contexto unificado, no del token: un paciente que se identificó en
    // el portal tiene su DNI y su obra social sólo acá.
    pacienteDNI: identidad.dni,
    tieneFicha: identidad.tieneFicha === true,
    obraSocialId: identidad.obraSocialId,
    particularId: ofrecerParticularEnLaAgenda ? particularDelTurno!.id : undefined,
  })

  /**
   * Todos los horarios que se están mostrando son particulares.
   *
   * Es lo que pasa cuando el paciente eligió un profesional que no atiende su
   * obra social: la consulta con su cobertura vuelve vacía y lo único que hay
   * es particular. Ahí conviene decirlo UNA vez arriba en vez de repetir la
   * marca en cada uno de los treinta horarios.
   *
   * Se deduce de la agenda y no de la URL: el que decide es el resultado.
   */
  const todosParticulares =
    agendaNueva.total > 0 && agendaNueva.dias.every((d) => d.turnos.every((t) => t.soloParticular))

  const conEjemplos = contexto.demo === true && agendaNueva.total === 0
  const diasNuevos = conEjemplos ? turnosDeEjemplo() : agendaNueva.dias
  const direccionesNuevo = diasNuevos.length > 0 ? await direccionesDeLasSedes(clienteId) : {}

  // ── Con quién son estos horarios (30/9/2026) ──────────────────────────────
  //
  // `agendaNueva.profesionalNombre` sólo viene cuando la agenda resolvió al
  // profesional por nombre. Cuando el filtro llegó por `profesionalId` —que es
  // lo que pasa al venir del enlace de "reagendar con el mismo profesional"—
  // el id está pero el nombre no, y la pantalla terminaba diciendo "Horarios
  // disponibles." a secas.
  //
  // El nombre está en los turnos. Se usa sólo si TODOS son del mismo: si hay
  // varios, afirmar uno sería mentir, y ahí el nombre va al lado de cada
  // horario, que es donde sirve.
  const profesionalesEnAgenda = new Set(
    diasNuevos.flatMap((d) => d.turnos.map((t) => t.profesionalNombre)).filter(Boolean),
  )
  const profesionalDeLaAgenda =
    agendaNueva.profesionalNombre ||
    (profesionalesEnAgenda.size === 1 ? [...profesionalesEnAgenda][0] : undefined)

  /**
   * ── Una sola frase cuando no hay horarios (26/10/2026) ───────────────────
   *
   * Acá se dibujaban las dos: el aviso de esta pantalla ("No encontramos
   * horarios con esos filtros") y, abajo, el del propio SelectorDeTurnos ("No
   * hay horarios disponibles — No encontramos turnos en los próximos días"),
   * porque el selector se renderizaba igual con la lista vacía. El paciente
   * leía dos carteles que decían lo mismo con distintas palabras y le daban
   * consejos distintos.
   *
   * Peor: los dos anotaban el hito `sin_horarios`, así que cada pantalla vacía
   * contaba doble en el monitoreo.
   *
   * La rama de reprogramar ya hacía lo correcto —`dias.length > 0 &&
   * <SelectorDeTurnos>`— y además usaba el mensaje del proxy. Esta rama se
   * había quedado atrás. Ahora hacen lo mismo.
   */
  const sinHorarios = agendaNueva.total === 0 && !conEjemplos

  const encabezadoDeLosHorarios = (
    <>
      {volverArriba(volverQuitando())}
      <EncabezadoDelPaso formato={formato} paso="elegir_horario" />

      {/* Con quién son estos horarios. Es lo que decide si el nombre
          del profesional hace falta al lado de cada horario, así que
          conviene que el paciente lo lea antes.

          Si no sabemos con quién son, NO se pone nada: "Horarios
          disponibles." a secas no dice nada que el título no haya dicho
          ya, y una línea que no informa es ruido que empuja el
          calendario más abajo. */}
      {profesionalDeLaAgenda && !sinHorarios && (
        // Resaltado y no en gris: no es una nota al pie, es el filtro
        // con el que está mirando la agenda. Si no lo registra, elige un
        // horario creyendo que había más opciones de las que hay.
        <Aviso tono="neutro" titulo={`Horarios disponibles con ${profesionalDeLaAgenda}.`} />
      )}

      {/* ── Con qué cobertura está reservando (27/10/2026) ─────────────────
          Va ACÁ, arriba de la grilla, y no al final: cuando elige el horario
          ya tiene que saber que ese turno se paga. Enterarse en el mostrador
          es el peor lugar posible. Se repite en el repaso previo a confirmar,
          donde dice "Obra social: Particular". */}
      {todosParticulares && !sinHorarios && (
        <Aviso
          tono="atencion"
          titulo="Turnos particulares"
          detalle={
            filtros.profesionalId
              ? "Este profesional no atiende tu obra social — todos los horarios disponibles se reservan de forma particular."
              : "Tu obra social no cubre ninguno de estos horarios — se reservan de forma particular."
          }
        />
      )}
    </>
  )

  /** Lo mismo que el filtro de arriba, pero sin el profesional. */
  const sinElProfesional = { ...elegido }
  delete sinElProfesional.profesionalId

  return marco(
    <>
      {conEjemplos && (
        <Aviso
          titulo="Horarios de ejemplo"
          detalle="La agenda real no devolvió turnos con estos filtros, así que estos son inventados para poder seguir probando."
          tono="atencion"
        />
      )}

      {sinHorarios ? (
        <>
          {encabezadoDeLosHorarios}
          <AnotarHito token={token} hito="sin_horarios" formato={formato} />

          {/* El "por qué" del proxy manda sobre cualquier texto nuestro: sabe
              cosas que nosotros no —"hay agenda pero sólo se reserva por
              teléfono" es un cero que no se arregla cambiando filtros—. Es la
              misma función que ya usaba la rama de reprogramar. */}
          <Aviso
            tono="atencion"
            titulo={
              filtros.profesionalId
                ? "No encontramos horarios con ese profesional"
                : "No hay horarios disponibles"
            }
            detalle={
              mensajeSinTurnos(agendaNueva.infoSinTurnos) ||
              (!filtros.profesionalId
                ? "No encontramos turnos en los próximos días. Escribinos por WhatsApp y buscamos una alternativa."
                : reemplazaElTurnoPrevio(contexto.intencion)
                  ? // Reagendando: no se le sugiere cambiar de profesional.
                    "Puede que tenga la agenda completa. Escribinos por WhatsApp y buscamos un horario con el mismo profesional."
                  : "Puede que tenga la agenda completa. Probá con todos los horarios o escribinos por WhatsApp.")
            }
          />

          {/* ── Sólo cuando vino a sacar un turno, no a mover uno ─────────
              El consejo como botón y no como frase: "probá sin elegir
              profesional" obligaba al paciente a descubrir solo cómo se hace
              eso, y la única forma era el "Volver" de arriba.

              Pero NO se ofrece si está reagendando (26/10/2026). El que viene
              de "Cambiarlo de horario" quiere el mismo turno en otro momento,
              con SU médico: ofrecerle la agenda de cualquier otro profesional
              es ofrecerle otra cosa, y encima la más fácil de aceptar sin
              darse cuenta. Si ese profesional no tiene horarios, la salida es
              la clínica, no otro médico.

              `reemplazaElTurnoPrevio` es la misma función que decide si hay que
              cancelar el turno viejo al reservar: una sola respuesta a "¿esto
              reemplaza un turno?", que es justamente lo que ya se había
              unificado el 25/9. */}
          {filtros.profesionalId &&
            !reemplazaElTurnoPrevio(contexto.intencion) &&
            ofreceVerTodos(permisos) && (
            <VerTodos
              token={token}
              ruta={ruta}
              etiqueta="Ver todos los horarios"
              detalle="Con cualquier profesional"
              conservar={sinElProfesional}
            />
          )}
        </>
      ) : (
        <SelectorDeTurnos
          token={token}
          formato={formato}
          dias={diasNuevos}
          paciente={datosParaElResumen}
          // Cómo se llama "Particular" en esta clínica. El selector lo usa en
          // el repaso cuando el horario elegido es de los que no cubre la obra
          // social: el paciente tiene que leerlo antes de confirmar.
          nombreParticular={particularDelTurno?.nombre}
          corregirDatosEn={corregirDatosEn}
          etiquetaConfirmar="Confirmar mi turno"
          direccionesPorSede={direccionesNuevo}
          // El MISMO valor que decide el aviso azul de arriba. Si el aviso dice
          // "Horarios disponibles con X", los chips no repiten el nombre; si no
          // lo dice, cada horario lo lleva. Dos reglas separadas para la misma
          // pregunta es cómo un día aparecía el nombre y al siguiente no.
          profesionalFijo={profesionalDeLaAgenda}
          // El "Volver" va adentro por el mismo motivo que el título: en el
          // repaso el paso atrás es "Elegir otro horario", y dos formas de
          // volver que hacen cosas distintas en la misma pantalla es cómo se
          // pierde el turno que ya se eligió.
          encabezado={encabezadoDeLosHorarios}
        />
      )}
    </>,
    "amplio",
  )
}

/**
 * La dirección de cada sede, por id (28/9/2026).
 *
 * El paciente confirma un turno mirando "Sede: OFTALMO Medicina Ocular". Con
 * una sola sede alcanza; con varias de la misma institución, sede y dirección
 * son una unidad y el nombre solo no le dice a dónde tiene que ir.
 *
 * Sale de la misma llamada que arma la lista de sedes, que ya devuelve el
 * domicilio. Se resuelve por el `sedeId` del turno ELEGIDO y no por el filtro:
 * quien buscó sin filtrar por sede puede terminar eligiendo un horario de
 * cualquiera de ellas.
 *
 * Si la llamada falla se devuelve un mapa vacío y la fila no se muestra. Una
 * dirección equivocada es peor que ninguna: manda a alguien a otro lado.
 */
async function direccionesDeLasSedes(clienteId: string): Promise<Record<string, string>> {
  const sedes = (await obtenerTodasLasSedes(clienteId).catch(() => null))?.sedes || []
  const mapa: Record<string, string> = {}
  for (const sede of sedes) {
    const id = String((sede as any)?.Id ?? "")
    const domicilio = String((sede as any)?.Domicilio ?? "").trim()
    if (id && domicilio) mapa[id] = domicilio
  }
  return mapa
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
  detalle,
  conservar,
  ruta,
}: {
  token: string
  etiqueta: string
  /** La línea de abajo, igual que en las opciones de la lista. */
  detalle?: string
  conservar?: Record<string, string>
  /** "p" o "c". Ver `rutaDelFormato`: sin esto el chat volvía a las pantallas. */
  ruta: string
}) {
  const params = new URLSearchParams({ ...(conservar || {}), sinFiltro: "1" })
  return (
    <EnlaceDePaso
      href={`/${ruta}/${token}?${params.toString()}`}
      className="mt-3 flex min-h-[56px] items-center justify-center rounded-xl border bg-card px-4 py-3 text-center text-card-foreground no-underline hover:bg-accent"
    >
      <span className="block">
        <span className="block font-medium">{etiqueta}</span>
        {detalle && <span className="mt-0.5 block text-sm text-muted-foreground">{detalle}</span>}
      </span>
    </EnlaceDePaso>
  )
}

/**
 * Las listas vienen con nombres de campo distintos según el endpoint y la
 * clínica. Se aceptan las variantes conocidas y se descarta lo que no tenga id
 * y nombre, en vez de mostrar opciones vacías que no llevan a ningún lado.
 */
/**
 * El primer valor no vacío de una lista de nombres de campo posibles.
 *
 * La API devuelve el mismo dato con distinto nombre según el endpoint y la
 * clínica: `Id`, `id`, `Codigo`, `Subespecialidad_Id`… Probar varios es más
 * barato que normalizar el proxy de cada cliente.
 */
function primerCampo(item: any, campos: string[]): string {
  for (const campo of campos) {
    const valor = item?.[campo]
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim()
    }
  }
  return ""
}

const CAMPOS_ID = [
  "id",
  "Id",
  "ID",
  "codigo",
  "Codigo",
  "Subespecialidad_Id",
  "Especialidad_Id",
  "Profesional_Id",
  "Sede_Id",
]

const CAMPOS_NOMBRE = [
  "nombre",
  "Nombre",
  "descripcion",
  "Descripcion",
  "Nombre_Completo",
  "nombre_completo",
  "Detalle",
  "detalle",
  "Subespecialidad",
  "Especialidad",
]

/**
 * Normaliza las listas del proxy (especialidades, profesionales) al par que
 * necesita el selector.
 *
 * ── Lo que se descarta, se dice (24/9/2026) ────────────────────────────────
 *
 * Reportado: la lista de subespecialidades del portal traía menos ítems que la
 * misma request en Postman.
 *
 * La versión anterior probaba tres nombres de campo y filtraba en silencio lo
 * que no encajaba. Un ítem cuyo nombre viniera como `Descripcion` o cuyo id
 * fuera `Subespecialidad_Id` desaparecía sin dejar rastro: el paciente veía
 * una lista más corta y nadie se enteraba, porque una lista corta parece una
 * lista.
 *
 * Es el mismo error de siempre con otra ropa — tratar "no supe leerlo" como
 * "no existe". Ahora se prueban más nombres Y se loguea lo que igual queda
 * afuera, con las claves del ítem, así la próxima vez el log dice qué campo
 * falta en vez de que haya que adivinarlo.
 */
function normalizarOpciones(respuesta: any, queEs = "opciones"): Array<{ id: string; nombre: string }> {
  const datos = respuesta?.datos ?? respuesta
  const lista = Array.isArray(datos)
    ? datos
    : datos?.especialidades || datos?.subespecialidades || datos?.profesionales || []
  if (!Array.isArray(lista)) return []

  const opciones: Array<{ id: string; nombre: string }> = []
  const descartados: string[] = []

  for (const item of lista) {
    const id = primerCampo(item, CAMPOS_ID)
    const nombre = primerCampo(item, CAMPOS_NOMBRE)

    if (id && nombre) {
      opciones.push({ id, nombre })
    } else {
      descartados.push(
        `{${Object.keys(item || {}).join(", ")}}${id ? "" : " ← sin id"}${nombre ? "" : " ← sin nombre"}`,
      )
    }
  }

  if (descartados.length > 0) {
    console.warn(
      `[PORTAL] ⚠️ ${descartados.length} de ${lista.length} ${queEs} quedaron afuera por no encontrarles id o nombre. ` +
        `Claves de los descartados: ${descartados.slice(0, 5).join(" | ")}`,
    )
  }

  return opciones
}
