/**
 * ¿Se ofrece "Confirmar asistencia" en el menú del turno? (25/9/2026)
 *
 * ── Por qué es una función y no un `&&` en cada lugar ──────────────────────
 *
 * Esta pregunta se responde en CINCO lugares: el saludo de un turno, el de
 * varios, el menú de vuelta después de una gestión, y los dos mapas de
 * números que dicen qué hace cada tecla. El texto lo arma
 * `patient-templates.ts`; el mapa, `patient-flow-handler.ts`. Son archivos
 * distintos y sus comentarios dicen, cada uno, "debe coincidir con el otro".
 *
 * Mientras coincidan no pasa nada. El día que una opción se cae en la lista
 * del texto y no en la de los números, el paciente lee "2- Cancelar el turno"
 * y el 2 hace otra cosa. Ya pasó: el caso Liliana (tel. 1155891028, 9/7/2026)
 * es exactamente eso — el menú ofrecía confirmar, el mapa no, y el "1"
 * terminó cancelando el turno de alguien que quería confirmarlo.
 *
 * Agregarle una condición nueva a esa pregunta copiándola cinco veces era
 * repetir el error a propósito. Acá se responde una vez.
 *
 * ── Qué agrega el portal ───────────────────────────────────────────────────
 *
 * En los clientes con portal web la confirmación se hace con el botón
 * "Confirmar" del recordatorio, que ya está en el chat y no cuesta un mensaje
 * nuevo. Ofrecerla además en el menú suma una opción —y corre todos los
 * números— para algo que el paciente tiene a un toque.
 *
 * Como consecuencia, el saludo de esos clientes tampoco dice "todavía no
 * confirmaste tu asistencia": nombrar algo que el menú no permite hacer deja
 * al paciente buscando una opción que no existe.
 */

export interface PermisosDeConfirmacion {
  /**
   * El estado del turno admite confirmar: "no confirmado" y con recordatorio
   * enviado. Lo calcula el llamador con `shouldOfferConfirmation` o
   * `classifyTurnoEstado`, que es donde vive ese criterio y sigue ahí.
   *
   * Con varios turnos el llamador pasa `true`: es el comportamiento que había
   * antes de esta función y no se cambia de contrabando.
   */
  estadoAdmiteConfirmar: boolean
  /** `WhatsAppConfig.clientePortalWeb`. */
  usaPortalWeb?: boolean
}

export function seOfreceConfirmarAsistencia(permisos: PermisosDeConfirmacion): boolean {
  return permisos.estadoAdmiteConfirmar && permisos.usaPortalWeb !== true
}

/**
 * ¿El saludo menciona que el turno está sin confirmar?
 *
 * Es la misma decisión mirada desde el texto: si no se puede confirmar desde
 * acá, no se nombra. Se expone aparte porque el saludo la necesita antes de
 * armar el menú y porque así las dos no pueden separarse.
 */
export function seMencionaLaFaltaDeConfirmacion(permisos: PermisosDeConfirmacion): boolean {
  return seOfreceConfirmarAsistencia(permisos)
}

/**
 * Las acciones del menú, EN ORDEN (30/9/2026).
 *
 * El orden es el número que el paciente responde: la primera es el "1".
 *
 * Existe porque esta lista se armaba en tres lugares —el texto del menú, el
 * mapa de números y, desde hoy, los botones interactivos— y el archivo ya
 * explica por qué eso termina mal. Los TEXTOS siguen siendo de cada
 * superficie: el menú escribe "Cancelar el turno médico" y el botón
 * "Cancelar turno", porque WhatsApp corta los títulos en 20 caracteres. Lo
 * que no puede diferir es qué opciones hay y en qué orden.
 */
export type AccionDelMenu =
  | "confirm_appointment"
  | "cancel_appointment"
  | "cancel_and_book_new_appointment"
  | "other_inquiry_intent"

export interface PermisosDelMenu extends PermisosDeConfirmacion {
  /** `WhatsAppConfig.permitirCancelacion`. Default true. */
  permitirCancelacion?: boolean
  /** `WhatsAppConfig.permitirNuevoTurno`. Default true. */
  permitirNuevoTurno?: boolean
  /** La obra social del paciente no admite turnos online. */
  obraSocialBloqueada?: boolean
}

/** Las gestiones, sin "Realizar otra consulta". */
export function gestionesDelTurno(permisos: PermisosDelMenu): AccionDelMenu[] {
  const acciones: AccionDelMenu[] = []

  if (seOfreceConfirmarAsistencia(permisos)) acciones.push("confirm_appointment")
  if (permisos.permitirCancelacion !== false) acciones.push("cancel_appointment")

  // La obra social bloqueada inhabilita sólo la parte de "solicitar uno
  // nuevo": cancelar sigue siendo una gestión válida para ese paciente.
  if (
    permisos.permitirCancelacion !== false &&
    permisos.permitirNuevoTurno !== false &&
    permisos.obraSocialBloqueada !== true
  ) {
    acciones.push("cancel_and_book_new_appointment")
  }

  return acciones
}

