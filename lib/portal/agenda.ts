/**
 * La agenda que ve el paciente en el portal (22/9/2026).
 *
 * ── Reusa la búsqueda del bot, no arma la suya ─────────────────────────────
 *
 * `searchTurnosFull` ya consulta el proxy y normaliza la respuesta, que viene
 * con once variantes de nombre para el mismo campo (`Agenda_Id`, `agenda_id`,
 * `Id`, `id`…). Duplicar eso acá terminaría en dos implementaciones de la misma
 * pregunta que se responden distinto — que es exactamente la clase de problema
 * que venimos sacando del código.
 *
 * El efecto práctico: el portal y el bot muestran la misma disponibilidad. Si
 * un paciente empieza por WhatsApp y termina en el portal, no ve dos agendas
 * diferentes.
 *
 * ── El profesional viene como nombre, no como id ───────────────────────────
 *
 * El recordatorio que manda la clínica trae `profesional: "TRAVERSO ALVARADO
 * ARIANNA ANDREA"` y ningún id. Durante un tiempo eso pareció un bloqueo que
 * obligaba a pedirle un campo nuevo a cada clínica. No hace falta:
 * `buscarProfesionales` resuelve el nombre contra la base de la clínica.
 *
 * Igual puede fallar —nombres con coma, abreviados, dos profesionales
 * parecidos— así que cuando no resuelve NO se cae: se ofrecen los turnos de la
 * sede. Un paciente eligiendo entre horarios de su sede es mucho mejor que un
 * paciente frente a un error.
 */

import { buscarProfesionales } from "../api-tools/api-functions"
import { searchTurnosFull } from "../conversation-state/shared/turnos-handler"
import type { TurnoOption } from "../conversation-state/shared/types"

export interface ResolucionDeProfesional {
  profesionalId?: string
  /** Cómo se resolvió, para poder explicarlo en la interfaz y en los logs. */
  via: "exacto" | "unico_resultado" | "no_resuelto"
  nombreEncontrado?: string
}

