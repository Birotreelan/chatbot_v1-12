/**
 * lib/portal/pasos.test.ts
 *
 * El portal no puede ofrecer algo que la clínica apagó a propósito. Si un
 * cliente decidió que sus pacientes no eligen profesional, el portal no puede
 * ser la puerta trasera por donde sí lo eligen.
 *
 * El otro riesgo es el contrario: dejar al paciente girando entre pantallas de
 * filtro sin llegar nunca a ver un horario.
 */

import { describe, it, expect } from "vitest"
import { decidirPaso, ofreceVerTodos, altaCompleta, esPasoRevisitable } from "./pasos"

const TODO_PERMITIDO = { porEspecialidad: true, porProfesional: true, porCualquiera: true }
const SIN_NADA = {}

describe("reagendar no pasa por filtros", () => {
  it("va directo a elegir horario con el mismo profesional", () => {
    expect(decidirPaso("reagendar", TODO_PERMITIDO, {})).toBe("reprogramar")
    expect(decidirPaso("cancelar", TODO_PERMITIDO, {})).toBe("reprogramar")
  })
})

describe("turno nuevo, con todo permitido", () => {
  it("primero la especialidad", () => {
    expect(decidirPaso("nuevo_turno", TODO_PERMITIDO, {})).toBe("elegir_especialidad")
  })

  it("después el profesional", () => {
    expect(decidirPaso("nuevo_turno", TODO_PERMITIDO, { especialidadId: "5" })).toBe("elegir_profesional")
  })

  it("y por último el horario", () => {
    expect(decidirPaso("nuevo_turno", TODO_PERMITIDO, { especialidadId: "5", profesionalId: "9" })).toBe(
      "elegir_horario",
    )
  })

  it("elegir profesional saltea la especialidad: ya la implica", () => {
    expect(decidirPaso("nuevo_turno", TODO_PERMITIDO, { profesionalId: "9" })).toBe("elegir_horario")
  })
})

describe("los permisos del cliente se respetan", () => {
  it("sin búsqueda por especialidad, arranca en profesional", () => {
    expect(decidirPaso("nuevo_turno", { ...TODO_PERMITIDO, porEspecialidad: false }, {})).toBe(
      "elegir_profesional",
    )
  })

  it("sin búsqueda por profesional, no se le pregunta nunca", () => {
    expect(
      decidirPaso("nuevo_turno", { ...TODO_PERMITIDO, porProfesional: false }, { especialidadId: "5" }),
    ).toBe("elegir_horario")
  })

  it("con los dos apagados va derecho al horario", () => {
    expect(decidirPaso("nuevo_turno", { porEspecialidad: false, porProfesional: false }, {})).toBe(
      "elegir_horario",
    )
  })

  it("un flag ausente significa permitido, igual que en el menú de WhatsApp", () => {
    // Cambiar este criterio acá haría que el portal ofrezca cosas distintas de
    // las que la clínica ve configuradas.
    expect(decidirPaso("nuevo_turno", SIN_NADA, {})).toBe("elegir_especialidad")
  })
})

describe("la salida de emergencia", () => {
  it("'ver todos' saltea los filtros aunque estén habilitados", () => {
    expect(decidirPaso("nuevo_turno", TODO_PERMITIDO, { sinFiltro: true })).toBe("elegir_horario")
  })

  it("se ofrece por defecto", () => {
    expect(ofreceVerTodos(SIN_NADA)).toBe(true)
    expect(ofreceVerTodos(TODO_PERMITIDO)).toBe(true)
  })

  it("no se ofrece si el cliente quiere que elija profesional sí o sí", () => {
    expect(ofreceVerTodos({ porCualquiera: false })).toBe(false)
  })
})

