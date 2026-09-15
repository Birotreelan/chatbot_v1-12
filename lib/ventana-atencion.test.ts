/**
 * lib/ventana-atencion.test.ts
 *
 * Lo que más importa acá no es el cálculo de horas, que es trivial, sino que
 * "no tengo el dato" nunca se convierta en "está cerrada". Esa confusión —
 * ausencia de información tratada como hecho positivo — es la causa raíz que
 * se repitió en varias conversaciones rotas de este sistema, y acá se
 * traduciría en bloquearle el envío a un agente sin motivo.
 */

import { describe, it, expect } from "vitest"
import { calcularDesde, describirVentana } from "./ventana-atencion"

const HORA = 60 * 60 * 1000
const AHORA = new Date("2026-09-15T12:00:00.000Z").getTime()

function haceHoras(horas: number): string {
  return new Date(AHORA - horas * HORA).toISOString()
}

describe("calcularDesde", () => {
  it("está abierta si el paciente escribió recién", () => {
    const r = calcularDesde(haceHoras(0.5), AHORA)
    expect(r.estado).toBe("abierta")
    expect(r.minutosRestantes).toBe(23 * 60 + 30)
  })

  it("sigue abierta a las 23 horas", () => {
    expect(calcularDesde(haceHoras(23), AHORA).estado).toBe("abierta")
  })

  it("se cierra a las 24 horas exactas", () => {
    expect(calcularDesde(haceHoras(24), AHORA).estado).toBe("cerrada")
  })

  it("está cerrada si el paciente escribió hace dos días", () => {
    const r = calcularDesde(haceHoras(48), AHORA)
    expect(r.estado).toBe("cerrada")
    expect(r.minutosRestantes).toBeUndefined()
  })

  it("informa cuándo se cierra, para poder mostrarlo", () => {
    const r = calcularDesde(haceHoras(1), AHORA)
    expect(r.cierraEn).toBe(new Date(AHORA + 23 * HORA).toISOString())
  })

  it("con una fecha inválida dice 'desconocida', no 'cerrada'", () => {
    // Un timestamp corrupto no es evidencia de que la ventana se haya cerrado.
    expect(calcularDesde("no es una fecha", AHORA).estado).toBe("desconocida")
    expect(calcularDesde("", AHORA).estado).toBe("desconocida")
  })
})

describe("describirVentana", () => {
  it("dice cuántas horas quedan", () => {
    expect(describirVentana(calcularDesde(haceHoras(2), AHORA))).toBe(
      "Quedan 22 h de la ventana de 24 h.",
    )
  })

  it("incluye los minutos cuando no es una hora redonda", () => {
    expect(describirVentana(calcularDesde(haceHoras(1.5), AHORA))).toBe(
      "Quedan 22 h 30 min de la ventana de 24 h.",
    )
  })

  it("usa solo minutos cuando queda menos de una hora", () => {
    expect(describirVentana(calcularDesde(haceHoras(23.5), AHORA))).toBe(
      "Quedan 30 min de la ventana de 24 h.",
    )
  })

  it("cuando está cerrada explica qué tiene que pasar para reabrirla", () => {
    const texto = describirVentana({ estado: "cerrada" })
    expect(texto).toContain("el paciente escriba")
  })

  it("cuando no sabe, lo dice — no afirma que esté cerrada", () => {
    const texto = describirVentana({ estado: "desconocida" })
    expect(texto).toContain("no se puede saber")
    expect(texto).not.toContain("está cerrada")
  })
})