/** Quita acentos, puntuación y espacios de más para comparar nombres. */
function normalizar(nombre: string): string {
  return (nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Del nombre del profesional al id que necesita la agenda.
 *
 * Sólo acepta una coincidencia cuando no hay ambigüedad: o el nombre coincide
 * exactamente (ya normalizado), o la búsqueda devolvió un único resultado. Con
 * dos candidatos parecidos se prefiere no resolver antes que ofrecerle al
 * paciente los horarios del profesional equivocado.
 */
export async function resolverProfesional(
  clienteId: string,
  nombre?: string | null,
): Promise<ResolucionDeProfesional> {
  const buscado = normalizar(nombre || "")
  if (!buscado) return { via: "no_resuelto" }

  try {
    const respuesta = await buscarProfesionales(clienteId, nombre!.trim())
    const candidatos = Array.isArray(respuesta.datos) ? respuesta.datos : []

    if (candidatos.length === 0) return { via: "no_resuelto" }

    const exacto = candidatos.find((p) => normalizar(p.nombre) === buscado)
    if (exacto?.id) {
      return { profesionalId: String(exacto.id), via: "exacto", nombreEncontrado: exacto.nombre }
    }

    if (candidatos.length === 1 && candidatos[0]?.id) {
      return {
        profesionalId: String(candidatos[0].id),
        via: "unico_resultado",
        nombreEncontrado: candidatos[0].nombre,
      }
    }

    // Varios candidatos y ninguno exacto: no adivinamos.
    console.warn(
      `[PORTAL] "${nombre}" coincide con ${candidatos.length} profesionales; se ofrecerán turnos de la sede`,
    )
    return { via: "no_resuelto" }
  } catch (error) {
    console.error("[PORTAL] Error resolviendo el profesional:", error)
    return { via: "no_resuelto" }
  }
}

export interface DiaConTurnos {
  /** "2026-09-26" */
  fecha: string
  /** "viernes 26 de septiembre" */
  etiqueta: string
  turnos: TurnoOption[]
}

export interface AgendaDelPortal {
  dias: DiaConTurnos[]
  total: number
  /** true si se acotó al profesional del turno original. */
  filtradoPorProfesional: boolean
  profesionalNombre?: string
  /** Cuando la clínica explica por qué no hay turnos. */
  infoSinTurnos?: any
  error?: string
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** "2026-09-26" → "viernes 26 de septiembre". */
export function etiquetaDeFecha(fecha: string): string {
  const [y, m, d] = (fecha || "").split("-").map(Number)
  if (!y || !m || !d) return fecha || ""
  const date = new Date(y, m - 1, d)
  return `${DIAS[date.getDay()]} ${d} de ${MESES[m - 1]}`
}

/**
 * Agrupa los turnos por día.
 *
 * La lista plana funciona en WhatsApp, donde hay que numerar todo. En una
 * pantalla, agrupar por día es lo que deja ver de un vistazo qué días hay y
 * elegir por fecha antes que por horario.
 */
export function agruparPorDia(turnos: TurnoOption[]): DiaConTurnos[] {
  const porFecha = new Map<string, TurnoOption[]>()

  for (const turno of turnos) {
    const fecha = turno.fecha
    if (!fecha) continue
    if (!porFecha.has(fecha)) porFecha.set(fecha, [])
    porFecha.get(fecha)!.push(turno)
  }

  return [...porFecha.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, lista]) => ({
      fecha,
      etiqueta: etiquetaDeFecha(fecha),
      turnos: lista.sort((a, b) => (a.hora || "").localeCompare(b.hora || "")),
    }))
}

/**
 * La agenda para reprogramar un turno.
 *
 * Se intenta con el mismo profesional; si no se lo puede identificar, se cae a
 * los turnos de la sede. Nunca se devuelve un error por no haber podido
 * resolver el nombre.
 */
export async function agendaParaReprogramar(params: {
  clienteId: string
  phone: string
  sedeId?: string
  /** Si viene, se usa directo: es el camino bueno. */
  profesionalId?: string | null
  profesionalNombre?: string | null
  pacienteDNI?: string
  obraSocialId?: string
}): Promise<AgendaDelPortal> {
  // Con el id no hay nada que resolver. Sólo se busca por nombre cuando el
  // recordatorio no trajo `Chatbot_Data`, que es el caso viejo.
  const resolucion: ResolucionDeProfesional = params.profesionalId
    ? { profesionalId: String(params.profesionalId), via: "exacto", nombreEncontrado: params.profesionalNombre || undefined }
    : await resolverProfesional(params.clienteId, params.profesionalNombre)

  const resultado = await searchTurnosFull(
    params.clienteId,
    {
      sedeId: params.sedeId || "",
      pacienteDNI: params.pacienteDNI,
      obraSocialId: params.obraSocialId,
      profesionalId: resolucion.profesionalId,
    },
    params.phone,
  )

  if (!resultado.success || !resultado.turnos?.length) {
    return {
      dias: [],
      total: 0,
      filtradoPorProfesional: !!resolucion.profesionalId,
      profesionalNombre: resolucion.nombreEncontrado || params.profesionalNombre || undefined,
      infoSinTurnos: resultado.infoSinTurnos,
      error: resultado.error,
    }
  }

  return {
    dias: agruparPorDia(resultado.turnos),
    total: resultado.turnos.length,
    filtradoPorProfesional: !!resolucion.profesionalId,
    profesionalNombre: resolucion.nombreEncontrado || params.profesionalNombre || undefined,
    infoSinTurnos: resultado.infoSinTurnos,
  }
}

/**
 * Turnos inventados, sólo para los enlaces de prueba (23/9/2026).
 *
 * Se usan ÚNICAMENTE cuando el enlace es de demo y la agenda real vino vacía.
 * No reemplazan a la agenda real cuando la hay: si la clínica tiene turnos, se
 * muestran los suyos, porque ver la disponibilidad de verdad es la mitad de lo
 * que se quiere probar.
 *
 * Y cuando aparecen, la pantalla lo dice. Una demo que disimula que la agenda
 * real no contestó esconde justamente el problema que había que ver.
 */
export function turnosDeEjemplo(): DiaConTurnos[] {
  const dias: DiaConTurnos[] = []
  const horarios = ["08:30", "09:15", "10:00", "11:30", "15:00", "16:45"]

  for (let i = 1; i <= 3; i++) {
    const fecha = new Date(Date.now() + i * 2 * 86_400_000)
    const iso = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`

    dias.push({
      fecha: iso,
      etiqueta: etiquetaDeFecha(iso),
      turnos: horarios.slice(0, 3 + (i % 3)).map((hora, j) => ({
        numero: j + 1,
        id: `demo-${iso}-${hora}`,
        fecha: iso,
        hora,
        profesionalId: "demo",
        profesionalNombre: "Profesional de ejemplo",
        sedeNombre: "Sede de ejemplo",
      })) as TurnoOption[],
    })
  }

  return dias
}

/** La agenda para un turno nuevo, con los filtros que haya elegido el paciente. */
export async function agendaParaTurnoNuevo(params: {
  clienteId: string
  phone: string
  sedeId?: string
  profesionalId?: string
  especialidadId?: string
  pacienteDNI?: string
  obraSocialId?: string
}): Promise<AgendaDelPortal> {
  const resultado = await searchTurnosFull(
    params.clienteId,
    {
      sedeId: params.sedeId || "",
      pacienteDNI: params.pacienteDNI,
      obraSocialId: params.obraSocialId,
      profesionalId: params.profesionalId,
      especialidadId: params.especialidadId,
    },
    params.phone,
  )

  if (!resultado.success || !resultado.turnos?.length) {
    return {
      dias: [],
      total: 0,
      filtradoPorProfesional: !!params.profesionalId,
      infoSinTurnos: resultado.infoSinTurnos,
      error: resultado.error,
    }
  }

  return {
    dias: agruparPorDia(resultado.turnos),
    total: resultado.turnos.length,
    filtradoPorProfesional: !!params.profesionalId,
    infoSinTurnos: resultado.infoSinTurnos,
  }
}
