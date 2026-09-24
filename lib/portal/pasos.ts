/**
 * En qué paso está el paciente (22/9/2026).
 *
 * ── Por qué está separado de la búsqueda de datos ──────────────────────────
 *
 * Decidir qué pantalla mostrar es una función de tres cosas que ya tenemos en
 * memoria: la intención del enlace, los permisos del cliente y lo que el
 * paciente ya eligió. No hace falta consultar nada para saberlo.
 *
 * Separarlo lo vuelve testeable sin red, y evita el error que se cuela solo en
 * este tipo de flujos: pedir la lista de profesionales para después descubrir
 * que ese cliente no deja elegir profesional.
 */

import type { IntencionDelPortal } from "./vigencia"

export type Paso =
  /** No sabemos quién es. Sin DNI no se puede filtrar la agenda. */
  | "pedir_dni"
  /** Tiene DNI pero no tiene ficha: hay que darlo de alta. */
  | "registrar"
  /** Su obra social no permite turnos online. Fin del camino, con teléfono. */
  | "derivar_obra_social"
  | "reprogramar"
  /** Varias sedes y todavía no sabemos en cuál se atiende. */
  | "elegir_sede"
  /** Médico en particular, por especialidad, o cualquiera. */
  | "elegir_tipo_busqueda"
  | "elegir_especialidad"
  | "elegir_profesional"
  | "elegir_horario"

export interface PermisosDeBusqueda {
  /** WhatsAppConfig.enableSearchBySpecialty */
  porEspecialidad?: boolean
  /** WhatsAppConfig.enableSearchByProfessional */
  porProfesional?: boolean
  /** WhatsAppConfig.enableSearchByAnyDoctor */
  porCualquiera?: boolean
}

export interface FiltrosElegidos {
  /**
   * Sede elegida, o la que ya venía en el token.
   *
   * Va primero que todo lo demás: la agenda se busca por sede, así que
   * elegir profesional antes sería elegir entre los de todas las sedes.
   */
  sedeId?: string
  especialidadId?: string
  profesionalId?: string
  /** Cómo quiere buscar. Ver `TipoDeBusqueda`. */
  tipoBusqueda?: TipoDeBusqueda
  /** El paciente tocó "ver todos": se saltean los filtros. */
  sinFiltro?: boolean
}

/**
 * Las tres formas de buscar un turno (24/9/2026).
 *
 * Son las mismas que ofrece el bot por WhatsApp, con los mismos nombres, y NO
 * es por imitarlo: el paciente que un día saca turno por chat y otro por el
 * enlace tiene que encontrarse con las mismas opciones, o va a creer que el
 * portal hace menos cosas.
 *
 * ── Cada una lleva a un camino distinto, no a una cadena ───────────────────
 *
 * El portal encadenaba especialidad Y DESPUÉS profesional, siempre. El bot no:
 * elegir "por especialidad" muestra los turnos de esa especialidad, con el
 * profesional de cada turno a la vista. Son caminos alternativos, no pasos
 * sucesivos — y encadenarlos obligaba a filtrar dos veces para ver lo que se
 * podía ver con una.
 */
export type TipoDeBusqueda =
  /** Ya sabe con quién se quiere atender. */
  | "profesional"
  /** Sabe qué necesita, no con quién. */
  | "especialidad"
  /** Lo primero que haya. */
  | "cualquiera"

export interface OpcionDeBusqueda {
  id: TipoDeBusqueda
  nombre: string
  detalle: string
}

/**
 * Las opciones que este cliente habilitó.
 *
 * Si queda una sola no hay nada que preguntar: `decidirPaso` la aplica y sigue
 * de largo. Preguntarle a alguien entre una sola opción es hacerlo tocar por
 * nada, y es el mismo criterio que ya se usa con las sedes.
 */
export function opcionesDeBusqueda(permisos: PermisosDeBusqueda): OpcionDeBusqueda[] {
  const opciones: OpcionDeBusqueda[] = []

  if (permisos.porProfesional !== false) {
    opciones.push({
      id: "profesional",
      nombre: "Médico en particular",
      detalle: "Si ya sabés con qué profesional querés atenderte",
    })
  }
  if (permisos.porEspecialidad !== false) {
    opciones.push({
      id: "especialidad",
      nombre: "Por especialidad",
      detalle: "Para elegir una especialidad y ver los horarios disponibles",
    })
  }
  if (permisos.porCualquiera !== false) {
    opciones.push({
      id: "cualquiera",
      nombre: "Cualquier médico",
      detalle: "Para ver los turnos más próximos sin importar el profesional",
    })
  }

  return opciones
}

/**
 * Lo que sabemos del paciente en este momento (23/9/2026).
 *
 * Cuando el bot lo reconoció por su teléfono, el token ya viene con todo y
 * estos pasos no se ven nunca. Cuando no lo reconoció —que es el caso del
 * paciente nuevo, y también el del que llama desde otro número— el portal lo
 * averigua acá.
 */
