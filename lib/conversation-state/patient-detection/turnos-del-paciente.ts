/**
 * Los turnos que son de ESTE paciente (13/11/2026).
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Probado con dos pacientes en un mismo teléfono: Testuno (18:00) y Testdos
 * (18:15). El bot pidió el DNI, lo recibió, saludó bien —"Testdos, bienvenido
 * de nuevo"— y acto seguido listó LOS DOS turnos como si fueran de él.
 *
 * Por qué: `get_paciente` por teléfono devuelve `pacientes: [...]` con el
 * aviso `pacientes_multiples`, y un `turnos_proximos` al nivel raíz que es la
 * unión de los turnos de todos. El código elegía bien el paciente por DNI y
 * después se quedaba con esa lista entera, sin filtrarla.
 *
 * Y esto no es cosmético. Con la lista mezclada, el paciente ve el turno de
 * otra persona —con fecha, hora y profesional— y las opciones del menú operan
 * sobre lo que ve: "2 - Cancelar un turno" sobre el turno 1 le cancela el
 * turno al familiar.
 *
 * ── Cómo se decide de quién es un turno ───────────────────────────────────
 *
 * Por cualquiera de las tres identidades que puede traer la fila de agenda:
 * el id del paciente, la historia clínica o el documento. Se prueban las tres
 * porque no todas están siempre: un paciente que nunca se atendió no está en
 * `pacientes`, así que su fila de agenda no tiene `paciente_id` ni HC y lo
 * único que lo identifica es el DNI (caso María Laura Cameselle, 13/11/2026).
 *
 * ── Qué pasa si un turno no trae ninguna ──────────────────────────────────
 *
 * Se conserva, y queda en el log. Es la decisión incómoda del archivo, así que
 * conviene dejar escrito por qué: esconder un turno que SÍ es del paciente es
 * peor que mostrarle uno de más. Si le decimos "no tenés turnos" cuando tiene,
 * no viene a la consulta. Si le mostramos uno que no es suyo, lo ve y
 * pregunta.
 *
 * Esa rama no debería ocurrir —la agenda tiene las tres columnas— pero si
 * ocurre, el log lo dice con los nombres de los campos que sí vinieron, que es
 * lo que hace falta para arreglarlo sin adivinar.
 */

export interface IdentidadDelPaciente {
  patientId?: string | null
  patientDNI?: string | null
  hc?: string | null
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  return String(valor).trim()
}

/** Para comparar documentos y HC: lo que importa son los dígitos. */
function digitos(valor: unknown): string {
  return texto(valor).replace(/[^0-9]/g, "")
}

/** Las identidades que trae la fila de un turno, con los nombres posibles. */
function identidadesDelTurno(turno: any): { id: string; hc: string; dni: string } {
  return {
    id: texto(turno?.paciente_id ?? turno?.Paciente_Id ?? turno?.pacienteId ?? turno?.Id_Paciente),
    hc: digitos(turno?.HC ?? turno?.hc ?? turno?.Hc),
    dni: digitos(turno?.Nrodoc ?? turno?.nrodoc ?? turno?.dni ?? turno?.DNI ?? turno?.documento),
  }
}

/**
 * Quién es el dueño de un turno cuando la fila no lo dice.
 *
 * Lo provee `atribucionPorRecordatorios` (lib/recordatorio-del-mensaje.ts) a
 * partir de los recordatorios que mandamos. Se probó primero con los campos de
 * identidad de la fila y `turnos_proximos` no trae ninguno: ni `paciente_id`,
 * ni HC, ni documento.
 */
export interface AtribucionExterna {
  duenoDe(turno: any): string | null
  sirve: boolean
}

export interface ResultadoDelFiltro {
  turnos: any[]
  /** Cuántos se descartaron por ser de otro paciente. */
  descartados: number
  /** Cuántos se conservaron sin poder atribuirlos. */
  sinIdentidad: number
}

/**
 * Filtra la lista de turnos dejando los del paciente indicado.
 *
 * Sin identidad del paciente devuelve la lista intacta: no hay con qué
 * comparar, y en ese caso el llamador no identificó a nadie todavía.
 */
