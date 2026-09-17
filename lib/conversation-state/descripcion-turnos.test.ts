/**
 * lib/conversation-state/descripcion-turnos.test.ts
 *
 * Caso real (Marcela, 17/9/2026): recordatorio `confirmacion_2_turno` con dos
 * turnos el mismo día. Ella preguntó si podía cambiarlos y el bot contestó
 * "Veo que tenés un turno programado ... a las 08:25:00" — un solo turno, y la
 * hora sin formatear.
 *
 * Que aparezcan los dos no es cosmético: la confirmación y la cancelación se
 * mandan al proxy POR FECHA, así que la acción alcanza a ambos. Nombrar uno
 * solo le oculta al paciente qué está por pasar.
 */

import { describe, it, expect } from "vitest"
import { describirTurnos, formatearHora, hayVariosTurnos, turnosDelContexto } from "./descripcion-turnos"

/** Formateador de fecha de juguete, para que los asserts sean legibles. */
const fmt = (f: string) => (f === "2026-09-19" ? "sábado, 19 de septiembre de 2026" : f)

const DOS_TURNOS = {
  turnos: [
    { fecha: "2026-09-19", hora: "08:25:00", profesional: "DEPARTAMENTO DE ESTUDIOS", sede: "SALUD OCULAR CALLAO" },
    { fecha: "2026-09-19", hora: "08:30:00", profesional: "TRAVERSO ALVARADO ARIANNA ANDREA", sede: "SALUD OCULAR CALLAO" },
  ],
}

const UN_TURNO = {
  turnos: [
    { fecha: "2026-09-19", hora: "08:25:00", profesional: "DEPARTAMENTO DE ESTUDIOS", sede: "SALUD OCULAR CALLAO" },
  ],
}

describe("formatearHora", () => {
  it("le saca los segundos a la hora cruda del backend", () => {
    expect(formatearHora("08:25:00")).toBe("08:25")
    expect(formatearHora("14:00:00")).toBe("14:00")
  })

  it("deja intacta la que ya viene bien", () => {
    expect(formatearHora("08:25")).toBe("08:25")
  })

  it("completa la hora de un dígito", () => {
    expect(formatearHora("8:25")).toBe("08:25")
  })

  it("no rompe ni inventa con entradas raras", () => {
    expect(formatearHora("")).toBe("")
    expect(formatearHora(null)).toBe("")
    expect(formatearHora(undefined)).toBe("")
    // Si no la reconoce, la devuelve tal cual en vez de romperla.
    expect(formatearHora("a la mañana")).toBe("a la mañana")
  })
})

describe("el caso de Marcela: dos turnos el mismo día", () => {
  it("nombra los dos", () => {
    const texto = describirTurnos(DOS_TURNOS, fmt)!
    expect(texto).toContain("DEPARTAMENTO DE ESTUDIOS")
    expect(texto).toContain("TRAVERSO ALVARADO ARIANNA ANDREA")
  })

  it("dice cuántos son", () => {
    expect(describirTurnos(DOS_TURNOS, fmt)).toContain("*2 turnos*")
  })

  it("muestra las horas formateadas", () => {
    const texto = describirTurnos(DOS_TURNOS, fmt)!
    expect(texto).toContain("08:25")
    expect(texto).toContain("08:30")
    expect(texto).not.toContain("08:25:00")
  })

  it("no repite la fecha ni la sede en cada línea si son las mismas", () => {
    const texto = describirTurnos(DOS_TURNOS, fmt)!
    expect(texto.match(/19 de septiembre/g)?.length).toBe(1)
    expect(texto.match(/SALUD OCULAR CALLAO/g)?.length).toBe(1)
  })

  it("el menú tiene que hablar en plural", () => {
    expect(hayVariosTurnos(DOS_TURNOS)).toBe(true)
    expect(hayVariosTurnos(UN_TURNO)).toBe(false)
  })
})

describe("con un solo turno se lee como una frase, no como lista", () => {
  it("arma la frase completa", () => {
    const texto = describirTurnos(UN_TURNO, fmt)!
    expect(texto).toBe(
      "un turno programado para el *sábado, 19 de septiembre de 2026* a las *08:25* con DEPARTAMENTO DE ESTUDIOS en SALUD OCULAR CALLAO",
    )
  })

  it("no dice 'turnos' ni enumera", () => {
    expect(describirTurnos(UN_TURNO, fmt)).not.toContain("•")
  })
})

describe("turnos en días o sedes distintas", () => {
  it("repite la fecha en cada línea cuando difieren", () => {
    const ctx = {
      turnos: [
        { fecha: "2026-09-19", hora: "08:25:00", profesional: "A", sede: "Callao" },
        { fecha: "2026-09-25", hora: "14:00:00", profesional: "B", sede: "Callao" },
      ],
    }
    const texto = describirTurnos(ctx, (f) => f)!
    expect(texto).toContain("2026-09-19")
    expect(texto).toContain("2026-09-25")
  })

  it("aclara la sede por línea cuando difieren", () => {
    const ctx = {
      turnos: [
        { fecha: "2026-09-19", hora: "08:25:00", profesional: "A", sede: "Callao" },
        { fecha: "2026-09-19", hora: "09:00:00", profesional: "B", sede: "Caseros" },
      ],
    }
    const texto = describirTurnos(ctx, fmt)!
    expect(texto).toContain("(Callao)")
    expect(texto).toContain("(Caseros)")
  })
})

describe("contextos incompletos o viejos", () => {
  it("sin turnos devuelve null, para que el llamador omita la frase", () => {
    expect(describirTurnos({ turnos: [] }, fmt)).toBeNull()
    expect(describirTurnos({}, fmt)).toBeNull()
    expect(describirTurnos(null, fmt)).toBeNull()
  })

  it("soporta el formato viejo con los campos en la raíz", () => {
    const ctx = { fecha: "2026-09-19", hora: "08:25:00", profesional: "A", sede: "Callao" }
    expect(turnosDelContexto(ctx)).toHaveLength(1)
    expect(describirTurnos(ctx, fmt)).toContain("08:25")
  })

  it("un turno sin hora lo dice, no lo inventa", () => {
    const ctx = { turnos: [{ fecha: "2026-09-19", profesional: "A", sede: "Callao" }] }
    expect(describirTurnos(ctx, fmt)).toContain("hora no disponible")
  })

  it("un turno sin profesional no deja un 'con' colgado", () => {
    const ctx = { turnos: [{ fecha: "2026-09-19", hora: "08:25:00", sede: "Callao" }] }
    expect(describirTurnos(ctx, fmt)).not.toContain("con  en")
  })

  it("prefiere los campos formateados cuando no está el crudo", () => {
    const ctx = { turnos: [{ fecha_formateada: "19/09/2026", hora_formateada: "08:25", profesional: "A" }] }
    expect(describirTurnos(ctx, (f) => f)).toContain("19/09/2026")
  })
})
