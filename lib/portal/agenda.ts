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
  /** Si no tiene ficha, el DNI no se manda. Ver la nota de abajo. */
  tieneFicha?: boolean
  obraSocialId?: string
  /**
   * El deudor "Particular" de la clínica, si lo tiene (27/10/2026).
   *
   * Cuando viene, la agenda se consulta DOS veces —con la obra social del
   * paciente y con ésta— y se fusionan: los huecos que sólo aparecen bajo
   * Particular quedan marcados con `soloParticular`. Ver `fusionarConParticular`.
   */
  particularId?: string
}): Promise<AgendaDelPortal> {
  // ── Las dos agendas, en paralelo (27/10/2026) ────────────────────────────
  //
  // Con un deudor Particular distinto del del paciente, esta misma función se
  // llama dos veces —una por cobertura— y se fusionan los resultados. En
  // paralelo: son dos consultas de 60 días y encadenarlas duplicaría la espera
  // del paciente en la pantalla más lenta del portal.
  //
  // El `particularId: undefined` de las dos llamadas internas es lo que corta
  // la recursión.
  if (params.particularId && params.particularId !== params.obraSocialId) {
    const [base, conParticular] = await Promise.all([
      agendaParaTurnoNuevo({ ...params, particularId: undefined }),
      agendaParaTurnoNuevo({
        ...params,
        particularId: undefined,
        obraSocialId: params.particularId,
      }).catch((error) => {
        console.error("[PORTAL] No se pudo consultar la agenda particular:", error)
        return null
      }),
    ])
    return fusionarConParticular(base, conParticular)
  }

  // ── El DNI va sólo si el paciente tiene ficha (24/9/2026) ────────────────
  //
  // Los dos flujos del bot hacen cosas distintas, y con razón:
  //
  //  - Paciente EXISTENTE: manda `Paciente_DNI`. Verificado en un log real —
  //    `{"Paciente_DNI":"361****","Sede_Id":"...","Subespecialidad_Id":1}`
  //    devolvió 230 turnos. Le sirve al proxy para aplicar la elegibilidad de
  //    ese paciente.
  //
  //  - Paciente NUEVO: no lo manda. Todavía no existe en el sistema de la
  //    clínica; mandarle un DNI que no conoce es pedirle que filtre por algo
  //    que no tiene, y hay un caso documentado (Andrea/Carmen, 26/8) donde
  //    eso devolvía cero turnos con el profesional teniendo agenda libre.
  //
  // El portal lo mandaba siempre. Ahora sigue la misma regla que el bot.
  const resultado = await searchTurnosFull(
    params.clienteId,
    {
      sedeId: params.sedeId || "",
      pacienteDNI: params.tieneFicha ? params.pacienteDNI : undefined,
      obraSocialId: params.obraSocialId,
      profesionalId: params.profesionalId,
      especialidadId: params.especialidadId,
    },
    params.phone,
  )

  // ── Diagnóstico del filtro por especialidad (24/9/2026) ──────────────────
  //
  // Reportado: elegir una especialidad no cambia los horarios. Verificado en
  // producción: las tres especialidades y "sin filtro" devuelven exactamente
  // los mismos días.
  //
  // El parámetro se manda —`searchTurnosFull` lo pasa como `Subespecialidad_Id`
  // y el bot hace exactamente lo mismo—, así que o el proxy de este cliente lo
  // ignora, o el id que mandamos no es el que espera. Desde el código no se
  // puede distinguir una cosa de la otra.
  //
  // Esto lo deja registrado: cuántos turnos volvieron y qué especialidades
  // declaran. Si todos traen la misma especialidad, el filtro funcionó. Si
  // traen varias, el proxy lo ignoró. Si no traen ninguna, no hay con qué
  // filtrar del lado nuestro tampoco, y hay que arreglarlo en el origen.
  if (params.especialidadId && resultado.turnos?.length) {
    const declaradas = [...new Set(resultado.turnos.map((t) => t.especialidad).filter(Boolean))]
    console.log(
      `[PORTAL] Filtro por especialidad "${params.especialidadId}": ` +
        `${resultado.turnos.length} turnos | especialidades que declaran: ` +
        `${declaradas.length ? declaradas.join(" / ") : "(ninguna — los turnos no traen el campo)"}`,
    )
  }

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

/**
 * La agenda del paciente más los huecos que sólo existen de forma particular
 * (27/10/2026).
 *
 * ── Por qué fusionar y no elegir ───────────────────────────────────────────
 *
 * Buscando "por especialidad" o "cualquier profesional", el resultado es una
 * lista mezclada: algunos horarios los cubre la obra social del paciente y
 * otros no. No se puede decidir a nivel de pantalla —como se hizo con el
 * profesional suelto, donde o atiende la obra social o no—, así que la marca
 * va en cada turno.
 *
 * Y es la misma función para los tres flujos: un profesional que no atiende la
 * obra social devuelve cero huecos cubiertos, así que TODOS los suyos quedan
 * marcados y la pantalla puede decirlo una sola vez arriba. Una regla, tres
 * flujos, en vez de un caso especial por flujo.
 *
 * ── La fusión es por `agenda_id` ───────────────────────────────────────────
 *
 * Un hueco que aparece en las dos consultas está cubierto: que también se
 * pueda reservar particular no es algo que haya que ofrecerle a alguien que
 * tiene cobertura. Sólo se agregan los que la primera consulta no trajo.
 *
 * Ante un fallo de la segunda consulta se devuelve la primera tal cual: no
 * ofrecer una alternativa es peor que no ofrecerla, pero mucho mejor que
 * quedarse sin los turnos que sí había.
 */
function fusionarConParticular(
  base: AgendaDelPortal,
  conParticular: AgendaDelPortal | null,
): AgendaDelPortal {
  if (!conParticular) return base

  const cubiertos = new Set(base.dias.flatMap((d) => d.turnos.map((t) => String(t.id))))

  const soloParticulares = conParticular.dias
    .flatMap((d) => d.turnos)
    .filter((t) => !cubiertos.has(String(t.id)))
    .map((t) => ({ ...t, soloParticular: true }))

  if (soloParticulares.length === 0) return base

  const todos = [...base.dias.flatMap((d) => d.turnos), ...soloParticulares]

  console.log(
    `[PORTAL] Agenda fusionada: ${cubiertos.size} con cobertura + ${soloParticulares.length} sólo particulares`,
  )

  return {
    ...base,
    dias: agruparPorDia(todos),
    total: todos.length,
    // Si la primera consulta vino vacía, su `infoSinTurnos` explicaba un cero
    // que ya no es cero. Dejarlo haría que la pantalla muestre el motivo de
    // "no hay turnos" arriba de una grilla con turnos.
    infoSinTurnos: base.total > 0 ? base.infoSinTurnos : undefined,
    error: undefined,
  }
}
