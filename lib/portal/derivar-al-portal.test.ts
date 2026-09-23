/**
 * lib/portal/derivar-al-portal.test.ts
 *
 * `datosDesdeElContexto` es el puente entre lo que el bot guardó cuando la
 * clínica mandó el recordatorio y lo que el portal necesita para mostrar la
 * agenda correcta.
 *
 * Si se pierde un campo acá, el paciente entra al portal y ve los horarios de
 * otra sede, o de cualquier profesional en vez del suyo. Y no falla: muestra
 * algo plausible y equivocado, que es la peor forma de fallar.
 */

import { describe, it, expect } from "vitest"
import { datosDesdeElContexto, usaPortal } from "./derivar-al-portal"

/** Lo que guarda send-reminder-template.ts al enviar un recordatorio. */
const CONTEXTO = {
  paciente: { nombres: "Ariel", apellido: "RIZZI", dni: "27158093", obra_social_id: "44" },
  turnos: [
    {
      fecha: "2026-09-19",
      fecha_formateada: "19/09/2026",
      hora: "08:00:00",
      hora_formateada: "08:00",
      profesional: "TRAVERSO ALVARADO ARIANNA ANDREA",
      profesional_id: "881",
      sede: "SALUD OCULAR CALLAO",
      sede_id: "3",
      direccion: "Av. Callao 710",
      agenda_id: "3755379",
    },
  ],
}

describe("lo que el portal necesita para mostrar la agenda correcta", () => {
  const d = datosDesdeElContexto(CONTEXTO)!

  it("lleva el id del profesional, no sólo su nombre", () => {
    // Con el id no hay que resolver nada. Buscar por nombre falla con
    // abreviaturas, comas y homónimos, y cuando falla el paciente ve los
    // horarios de toda la sede creyendo que son los de su médico.
    expect(d.turno?.profesionalId).toBe("881")
  })

  it("lleva la sede, que acota toda la búsqueda", () => {
    expect(d.sedeId).toBe("3")
  })

  it("lleva la obra social, que puede cambiar qué turnos se ofrecen", () => {
    expect(d.obraSocialId).toBe("44")
  })

  it("arma el nombre para saludar", () => {
    expect(d.pacienteNombre).toBe("Ariel RIZZI")
  })

  it("lleva el DNI, que es con lo que la clínica vincula el turno", () => {
    expect(d.pacienteDNI).toBe("27158093")
  })

  it("conserva las fechas ya formateadas, para no reformatearlas distinto", () => {
    expect(d.turno?.fechaFormateada).toBe("19/09/2026")
    expect(d.turno?.horaFormateada).toBe("08:00")
  })
})

describe("contextos incompletos", () => {
  it("soporta el formato viejo, con los campos del turno en la raíz", () => {
    const d = datosDesdeElContexto({
      paciente: { nombres: "Ana", apellido: "Perez", dni: "1" },
      fecha: "2026-10-03",
      hora: "08:50",
      profesional: "X",
    })
    expect(d?.turno?.fecha).toBe("2026-10-03")
  })

  it("sin turnos no inventa uno", () => {
    const d = datosDesdeElContexto({ paciente: { nombres: "Ana", apellido: "P", dni: "1" }, turnos: [] })
    expect(d?.turno).toBeUndefined()
    expect(d?.pacienteDNI).toBe("1")
  })

  it("nada devuelve nada, sin romper", () => {
    expect(datosDesdeElContexto(null)).toBeUndefined()
    expect(datosDesdeElContexto(undefined)).toBeUndefined()
    expect(datosDesdeElContexto({})?.pacienteNombre).toBeUndefined()
  })
})

describe("el switch decide, y su ausencia significa apagado", () => {
  it("sólo se deriva con el switch explícitamente encendido", () => {
    expect(usaPortal({ clientePortalWeb: true })).toBe(true)
    for (const config of [null, undefined, {}, { clientePortalWeb: false }]) {
      expect(usaPortal(config), JSON.stringify(config)).toBe(false)
    }
  })
})
