/**
 * Filtrar por subespecialidad del lado nuestro, porque el proxy no lo hace
 * (4/11/2026).
 *
 * ── Lo que se midió ────────────────────────────────────────────────────────
 *
 * En Salud Ocular Callao, con `Subespecialidad_Id: 17` mandado como NÚMERO
 * —que era la sospecha del 24/9, cuando se descubrió que como texto el proxy
 * lo ignoraba— la respuesta trajo 310 turnos declarando "Cirujano" Y
 * "Oftalmologia", y pesó 105.621 caracteres contra los 105.283 de la misma
 * consulta sin el parámetro. O sea: el proxy acepta `Subespecialidad_Id`, no
 * devuelve ningún error, y lo ignora.
 *
 * La nota del 24/9 dejó el caso abierto: "o el proxy de este cliente lo
 * ignora, o el id que mandamos no es el que espera; desde el código no se
 * puede distinguir". Con el panel de diagnóstico ya se puede, y era lo
 * primero.
 *
 * ── Con qué se filtra ──────────────────────────────────────────────────────
 *
 * El turno NO trae la subespecialidad: trae `Especialidad` ("Cirujano",
 * "Oftalmologia"), que es otra cosa — la subespecialidad es "Orbita",
 * "Parpados", "Vias Lagrimales"—. Así que por turno no hay con qué.
 *
 * Pero `get_profesionales` sí la trae, por profesional:
 *
 *   { "Id": "3850e298-…", "Nombre_Completo": "ABUYE, LUCIA",
 *     "Subespecialidades": [ {"Id":"16","Nombre":"Orbita"},
 *                            {"Id":"20","Nombre":"Parpados"} ] }
 *
 * Entonces la subespecialidad del turno es la de su profesional, y el conjunto
 * de profesionales que la tienen se arma de ahí.
 *
 * ── Sin el filtro por sede, a propósito ────────────────────────────────────
 *
 * Esta consulta pide el directorio COMPLETO, sin `Sede_Id`. Dos motivos, y los
 * dos importan:
 *
 *  · la sede ya la filtró `get_turnos`, que sí la respeta;
 *  · el directorio filtrado por sede de esta clínica omite profesionales que
 *    demostrablemente atienden ahí (11 de 15 en Callao, medido el 4/11). Si se
 *    usara ése, esos once quedarían "desconocidos" y el filtro no los podría
 *    clasificar.
 *
 * ── Lo que NO se esconde nunca ─────────────────────────────────────────────
 *
 * Un turno de un profesional que el directorio no trae NO se filtra. No saber
 * su subespecialidad es un problema nuestro, y esconderle un horario
 * disponible al paciente por eso es el peor error posible en esta pantalla:
 * silencioso y en contra suya.
 *
 * Y si la subespecialidad elegida no tiene ningún profesional en el
 * directorio, no se filtra nada: vaciar la pantalla porque no pudimos
 * averiguar es peor que mostrar de más.
 */

import { obtenerTodosLosProfesionales } from "../api-tools/api-functions"
import { diagnosticoActual } from "./diagnostico"

export interface ProfesionalesPorSubespecialidad {
  /** Los que declaran esta subespecialidad. */
  deLaSubespecialidad: Set<string>
  /** Todos los del directorio: lo que NO está acá es "no sabemos". */
  conocidos: Set<string>
  /** El nombre de la subespecialidad, si se encontró. Para el diagnóstico. */
  nombre?: string
}

