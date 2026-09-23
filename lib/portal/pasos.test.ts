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
import { decidirPaso, ofreceVerTodos } from "./pasos"

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
