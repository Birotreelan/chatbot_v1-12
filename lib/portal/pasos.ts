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
  | "reprogramar"
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
  especialidadId?: string
  profesionalId?: string
  /** El paciente tocó "ver todos": se saltean los filtros. */
  sinFiltro?: boolean
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
): Paso {
  if (intencion === "reagendar" || intencion === "cancelar") return "reprogramar"

  if (filtros.sinFiltro) return "elegir_horario"

  // Elegir profesional implica la especialidad: no se le vuelve a preguntar.
  if (permisos.porEspecialidad !== false && !filtros.especialidadId && !filtros.profesionalId) {
    return "elegir_especialidad"
  }

  if (permisos.porProfesional !== false && !filtros.profesionalId) {
    return "elegir_profesional"
  }

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
