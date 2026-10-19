/**
 * lib/importe-aproximado.test.ts
 *
 * La cuenta que comparten el panel y /api/appointment-stats. El caso base es
 * el ejemplo real de Salud Ocular, septiembre 2026.
 */

import { describe, it, expect } from "vitest"

import { calcularImporteAproximado, textoDelImporte } from "./importe-aproximado"

describe("calcularImporteAproximado", () => {
  it("reproduce el ejemplo de septiembre: 7.664 unidades a US$ 0,075 con dólar a $ 1.540", () => {
    const i = calcularImporteAproximado({
      recordatorios: 2557,
      mensajesDeServicio: 5107,
      precioUnitarioUsd: 0.075,
      precioPropio: true,
      dolarVenta: 1540,
    })

    expect(i.unidades).toBe(7664)
    expect(i.totalUsd).toBe(574.8)
    expect(i.totalPesos).toBe(885192)

    expect(textoDelImporte(i)).toEqual({
      importe: "$ 885.192",
      unidades: "2.557 recordatorios + 5.107 mensajes de servicio = 7.664 unidades",
      calculo: "7.664 × US$ 0,075 = US$ 574,80 · dólar venta $ 1.540",
    })
  })

  it("sin cotización devuelve el total en dólares y totalPesos en null, no un cero", () => {
    const i = calcularImporteAproximado({
      recordatorios: 10,
      mensajesDeServicio: 0,
      precioUnitarioUsd: 0.075,
      dolarVenta: null,
    })

    expect(i.totalPesos).toBeNull()
    expect(i.dolarVenta).toBeNull()
    const t = textoDelImporte(i)
    expect(t.importe).toBe("US$ 0,75")
    expect(t.calculo).toContain("no pudimos obtener la cotización del dólar")
  })

  it("singular cuando hay una sola unidad", () => {
    const t = textoDelImporte(
      calcularImporteAproximado({ recordatorios: 1, mensajesDeServicio: 0, precioUnitarioUsd: 0.1, dolarVenta: 1000 }),
    )
    expect(t.unidades).toBe("1 recordatorio + 0 mensajes de servicio = 1 unidad")
  })
})