export interface IdentidadDelPaciente {
  dni?: string
  /** Ya se buscó la ficha con ese DNI. Distingue "no tiene" de "todavía no busqué". */
  fichaConsultada?: boolean
  /** Tiene ficha en el sistema de la clínica. */
  tieneFicha?: boolean
  nombre?: string
  apellido?: string
  email?: string
  obraSocialId?: string
  /** `reservarTurno` lo manda como `Deudor_Nombre`, y es lo que se le muestra al paciente. */
  obraSocialNombre?: string
  /**
   * La obra social no permite turnos online (`permite_turnos_online: false`).
   *
   * `undefined` es "no se pudo determinar", y ahí se deja pasar: ver la nota de
   * `resolverTurnosOnline` sobre por qué el caso indeterminado NO bloquea.
   */
  obraSocialBloqueada?: boolean
}

/** ¿Están todos los datos que `reservarTurno` necesita para dar de alta? */
export function altaCompleta(identidad: IdentidadDelPaciente | undefined): boolean {
  if (!identidad) return false
  return Boolean(identidad.dni && identidad.nombre && identidad.apellido && identidad.email)
}

/**
 * Los flags vienen de la configuración del cliente y su ausencia significa
 * permitido — es el mismo criterio que usa el menú de WhatsApp, y cambiarlo acá
 * haría que el portal ofrezca algo distinto de lo que la clínica configuró.
 */
export function decidirPaso(
  intencion: IntencionDelPortal,
  permisos: PermisosDeBusqueda,
  filtros: FiltrosElegidos,
  identidad: IdentidadDelPaciente = {},
): Paso {
  if (intencion === "reagendar" || intencion === "cancelar") return "reprogramar"

  // ── La identidad va primero, y en este orden ─────────────────────────────
  //
  // No es preferencia de diseño: la agenda se filtra por obra social
  // (`Deudor_Id`), y la obra social sale de la ficha, que sale del DNI. Mostrar
  // horarios antes de saber quién es sería mostrar horarios que después pueden
  // no corresponderle — el peor tipo de error, porque parece que funcionó.
  //
  // Es el mismo orden que sigue el bot por WhatsApp. No porque haya que
  // imitarlo, sino porque la restricción que lo obliga es la misma.
  if (!identidad.dni) return "pedir_dni"

  // Ya buscamos y no tiene ficha: hay que darlo de alta antes de seguir.
  if (identidad.fichaConsultada && !identidad.tieneFicha && !altaCompleta(identidad)) {
    return "registrar"
  }

  // La obra social decide si hay camino. Se chequea DESPUÉS de tener los datos
  // y ANTES de mostrar la agenda — que es exactamente donde falló el caso
  // Zelmira: la paciente recorrió sede, profesional y especialidad completas
  // para enterarse al final de que su obra social no sacaba turnos online.
  if (identidad.obraSocialBloqueada === true) return "derivar_obra_social"

  // ── La sede, antes que el resto (24/9/2026) ──────────────────────────────
  //
  // Faltaba. El portal buscaba con la sede que viniera en el token y, para el
  // paciente nuevo —que no trae ninguna— buscaba en TODAS: podía terminar con
  // turno en la otra punta de la ciudad sin que nada se lo advirtiera. El
  // widget la pregunta (`venue_selection`) y acá se había perdido.
  //
  // Va antes que "ver todos": ese atajo saltea el profesional, no el lugar
  // donde el paciente se va a atender.
  //
  // La página resuelve sola el caso de una sola sede: si la lista trae una, la
  // usa sin preguntar, igual que hace con especialidades y profesionales.
  if (!filtros.sedeId) return "elegir_sede"

  // Ya filtró: a los horarios. Un filtro alcanza — ver `TipoDeBusqueda`.
  if (filtros.sinFiltro || filtros.profesionalId || filtros.especialidadId) return "elegir_horario"

  const opciones = opcionesDeBusqueda(permisos)

  // Sin ninguna opción habilitada, el cliente no quiere que se filtre nada.
  if (opciones.length === 0) return "elegir_horario"

  // Con una sola no se pregunta: se aplica.
  const elegido: TipoDeBusqueda | undefined =
    filtros.tipoBusqueda && opciones.some((o) => o.id === filtros.tipoBusqueda)
      ? filtros.tipoBusqueda
      : opciones.length === 1
        ? opciones[0].id
        : undefined

  if (!elegido) return "elegir_tipo_busqueda"

  if (elegido === "profesional") return "elegir_profesional"
  if (elegido === "especialidad") return "elegir_especialidad"
  return "elegir_horario"
}

/**
 * ¿Se le puede ofrecer "me da igual el profesional"?
 *
 * Si el cliente apagó `enableSearchByAnyDoctor`, esa salida no existe: quiere
 * que el paciente elija con quién se atiende.
 */
export function ofreceVerTodos(permisos: PermisosDeBusqueda): boolean {
  return permisos.porCualquiera !== false
}
