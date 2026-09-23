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
import { datosDesdeElContexto, usaPortal, permiteReprogramarOnline } from "./derivar-al-portal"
import { textoSoloPorTelefono } from "./mensaje-enlace"

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

// ─────────────────────────────────────────────────────────────────────────────
// La compuerta de admite_reagendamiento (23/9/2026)
//
// Caso real: turno con "GARAY, Matías - MP: 12336" (Instrumentador Quirúrgico),
// `admite_reagendamiento: false`. Le mandamos el enlace igual y el portal le
// mostró una pantalla vacía, porque el proxy contestó `turnos_disponibles: []`
// con un `info_sin_turnos` que decía "solo se pueden reservar por teléfono".
//
// El dato estaba en el Chatbot_Data del recordatorio, ocho minutos antes.
// ─────────────────────────────────────────────────────────────────────────────

const TURNO_GARAY = {
  paciente: { nombres: "Nicolas", apellido: "DE SANTIAGO", dni: "36100432", obra_social_id: "ab73c1fb" },
  turnos: [
    {
      fecha: "2026-09-24",
      fecha_formateada: "24/09/2026",
      hora: "09:00:00",
      hora_formateada: "09:00",
      profesional: "GARAY, Matías - MP: 12336",
      profesional_id: "bc98af14-f540-11e6-9335-10c37b4ca172",
      sede: "OFTALMO Medicina Ocular ",
      agenda_id: 25,
      admite_reagendamiento: false,
    },
  ],
  sede_id: "565ae021-3ee7-102e-8425-80636cf68bd6",
}

describe("el flag viaja desde el recordatorio hasta la decisión", () => {
  it("se lee del turno, que es donde lo manda el proxy", () => {
    expect(datosDesdeElContexto(TURNO_GARAY)?.admiteReagendamiento).toBe(false)
  })

  it("si el proxy no manda el campo, queda undefined y NO false", () => {
    // La distinción es el punto: false es "no se puede", undefined es "no sé".
    expect(datosDesdeElContexto(CONTEXTO)?.admiteReagendamiento).toBeUndefined()
  })

  it("un true explícito también llega", () => {
    const con = { ...CONTEXTO, turnos: [{ ...CONTEXTO.turnos[0], admite_reagendamiento: true }] }
    expect(datosDesdeElContexto(con)?.admiteReagendamiento).toBe(true)
  })
})

describe("permiteReprogramarOnline", () => {
  it("el turno de GARAY no se reprograma online", () => {
    expect(permiteReprogramarOnline(datosDesdeElContexto(TURNO_GARAY), {})).toBe(false)
  })

  it("sin el campo se permite: la falta de dato no es un no", () => {
    // Hay proxies que no mandan el campo. Tratar su silencio como negativa le
    // cortaría el portal a clientes enteros sin que nadie entienda por qué.
    expect(permiteReprogramarOnline(datosDesdeElContexto(CONTEXTO), {})).toBe(true)
    expect(permiteReprogramarOnline(undefined, {})).toBe(true)
    expect(permiteReprogramarOnline({}, {})).toBe(true)
  })

  it("el switch del cliente manda por encima del turno", () => {
    const turnoOk = datosDesdeElContexto(CONTEXTO)
    expect(permiteReprogramarOnline(turnoOk, { permitirReagendamiento: false })).toBe(false)
    expect(permiteReprogramarOnline(turnoOk, { permitirReagendamiento: true })).toBe(true)
  })

  it("config ausente no bloquea", () => {
    expect(permiteReprogramarOnline(datosDesdeElContexto(CONTEXTO), null)).toBe(true)
    expect(permiteReprogramarOnline(datosDesdeElContexto(CONTEXTO), undefined)).toBe(true)
  })
})

describe("el texto que recibe el paciente en vez del enlace", () => {
  it("nombra el turno del que habla, para que no haya dudas de cuál es", () => {
    const t = textoSoloPorTelefono(datosDesdeElContexto(TURNO_GARAY)?.turno, "3415551234")
    expect(t).toContain("GARAY")
    expect(t).toContain("24/09/2026")
    expect(t).toContain("09:00")
    expect(t).toContain("3415551234")
  })

  it("no le explica al paciente el vocabulario interno", () => {
    const t = textoSoloPorTelefono(datosDesdeElContexto(TURNO_GARAY)?.turno, "3415551234")
    expect(t).not.toMatch(/admite_reagendamiento|flag|proxy/i)
  })

  it("sin datos del turno sigue siendo una frase válida", () => {
    const t = textoSoloPorTelefono(undefined, "3415551234")
    expect(t).toContain("no se puede reprogramar desde acá")
    expect(t).toContain("3415551234")
  })

  it("no puede contener lo que suprimiría el saludo inicial", () => {
    // Mismo cuidado que con los textos de archivo entrante: si el mensaje ya
    // dice "asistente virtual" o "bienvenido", `anteponerPresentacion` cree que
    // la presentación ya está hecha y el primer mensaje del día queda sin saludo.
    const t = textoSoloPorTelefono(datosDesdeElContexto(TURNO_GARAY)?.turno, "3415551234")
    expect(t).not.toMatch(/asistente virtual|bienvenid/i)
  })
})
