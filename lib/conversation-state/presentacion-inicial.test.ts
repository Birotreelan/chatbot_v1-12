/**
 * lib/conversation-state/presentacion-inicial.test.ts
 *
 * El caso que motivó esto (Marcela, 17/9/2026): GPT generó una respuesta que
 * empezaba con "Hola, estoy bien, gracias", la guarda vieja la tomó por
 * "ya saluda" y se salteó la presentación. La paciente nunca supo que estaba
 * hablando con una IA.
 *
 * De ahí la distinción que estos tests protegen: **presentarse no es saludar**.
 * Que el texto traiga un "hola" no significa que se haya identificado.
 */

import { describe, it, expect } from "vitest"
import { anteponerPresentacion, construirPresentacion } from "./presentacion-inicial"

const CLINICA = "SALUD OCULAR CALLAO"

describe("construirPresentacion", () => {
  it("siempre aclara que es inteligencia artificial", () => {
    const texto = construirPresentacion({ nombre: "Marcela", clinica: CLINICA, mensajeYaSaluda: false })
    expect(texto).toContain("asistente virtual de inteligencia artificial")
  })

  it("usa el nombre de pila, normalizado", () => {
    expect(construirPresentacion({ nombre: "MARCELA GOMEZ", clinica: CLINICA, mensajeYaSaluda: false }))
      .toContain("*¡Hola, Marcela!*")
  })

  it("sin nombre saluda igual, sin dejar un hueco", () => {
    const texto = construirPresentacion({ nombre: null, clinica: CLINICA, mensajeYaSaluda: false })
    expect(texto).toMatch(/^\*¡Hola!\*/)
  })

  it("sin clínica no deja un 'de' colgado", () => {
    const texto = construirPresentacion({ nombre: "Marcela", clinica: null, mensajeYaSaluda: false })
    expect(texto).toContain("inteligencia artificial.")
    expect(texto).not.toContain(" de .")
  })

  it("si el mensaje ya saluda, va sólo la identificación", () => {
    const texto = construirPresentacion({ nombre: "Marcela", clinica: CLINICA, mensajeYaSaluda: true })
    expect(texto).not.toContain("¡Hola")
    expect(texto).toContain("asistente virtual de inteligencia artificial")
  })
})

describe("el caso de Marcela: un 'hola' del modelo no puede tapar la identificación", () => {
  const RESPUESTA_GPT = "Hola, estoy bien, gracias. Vamos a ver cómo podemos ayudarte a cambiar tu turno."

  it("se presenta igual", () => {
    const texto = anteponerPresentacion(RESPUESTA_GPT, { nombre: "Marcela", clinica: CLINICA })
    expect(texto).toContain("asistente virtual de inteligencia artificial")
  })

  it("no encima un segundo saludo", () => {
    const texto = anteponerPresentacion(RESPUESTA_GPT, { nombre: "Marcela", clinica: CLINICA })
    expect(texto).not.toContain("¡Hola, Marcela!")
  })

  it("conserva el mensaje original íntegro", () => {
    const texto = anteponerPresentacion(RESPUESTA_GPT, { nombre: "Marcela", clinica: CLINICA })
    expect(texto).toContain(RESPUESTA_GPT)
  })
})

describe("no se presenta dos veces", () => {
  it("un mensaje que ya se identifica queda intacto", () => {
    // El saludo de detección de paciente ya trae su propia presentación.
    const bienvenida =
      "*Santino, ¡bienvenido de nuevo a Salud Ocular!*\n\nSoy Iris, tu asistente virtual de inteligencia artificial."
    expect(anteponerPresentacion(bienvenida, { nombre: "Santino", clinica: CLINICA })).toBe(bienvenida)
  })

  it("alcanza con que diga 'asistente virtual'", () => {
    const mensaje = "Soy Iris, la asistente virtual. ¿En qué te ayudo?"
    expect(anteponerPresentacion(mensaje, { nombre: "Ana", clinica: CLINICA })).toBe(mensaje)
  })
})

describe("mensajes que no saludan", () => {
  it("reciben el saludo completo con nombre", () => {
    const texto = anteponerPresentacion("Tu turno es a las 08:25.", { nombre: "Marcela", clinica: CLINICA })
    expect(texto).toMatch(/^\*¡Hola, Marcela!\* Soy Iris/)
    expect(texto).toContain("Tu turno es a las 08:25.")
  })

  it("dejan una línea en blanco entre la presentación y el mensaje", () => {
    const texto = anteponerPresentacion("Tu turno es a las 08:25.", { nombre: "Marcela", clinica: CLINICA })
    expect(texto).toContain("\n\nTu turno")
  })

  it("un mensaje vacío no se toca", () => {
    expect(anteponerPresentacion("", { nombre: "Marcela" })).toBe("")
    expect(anteponerPresentacion("   ", { nombre: "Marcela" })).toBe("   ")
  })
})

describe("variantes de saludo que sí detecta", () => {
  for (const apertura of ["Hola,", "hola!", "Buenos días,", "Buenas tardes,", "Buen día,"]) {
    it(`"${apertura}" cuenta como saludo`, () => {
      const texto = anteponerPresentacion(`${apertura} tu turno es mañana.`, {
        nombre: "Ana",
        clinica: CLINICA,
      })
      expect(texto).not.toContain("¡Hola, Ana!")
      expect(texto).toContain("inteligencia artificial")
    })
  }
})
