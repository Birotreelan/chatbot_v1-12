/**
 * lib/conversation-state/shared/interpretar-confirmacion.test.ts
 *
 * Esta función decide si se reserva un turno real en la agenda de una clínica.
 * Los tests están agrupados por consecuencia, no por tipo de entrada:
 *
 *   1. Lo que NO debe confirmar (el bug real y sus parientes)
 *   2. Lo que SÍ debe confirmar sin molestar a nadie (para no romper el 95%
 *      de las respuestas, que son "1" o "si")
 *   3. Lo que debe rechazar
 *
 * El grupo 2 importa tanto como el 1: si la función se vuelve demasiado
 * estricta, cada confirmación paga una llamada a la IA y una repregunta.
 */

import { describe, it, expect } from "vitest"
import { interpretarConfirmacion } from "./interpretar-confirmacion"

describe("no confirma lo que no es una confirmación", () => {
  it("el caso real: 'Jueves 17\\n2' no reserva el turno", () => {
    // El "1" de "17" alcanzaba para confirmar. Su respuesta era el 2.
    const r = interpretarConfirmacion("Jueves 17 \n2")
    expect(r.lectura).not.toBe("confirma")
  })

  it("un número que contiene un 1 no es la opción 1", () => {
    expect(interpretarConfirmacion("el 21 no me sirve").lectura).not.toBe("confirma")
    expect(interpretarConfirmacion("prefiero el 15").lectura).not.toBe("confirma")
    expect(interpretarConfirmacion("mi dni es 12345678").lectura).not.toBe("confirma")
  })

  it("'necesito cambiar' no es un sí, aunque contenga las letras s-i", () => {
    // 'neceSIto' hacía que includes('si') diera true.
    expect(interpretarConfirmacion("necesito cambiar la fecha").lectura).not.toBe("confirma")
  })

  it("'siempre' y 'sino' tampoco son un sí", () => {
    expect(interpretarConfirmacion("siempre me atiende otro medico").lectura).not.toBe("confirma")
    expect(interpretarConfirmacion("sino puedo otro dia").lectura).not.toBe("confirma")
  })

  it("decir las dos cosas no se resuelve adivinando", () => {
    expect(interpretarConfirmacion("si pero no").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("1 2").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("no, confirmo el otro").lectura).toBe("ambiguo")
  })

  it("un mensaje vacío o sin señal no decide nada", () => {
    expect(interpretarConfirmacion("").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("   \n  ").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("hmm").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("?").lectura).toBe("ambiguo")
  })

  it("una pregunta no es una respuesta", () => {
    expect(interpretarConfirmacion("puede ser mas temprano?").lectura).toBe("ambiguo")
    expect(interpretarConfirmacion("la dra rodriguez atiende los sabados?").lectura).toBe("ambiguo")
  })

  it("explica por qué se abstuvo, para poder auditarlo en los logs", () => {
    expect(interpretarConfirmacion("Jueves 17 \n2").motivo).toContain("jueves")
    expect(interpretarConfirmacion("si pero no").motivo).toContain("contradictorias")
  })
})

describe("confirma lo que claramente es un sí", () => {
  it("la opción del menú", () => {
    expect(interpretarConfirmacion("1").lectura).toBe("confirma")
    expect(interpretarConfirmacion(" 1 ").lectura).toBe("confirma")
    expect(interpretarConfirmacion("1.").lectura).toBe("confirma")
  })

  it("las formas habituales de decir que sí", () => {
    for (const entrada of ["si", "sí", "SI", "Si", "ok", "dale", "listo", "confirmo", "perfecto", "correcto"]) {
      expect(interpretarConfirmacion(entrada).lectura, entrada).toBe("confirma")
    }
  })

  it("un sí con cortesía sigue siendo un sí, sin pagar una llamada a la IA", () => {
    expect(interpretarConfirmacion("si, gracias").lectura).toBe("confirma")
    expect(interpretarConfirmacion("Sí muchas gracias").lectura).toBe("confirma")
    expect(interpretarConfirmacion("dale, gracias!").lectura).toBe("confirma")
    expect(interpretarConfirmacion("1, por favor").lectura).toBe("confirma")
    expect(interpretarConfirmacion("si confirmo").lectura).toBe("confirma")
  })
})

describe("rechaza lo que claramente es un no", () => {
  it("la opción del menú", () => {
    expect(interpretarConfirmacion("2").lectura).toBe("rechaza")
    expect(interpretarConfirmacion(" 2 ").lectura).toBe("rechaza")
  })

  it("las formas habituales de decir que no", () => {
    for (const entrada of ["no", "No", "modificar", "cambiar", "cancelar", "incorrecto"]) {
      expect(interpretarConfirmacion(entrada).lectura, entrada).toBe("rechaza")
    }
  })

  it("un no con cortesía", () => {
    expect(interpretarConfirmacion("no, gracias").lectura).toBe("rechaza")
    expect(interpretarConfirmacion("2 por favor").lectura).toBe("rechaza")
  })
})