export function filtrarTurnosDelPaciente(
  turnos: any[] | null | undefined,
  paciente: IdentidadDelPaciente,
  atribucion?: AtribucionExterna | null,
): ResultadoDelFiltro {
  const lista = Array.isArray(turnos) ? turnos : []
  if (lista.length === 0) return { turnos: [], descartados: 0, sinIdentidad: 0 }

  const idPaciente = texto(paciente.patientId)
  const dniPaciente = digitos(paciente.patientDNI)
  const hcPaciente = digitos(paciente.hc)

  if (!idPaciente && !dniPaciente && !hcPaciente) {
    return { turnos: lista, descartados: 0, sinIdentidad: 0 }
  }

  const conservados: any[] = []
  let descartados = 0
  let sinIdentidad = 0

  for (const turno of lista) {
    const delTurno = identidadesDelTurno(turno)
    const tieneAlguna = Boolean(delTurno.id || delTurno.hc || delTurno.dni)

    if (!tieneAlguna) {
      /**
       * La fila no dice de quién es. Antes de conservarla, se le pregunta a
       * los recordatorios: si de ese turno le avisamos a otro paciente, es de
       * otro paciente, y eso lo sabemos con certeza porque el aviso lo
       * mandamos nosotros.
       *
       * Éste es el camino real, no la excepción: `turnos_proximos` no trae
       * `paciente_id`, ni HC, ni documento.
       */
      const dueno = atribucion?.sirve ? atribucion.duenoDe(turno) : null
      if (dueno) {
        if (dniPaciente && digitos(dueno) === dniPaciente) {
          conservados.push(turno)
        } else {
          descartados += 1
        }
        continue
      }

      // Ni la fila ni los recordatorios lo atribuyen. Ver la nota del
      // encabezado: se conserva a propósito.
      sinIdentidad += 1
      conservados.push(turno)
      continue
    }

    const coincide =
      (idPaciente && delTurno.id && delTurno.id === idPaciente) ||
      (dniPaciente && delTurno.dni && delTurno.dni === dniPaciente) ||
      (hcPaciente && delTurno.hc && delTurno.hc === hcPaciente)

    if (coincide) {
      conservados.push(turno)
    } else {
      descartados += 1
    }
  }

  return { turnos: conservados, descartados, sinIdentidad }
}

/**
 * Lo mismo, pero dejando constancia.
 *
 * Separado de la función pura para poder probarla sin espiar la consola, y
 * porque los tres llamadores quieren el mismo log: que un turno ajeno se cuele
 * en la lista de alguien es el tipo de error que no se nota hasta que el
 * paciente cancela el turno de su madre.
 */
export function turnosDelPaciente(
  turnos: any[] | null | undefined,
  paciente: IdentidadDelPaciente,
  etiqueta: string,
  atribucion?: AtribucionExterna | null,
): any[] {
  const resultado = filtrarTurnosDelPaciente(turnos, paciente, atribucion)
  const total = Array.isArray(turnos) ? turnos.length : 0

  if (resultado.descartados > 0) {
    console.log(
      `[TURNOS] ${etiqueta}: ${resultado.turnos.length} de ${total} turnos son del paciente ` +
        `(DNI ${texto(paciente.patientDNI) || "—"}); ${resultado.descartados} son de otro paciente del mismo teléfono`,
    )
  }

  if (resultado.sinIdentidad > 0) {
    console.warn(
      `[TURNOS] ${etiqueta}: ${resultado.sinIdentidad} turno(s) sin paciente_id, HC ni documento. ` +
        `Se conservan —esconder un turno propio es peor que mostrar uno de más— pero no se pueden atribuir. ` +
        `Campos recibidos: ${JSON.stringify(Object.keys((turnos || [])[0] || {}))}`,
    )
  }

  if (total > 0 && resultado.turnos.length === 0) {
    console.warn(
      `[TURNOS] ${etiqueta}: ninguno de los ${total} turnos quedó atribuido al DNI ` +
        `${texto(paciente.patientDNI) || "—"}. Si el paciente tenía turno, revisar los nombres de los ` +
        `campos de identidad en turnos_proximos.`,
    )
  }

  return resultado.turnos
}
