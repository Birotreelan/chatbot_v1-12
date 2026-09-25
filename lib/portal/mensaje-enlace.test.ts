/**
 * lib/portal/mensaje-enlace.test.ts
 *
 * El texto que acompaña al botón del portal. Es el último mensaje que el
 * paciente lee antes de decidir si toca o abandona, así que las dos cosas que
 * se prueban acá son: que diga lo correcto según el flujo, y que no se rompa
 * cuando falta el nombre — que es el caso más común, porque al paciente que el
 * bot no reconoció no lo conocemos.
 */

import { describe, it, expect } from "vitest"
import {
  textoDelEnlace,
  primerNombrePresentable,
  PLANTILLAS_DEL_ENLACE,
  PLANTILLA_SIN_TURNO,
} from "./mensaje-enlace"

describe("cada flujo dice lo suyo", () => {
  it("solicitar un turno", () => {
    expect(textoDelEnlace({ intencion: "nuevo_turno", nombre: "Nicolas DE SANTIAGO" })).toBe(
      "Nicolas, para solicitar tu turno, utilizá el botón que aparece a continuación.",
    )
  })

  it("el turno de un familiar no dice 'tu turno'", () => {
    // Si dijera "tu turno", quien pide para su madre carga su propio DNI y el
    // turno queda a nombre equivocado.
    const t = textoDelEnlace({ intencion: "familiar", nombre: "Nicolas" })
    expect(t).toContain("el turno de tu familiar")
    expect(t).not.toMatch(/\btu turno\b/)
  })

  it("reagendar nombra el turno del que habla", () => {
    expect(
      textoDelEnlace({
        intencion: "reagendar",
        nombre: "NICOLAS",
        turno: { fechaFormateada: "24/09/2026", horaFormateada: "09:00" },
      }),
    ).toBe(
      "Nicolas, para reagendar tu turno del 24/09/2026 a las 09:00, utilizá el botón que aparece a continuación.",
    )
  })

  it("sin fecha, reagendar sigue siendo una frase correcta", () => {
    expect(textoDelEnlace({ intencion: "reagendar", nombre: "Ana" })).toBe(
      "Ana, para reagendar tu turno, utilizá el botón que aparece a continuación.",
    )
  })
})

describe("el nombre", () => {
  it("sin nombre la frase arranca en mayúscula", () => {
    expect(textoDelEnlace({ intencion: "nuevo_turno" })).toBe(
      "Para solicitar tu turno, utilizá el botón que aparece a continuación.",
    )
  })

  it("un nombre en mayúsculas no se le grita al paciente", () => {
    expect(primerNombrePresentable("NICOLAS")).toBe("Nicolas")
  })

  it("se toma el primer nombre, no el nombre completo", () => {
    // "Nicolas De Santiago, para solicitar..." suena a carta de un banco.
    expect(primerNombrePresentable("Nicolas DE SANTIAGO")).toBe("Nicolas")
    expect(primerNombrePresentable("DE SANTIAGO, Nicolas")).toBe("Nicolas")
  })

  it("lo que no es un nombre no se usa", () => {
    for (const malo of ["", "   ", "123", "A", null, undefined]) {
      expect(primerNombrePresentable(malo), String(malo)).toBeNull()
    }
  })
})

describe("redacción propia del cliente", () => {
  it("se usa tal cual y el nombre se antepone", () => {
    expect(
      textoDelEnlace({ intencion: "nuevo_turno", nombre: "Ana", plantilla: "tocá el botón y listo." }),
    ).toBe("Ana, tocá el botón y listo.")
  })

  it("si ubica {nombre}, se respeta ese lugar", () => {
    expect(
      textoDelEnlace({ intencion: "nuevo_turno", nombre: "Ana", plantilla: "Hola {nombre}: tu turno." }),
    ).toBe("Hola Ana: tu turno.")
  })

  it("un {nombre} sin nombre no deja el hueco ni la puntuación suelta", () => {
    // "Hola : tu turno" y "Tu turno,, se saca" son lo que salía antes. Son el
    // mensaje que ve un paciente, no un log.
    expect(textoDelEnlace({ intencion: "nuevo_turno", plantilla: "Hola {nombre}: tu turno." })).toBe(
      "Hola: tu turno.",
    )
    expect(textoDelEnlace({ intencion: "nuevo_turno", plantilla: "Tu turno, {nombre}, se saca." })).toBe(
      "Tu turno, se saca.",
    )
  })

  it("vacía o en blanco cae en la plantilla del flujo", () => {
    expect(textoDelEnlace({ intencion: "nuevo_turno", nombre: "Ana", plantilla: "   " })).toBe(
      "Ana, para solicitar tu turno, utilizá el botón que aparece a continuación.",
    )
  })
})

describe("la restricción que no se puede romper", () => {
  it("ninguna plantilla suprimiría el saludo inicial", () => {
    // `presentarSiCorresponde` busca estas palabras para decidir si el mensaje
    // ya se presenta solo. Si las encuentra, el primer mensaje del día queda
    // sin saludo — ya pasó una vez con los textos de archivo entrante.
    for (const [flujo, plantilla] of Object.entries(PLANTILLAS_DEL_ENLACE)) {
      expect(plantilla, flujo).not.toMatch(/asistente virtual|bienvenid/i)
    }
  })

  it("las plantillas están escritas para continuar después del nombre", () => {
    // En minúscula y sin punto al inicio: es lo que permite armar las dos
    // formas (con y sin nombre) desde una sola cadena.
    for (const [flujo, plantilla] of Object.entries(PLANTILLAS_DEL_ENLACE)) {
      expect(plantilla.charAt(0), flujo).toBe(plantilla.charAt(0).toLowerCase())
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tocó un botón del recordatorio y el turno ya no existe (25/9/2026)
//
// Reportado: el paciente cancela desde el portal y después toca "Reprogramar
// turno" en el mismo mensaje —los botones siguen tocables—. Se le mandaba un
// enlace de turno nuevo con el texto de turno nuevo, así que leía "para
// solicitar tu turno" después de haber pedido reprogramar uno.
// ─────────────────────────────────────────────────────────────────────────────

describe("cuando ya no hay turno que reprogramar", () => {
  it("explica qué pasó antes de ofrecer la salida", () => {
    const t = textoDelEnlace({
      intencion: "nuevo_turno",
      nombre: "Nicolas DE SANTIAGO",
      plantilla: PLANTILLA_SIN_TURNO,
    })
    // El orden importa: quien lee "sacá un turno" sin la explicación previa
    // cree que el bot no lo entendió.
    expect(t.indexOf("no encontramos un turno activo")).toBeLessThan(t.indexOf("sacar uno nuevo"))
    expect(t.startsWith("Nicolas, ")).toBe(true)
  })

  it("funciona sin nombre, como el resto", () => {
    expect(textoDelEnlace({ intencion: "nuevo_turno", plantilla: PLANTILLA_SIN_TURNO })).toBe(
      "No encontramos un turno activo para reprogramar; puede que ya lo hayas cancelado. " +
        "Si querés sacar uno nuevo, usá el botón de acá abajo.",
    )
  })

  it("no suprimiría el saludo inicial", () => {
    expect(PLANTILLA_SIN_TURNO).not.toMatch(/asistente virtual|bienvenid/i)
  })
})
