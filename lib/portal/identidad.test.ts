/**
 * lib/portal/identidad.test.ts
 *
 * La validación del alta. Es la única parte del portal donde el paciente
 * escribe texto libre que termina creando una ficha en el sistema de la
 * clínica, así que lo que pase acá se convierte en un registro permanente que
 * después alguien tiene que mirar.
 *
 * El criterio de los validadores: laxos con lo raro-pero-válido, firmes con lo
 * que claramente no es un dato. Un validador estricto de más rechaza pacientes
 * reales, y un paciente rechazado por su propio apellido no vuelve.
 */

import { describe, it, expect } from "vitest"
import { normalizarDNI, normalizarEmail, normalizarNombre, validarAlta } from "./identidad"

describe("normalizarDNI", () => {
  it("saca puntos y espacios, que es como la gente lo escribe", () => {
    expect(normalizarDNI("36.100.432")).toBe("36100432")
    expect(normalizarDNI(" 36 100 432 ")).toBe("36100432")
  })

  it("acepta documentos de 7 dígitos", () => {
    // Los pacientes mayores los tienen, y los pacientes mayores son una parte
    // grande de quienes sacan turnos médicos. Un validador de 8 estrictos los
    // dejaría afuera del portal.
    expect(normalizarDNI("4123456")).toBe("4123456")
  })

  it("rechaza lo que no puede ser un DNI", () => {
    for (const malo of ["", "123", "123456789012", "abc", null, undefined, "0000000"]) {
      expect(normalizarDNI(malo), String(malo)).toBeNull()
    }
  })
})

describe("normalizarEmail", () => {
  it("normaliza a minúsculas y recorta", () => {
    expect(normalizarEmail("  Nicolas@Ejemplo.COM ")).toBe("nicolas@ejemplo.com")
  })

  it("acepta direcciones válidas con formas poco comunes", () => {
    expect(normalizarEmail("a.b+c@sub.dominio.com.ar")).toBe("a.b+c@sub.dominio.com.ar")
  })

  it("rechaza lo que no llega a ser una dirección", () => {
    for (const malo of ["", "nicolas", "nicolas@", "@ejemplo.com", "a@b", "a b@c.com", null]) {
      expect(normalizarEmail(malo), String(malo)).toBeNull()
    }
  })
})

describe("normalizarNombre", () => {
  it("colapsa espacios de más sin tocar el resto", () => {
    expect(normalizarNombre("  DE   SANTIAGO ")).toBe("DE SANTIAGO")
  })

  it("acepta apellidos con acentos, apóstrofos y guiones", () => {
    // Rechazar el apellido de alguien es una forma muy eficaz de perderlo.
    for (const bueno of ["Ñuñez", "D'Alessandro", "García-López", "O'Brien", "Müller"]) {
      expect(normalizarNombre(bueno), bueno).toBe(bueno)
    }
  })

  it("rechaza lo que no tiene ninguna letra", () => {
    for (const malo of ["", "a", "123", "--", "   ", null]) {
      expect(normalizarNombre(malo), String(malo)).toBeNull()
    }
  })
})

describe("validarAlta", () => {
  const BUENO = { dni: "36.100.432", nombre: "Nicolas", apellido: "De Santiago", email: "N@Ejemplo.com" }

  it("devuelve los datos ya normalizados, no los originales", () => {
    const r = validarAlta(BUENO)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.dni).toBe("36100432")
      expect(r.datos.email).toBe("n@ejemplo.com")
    }
  })

  it("junta TODOS los errores, no corta en el primero", () => {
    // Que el paciente corrija el apellido, mande, y recién ahí se entere de que
    // el email también estaba mal es la forma más rápida de que abandone.
    const r = validarAlta({ dni: "x", nombre: "", apellido: "", email: "no" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.errores).sort()).toEqual(["apellido", "dni", "email", "nombre"])
    }
  })

  it("los mensajes de error le hablan al paciente, no al programador", () => {
    const r = validarAlta({ dni: "x", nombre: "A", apellido: "B", email: "c@d.com" })
    if (!r.ok) {
      expect(r.errores.dni).not.toMatch(/null|undefined|regex|inválido|invalid/i)
      expect(r.errores.dni).toMatch(/DNI/)
    }
  })

  it("no exige obra social", () => {
    expect(validarAlta(BUENO).ok).toBe(true)
  })
})