/**
 * ¿La única gestión posible es cancelar?
 *
 * Ese caso no muestra menú numerado: muestra un solo botón "Cancelar turno" y
 * deriva el resto por teléfono.
 */
export function soloSePuedeCancelar(permisos: PermisosDelMenu): boolean {
  const acciones = gestionesDelTurno(permisos)
  return acciones.length === 1 && acciones[0] === "cancel_appointment"
}

/**
 * El menú numerado completo. Vacío cuando no hay nada que ofrecer o cuando la
 * única gestión es cancelar, que se resuelve con un botón suelto.
 */
export function menuDelTurno(permisos: PermisosDelMenu): AccionDelMenu[] {
  const acciones = gestionesDelTurno(permisos)
  if (acciones.length === 0 || soloSePuedeCancelar(permisos)) return []
  return [...acciones, "other_inquiry_intent"]
}

/**
 * El título de cada acción como botón de WhatsApp.
 *
 * Son más cortos que los del menú escrito porque WhatsApp corta en 20
 * caracteres: "Cancelar el turno médico" son 24 y llegaría mutilado. Hay un
 * test que verifica el largo.
 */
export const BOTON_DE_LA_ACCION: Record<AccionDelMenu, string> = {
  confirm_appointment: "Confirmar asistencia",
  cancel_appointment: "Cancelar turno",
  cancel_and_book_new_appointment: "Cancelar y reagendar",
  other_inquiry_intent: "Otra consulta",
}

/** Máximo de botones que admite un mensaje interactivo de WhatsApp. */
export const MAXIMO_DE_BOTONES = 3


/**
 * ── El menú del paciente NUEVO (2/10/2026) ─────────────────────────────────
 *
 * Reportado: alguien escribió "Buen día necesito turno", después su nombre, su
 * DNI y su obra social, y recibió cuatro veces el mismo saludo. Nunca sacó el
 * turno.
 *
 * La causa es la de siempre en este archivo: el saludo ofrecía TRES opciones
 *
 *     1- Solicitar turno médico
 *     2- Solicitar turno para un familiar
 *     3- Realizar otra consulta
 *
 * y el mapa que interpreta la respuesta tenía DOS —`{1: turno, 2: consulta}`—,
 * escrito a mano y duplicado en los dos caminos de `patient-flow-handler.ts`
 * (el numérico y el de texto libre). Resultado: quien contestaba "2" pensando
 * en un familiar entraba en "otra consulta", y quien contestaba "3" no entraba
 * en ningún lado, así que el mensaje caía al dispatcher, el dispatcher pedía
 * "mostrá el menú principal" y volvía el saludo entero. Ese era el bucle.
 *
 * Lo llamativo es que `NEW_PATIENT_MENU` —la lista que usa el detector de
 * texto libre— SÍ tenía las tres desde siempre. O sea que la misma pregunta se
 * respondía en tres lugares y uno de ellos decía otra cosa.
 *
 * Por eso vive acá, junto al resto de los menús: es el mismo archivo y el
 * mismo motivo.
 */
export type AccionDelPacienteNuevo =
  | "book_appointment_intent"
  | "familiar_appointment_intent"
  | "other_inquiry_intent"

/**
 * Las opciones del saludo de paciente nuevo, EN ORDEN.
 *
 * Con `permitirNuevoTurno === false` el saludo es un mensaje de derivación
 * puro, sin menú ni botón: no hay ninguna opción válida que interpretar.
 * Devolver una lista vacía es lo que hace que un "1" suelto no active nada.
 *
 * Debe coincidir con `buildNewPatientGreeting` (patient-templates.ts) y con
 * `NEW_PATIENT_MENU` (menu-option-detector.ts).
 */
export function menuDelPacienteNuevo(permisos: {
  permitirNuevoTurno?: boolean
}): AccionDelPacienteNuevo[] {
  if (permisos.permitirNuevoTurno === false) return []
  return ["book_appointment_intent", "familiar_appointment_intent", "other_inquiry_intent"]
}

/** El mapa número → acción, derivado de la lista de arriba. */
export function mapaDelPacienteNuevo(permisos: {
  permitirNuevoTurno?: boolean
}): Record<number, AccionDelPacienteNuevo> {
  const mapa: Record<number, AccionDelPacienteNuevo> = {}
  menuDelPacienteNuevo(permisos).forEach((accion, i) => {
    mapa[i + 1] = accion
  })
  return mapa
}
