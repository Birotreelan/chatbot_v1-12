/**
 * lib/api-tools/subespecialidad-id.test.ts
 *
 * El tipo del `Subespecialidad_Id` que se le manda al proxy.
 *
 * Parece un detalle y decide si el filtro por especialidad funciona o no. El
 * bot manda `1` y filtra; el portal mandaba `"1"` y el proxy lo ignoraba en
 * silencio — devolvía TODOS los turnos, de todas las especialidades, sin
 * ningún error. Un filtro que no filtra y no se queja.
 *
 * El test replica la conversión sola porque `obtenerTurnos` sale a la red. Lo
 * que se protege es la regla: dígitos → número, cualquier otra cosa → intacta.
 */

import { describe, it, expect } from "vitest"

/** La misma regla que aplica `obtenerTurnos`. */
function comoLoEsperaElProxy(valor: unknown): unknown {
  const comoTexto = String(valor).trim()
  return /^\d+$/.test(comoTexto) ? Number(comoTexto) : valor
}

describe("Subespecialidad_Id", () => {
  it("un id numérico viaja como número, venga como venga", () => {
    // El del portal sale de la query string, así que siempre es texto.
    expect(comoLoEsperaElProxy("1")).toBe(1)
    expect(comoLoEsperaElProxy(" 22 ")).toBe(22)
    expect(comoLoEsperaElProxy(1)).toBe(1)
  })

  it("lo que no es un número queda intacto", () => {
    // `Sede_Id` y `Profesional_Id` son UUIDs. Convertir a ciegas los rompería,
    // y ese error sería mucho peor: en vez de no filtrar, no encontraría nada.
    const uuid = "565ae021-3ee7-102e-8425-80636cf68bd6"
    expect(comoLoEsperaElProxy(uuid)).toBe(uuid)
    expect(comoLoEsperaElProxy("22-A")).toBe("22-A")
    expect(comoLoEsperaElProxy("oftalmologia")).toBe("oftalmologia")
  })
})