describe("siempre se llega a un horario", () => {
  it("ninguna combinación deja al paciente girando entre filtros", () => {
    const combinaciones = [true, false, undefined]
    for (const porEspecialidad of combinaciones) {
      for (const porProfesional of combinaciones) {
        // Simula que el paciente va eligiendo lo que se le pide, hasta 4 pasos.
        const filtros: any = {}
        let paso = decidirPaso("nuevo_turno", { porEspecialidad, porProfesional }, filtros)
        for (let i = 0; i < 4 && paso !== "elegir_horario"; i++) {
          if (paso === "elegir_especialidad") filtros.especialidadId = "1"
          if (paso === "elegir_profesional") filtros.profesionalId = "1"
          paso = decidirPaso("nuevo_turno", { porEspecialidad, porProfesional }, filtros)
        }
        expect(paso, `${porEspecialidad}/${porProfesional}`).toBe("elegir_horario")
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Identidad: el paciente que el bot NO reconoció por su teléfono (23/9/2026)
// ─────────────────────────────────────────────────────────────────────────────

const CONOCIDO = { dni: "36100432", fichaConsultada: true, tieneFicha: true }

describe("primero saber quién es", () => {
  it("sin DNI se pide el DNI, aunque el cliente permita elegir especialidad", () => {
    // La agenda se filtra por obra social, la obra social sale de la ficha y la
    // ficha sale del DNI. Mostrar horarios antes sería mostrar horarios que
    // después pueden no corresponderle.
    expect(decidirPaso("nuevo_turno", {}, {}, {})).toBe("pedir_dni")
    expect(decidirPaso("nuevo_turno", { porEspecialidad: true }, {}, {})).toBe("pedir_dni")
  })

  it("ni siquiera 'ver todos' se saltea la identidad", () => {
    expect(decidirPaso("nuevo_turno", {}, { sinFiltro: true }, {})).toBe("pedir_dni")
  })

  it("con DNI y ficha se sigue con los filtros de siempre", () => {
    expect(decidirPaso("nuevo_turno", {}, {}, CONOCIDO)).toBe("elegir_especialidad")
  })

  it("reprogramar nunca pide DNI: el token ya trae al paciente", () => {
    expect(decidirPaso("reagendar", {}, {}, {})).toBe("reprogramar")
  })
})

describe("no tiene ficha", () => {
  const SIN_FICHA = { dni: "36100432", fichaConsultada: true, tieneFicha: false }

  it("va al alta", () => {
    expect(decidirPaso("nuevo_turno", {}, {}, SIN_FICHA)).toBe("registrar")
  })

  it("con el alta completa ya no la vuelve a pedir", () => {
    const completo = { ...SIN_FICHA, nombre: "Ana", apellido: "Pérez", email: "a@b.com" }
    expect(decidirPaso("nuevo_turno", {}, {}, completo)).toBe("elegir_especialidad")
  })

  it("no busca el alta si todavía no se consultó la ficha", () => {
    // `fichaConsultada: false` es "no busqué", no "no tiene". Sin esa
    // distinción, un DNI recién tipeado mandaría al alta a alguien que ya
    // existe, y la clínica terminaría con dos historias clínicas de la misma
    // persona.
    const sinBuscar = { dni: "36100432", fichaConsultada: false }
    expect(decidirPaso("nuevo_turno", {}, {}, sinBuscar)).not.toBe("registrar")
  })
})

describe("obra social bloqueada", () => {
  it("corta antes de mostrar un solo horario", () => {
    // Caso Zelmira: recorrió sede, profesional y especialidad completas para
    // enterarse al final de que su obra social no sacaba turnos online.
    const bloqueada = { ...CONOCIDO, obraSocialBloqueada: true }
    expect(decidirPaso("nuevo_turno", {}, {}, bloqueada)).toBe("derivar_obra_social")
    expect(decidirPaso("nuevo_turno", {}, { sinFiltro: true }, bloqueada)).toBe("derivar_obra_social")
  })

  it("no bloquea cuando no se pudo determinar", () => {
    // `undefined` es "no sé". Invertir el default frenaría a TODOS los
    // pacientes si la API dejara de mandar el campo — ver obra-social.ts.
    expect(decidirPaso("nuevo_turno", {}, {}, { ...CONOCIDO, obraSocialBloqueada: undefined }))
      .toBe("elegir_especialidad")
    expect(decidirPaso("nuevo_turno", {}, {}, { ...CONOCIDO, obraSocialBloqueada: false }))
      .toBe("elegir_especialidad")
  })

  it("el alta va antes que el bloqueo: los datos quedan guardados igual", () => {
    const sinFichaBloqueada = { dni: "1234567", fichaConsultada: true, tieneFicha: false, obraSocialBloqueada: true }
    expect(decidirPaso("nuevo_turno", {}, {}, sinFichaBloqueada)).toBe("registrar")
  })
})

describe("altaCompleta", () => {
  it("exige los cuatro campos que usa reservarTurno", () => {
    expect(altaCompleta({ dni: "1", nombre: "A", apellido: "B", email: "a@b.com" })).toBe(true)
    expect(altaCompleta({ nombre: "A", apellido: "B", email: "a@b.com" })).toBe(false)
    expect(altaCompleta({ dni: "1", apellido: "B", email: "a@b.com" })).toBe(false)
    expect(altaCompleta({ dni: "1", nombre: "A", email: "a@b.com" })).toBe(false)
    expect(altaCompleta({ dni: "1", nombre: "A", apellido: "B" })).toBe(false)
    expect(altaCompleta(undefined)).toBe(false)
  })

  it("la obra social NO es obligatoria", () => {
    // Un paciente particular no tiene. Exigirla lo dejaría afuera.
    expect(altaCompleta({ dni: "1", nombre: "A", apellido: "B", email: "a@b.com" })).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La sede (24/9/2026)
//
// Faltaba, y no era cosmético: el portal buscaba con la sede que viniera en el
// token, y el paciente nuevo no trae ninguna. Buscaba en TODAS las sedes, así
// que podía terminar con un turno en la otra punta de la ciudad sin que nada
// se lo advirtiera. El widget la pregunta (`venue_selection`); acá se había
// perdido.
// ─────────────────────────────────────────────────────────────────────────────

describe("la sede va antes que el resto", () => {
  const YO = { dni: "36100432", fichaConsultada: true, tieneFicha: true }

  it("sin sede, se pregunta la sede", () => {
    expect(decidirPaso("nuevo_turno", {}, {}, YO)).toBe("elegir_sede")
  })

  it("'ver todos los horarios' no la saltea", () => {
    // Ese atajo saltea el profesional, no el lugar donde el paciente se va a
    // atender.
    expect(decidirPaso("nuevo_turno", {}, { sinFiltro: true }, YO)).toBe("elegir_sede")
  })

  it("con sede, sigue el orden de siempre", () => {
    expect(decidirPaso("nuevo_turno", {}, { sedeId: "3" }, YO)).toBe("elegir_especialidad")
    expect(decidirPaso("nuevo_turno", {}, { sedeId: "3", especialidadId: "7" }, YO)).toBe("elegir_profesional")
    expect(decidirPaso("nuevo_turno", {}, { sedeId: "3", profesionalId: "9" }, YO)).toBe("elegir_horario")
  })

  it("pero la identidad y la obra social van antes que la sede", () => {
    expect(decidirPaso("nuevo_turno", {}, {}, {})).toBe("pedir_dni")
    expect(decidirPaso("nuevo_turno", {}, {}, { dni: "1", fichaConsultada: true, tieneFicha: false })).toBe("registrar")
    expect(decidirPaso("nuevo_turno", {}, {}, { ...YO, obraSocialBloqueada: true })).toBe("derivar_obra_social")
  })

  it("reprogramar nunca pregunta la sede: el turno ya tiene una", () => {
    expect(decidirPaso("reagendar", {}, {}, {})).toBe("reprogramar")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Volver a corregir (24/9/2026)
//
// `decidirPaso` sólo avanza: con el DNI cargado nunca vuelve a pedirlo. Eso
// estaba bien para avanzar y era un callejón para corregir — quien se equivocó
// un dígito al darse de alta no tenía cómo arreglarlo y el turno se reservaba
// con el DNI equivocado.
//
// El widget deja volver paso a paso hasta el primero. Acá lo hace `?paso=`.
// ─────────────────────────────────────────────────────────────────────────────

describe("volver a un paso anterior", () => {
  const YO = { dni: "36100432", fichaConsultada: true, tieneFicha: true }
  const TODO = { sedeId: "3", tipoBusqueda: "profesional" as const, profesionalId: "9" }

  it("con el flujo completo, se puede volver hasta el primer paso", () => {
    expect(decidirPaso("nuevo_turno", {}, TODO, YO, "pedir_dni")).toBe("pedir_dni")
    expect(decidirPaso("nuevo_turno", {}, TODO, YO, "elegir_sede")).toBe("elegir_sede")
  })

  it("sin pedido explícito, el flujo avanza como siempre", () => {
    expect(decidirPaso("nuevo_turno", {}, TODO, YO)).toBe("elegir_horario")
    expect(decidirPaso("nuevo_turno", {}, TODO, YO, "")).toBe("elegir_horario")
  })

  it("un paso inventado se ignora en vez de romper", () => {
    // La URL la escribe cualquiera. Forzar un paso que el flujo no puede
    // sostener dejaría al paciente en una pantalla que no sabe qué hacer con
    // él, que es peor que ignorar el pedido.
    for (const malo of ["elegir_horario", "derivar_obra_social", "../../etc", "<script>"]) {
      expect(decidirPaso("nuevo_turno", {}, TODO, YO, malo), malo).toBe("elegir_horario")
    }
  })

  it("reprogramar no se deja desviar", () => {
    // Ese enlace es para un turno concreto: no hay identidad que corregir.
    expect(decidirPaso("reagendar", {}, {}, YO, "pedir_dni")).toBe("reprogramar")
  })
})

describe("esPasoRevisitable", () => {
  it("sólo los pasos que el flujo puede sostener", () => {
    expect(esPasoRevisitable("pedir_dni")).toBe(true)
    expect(esPasoRevisitable("registrar")).toBe(true)
    expect(esPasoRevisitable("elegir_sede")).toBe(true)
    expect(esPasoRevisitable("elegir_horario")).toBe(false)
    expect(esPasoRevisitable("derivar_obra_social")).toBe(false)
  })

  it("no se cae con lo que no es una cadena", () => {
    for (const raro of [undefined, null, 3, {}, []]) {
      expect(esPasoRevisitable(raro), String(raro)).toBe(false)
    }
  })
})