/** Los ids de profesional que declaran esta subespecialidad. */
export async function profesionalesDeLaSubespecialidad(
  clienteId: string,
  subespecialidadId: string,
): Promise<ProfesionalesPorSubespecialidad> {
  const vacio: ProfesionalesPorSubespecialidad = {
    deLaSubespecialidad: new Set(),
    conocidos: new Set(),
  }
  if (!clienteId || !subespecialidadId) return vacio

  const respuesta = await obtenerTodosLosProfesionales(clienteId).catch(() => null)
  const lista = Array.isArray((respuesta as any)?.datos) ? ((respuesta as any).datos as any[]) : []
  if (lista.length === 0) return vacio

  const buscado = String(subespecialidadId).trim()
  const deLaSubespecialidad = new Set<string>()
  const conocidos = new Set<string>()
  let nombre: string | undefined

  for (const p of lista) {
    const id = String(p?.Id ?? p?.id ?? "")
    if (!id) continue
    conocidos.add(id)

    const subs = Array.isArray(p?.Subespecialidades)
      ? p.Subespecialidades
      : Array.isArray(p?.subespecialidades)
        ? p.subespecialidades
        : []

    for (const s of subs) {
      if (String(s?.Id ?? s?.id ?? "").trim() !== buscado) continue
      deLaSubespecialidad.add(id)
      if (!nombre && s?.Nombre) nombre = String(s.Nombre)
    }
  }

  return { deLaSubespecialidad, conocidos, nombre }
}

/**
 * Deja sólo los turnos de la subespecialidad elegida.
 *
 * Devuelve la lista original cuando no hay con qué filtrar, y anota siempre lo
 * que hizo: cuántos pasaron, cuántos se descartaron y cuántos se dejaron por
 * no poder clasificarlos. Ese último número es el que importa — si es alto, el
 * filtro está haciendo poco y hay que arreglarlo en el origen.
 */
export async function filtrarPorSubespecialidad<
  T extends { profesionalId?: string; especialidad?: string },
>(clienteId: string, subespecialidadId: string | undefined, turnos: T[]): Promise<T[]> {
  if (!subespecialidadId || turnos.length === 0) return turnos

  const { deLaSubespecialidad, conocidos, nombre } = await profesionalesDeLaSubespecialidad(
    clienteId,
    subespecialidadId,
  )

  const anotar = (resumen: string, crudo?: unknown) =>
    diagnosticoActual()?.anotar({
      titulo: `filtro por subespecialidad ${nombre ? `«${nombre}»` : subespecialidadId}`,
      resumen,
      crudo,
    })

  if (deLaSubespecialidad.size === 0) {
    anotar(
      `no se filtró: ningún profesional del directorio declara la subespecialidad ${subespecialidadId}. ` +
        `Se dejan los ${turnos.length} turnos para no vaciar la pantalla por algo que no pudimos averiguar.`,
      { profesionalesEnElDirectorio: conocidos.size },
    )
    return turnos
  }

  const pasan: T[] = []
  const descartados: T[] = []
  const sinClasificar: T[] = []

  for (const t of turnos) {
    const id = String(t.profesionalId || "")
    if (deLaSubespecialidad.has(id)) pasan.push(t)
    else if (conocidos.has(id)) descartados.push(t)
    else sinClasificar.push(t)
  }

  const resultado = [...pasan, ...sinClasificar]

  anotar(
    `${resultado.length} de ${turnos.length} turnos quedan ` +
      `(${pasan.length} de la subespecialidad, ${descartados.length} descartados` +
      (sinClasificar.length > 0 ? `, ${sinClasificar.length} sin clasificar y por eso se dejan` : "") +
      `)`,
    {
      profesionalesConEstaSubespecialidad: deLaSubespecialidad.size,
      profesionalesEnElDirectorio: conocidos.size,
      // Si esto no está vacío, el directorio no trae a alguien que sí tiene
      // agenda: el filtro no puede decidir por él y su turno se ofrece igual.
      profesionalesSinClasificar: [
        ...new Set(sinClasificar.map((t) => String(t.profesionalId || ""))),
      ].slice(0, 5),
      especialidadesQueDeclarabanLosTurnos: [
        ...new Set(turnos.map((t) => t.especialidad).filter(Boolean)),
      ],
    },
  )

  // Ordenar no hace falta: `agruparPorDia` reagrupa por fecha después.
  return resultado
}
