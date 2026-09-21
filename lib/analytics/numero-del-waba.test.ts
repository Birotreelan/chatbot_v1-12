/**
 * lib/analytics/numero-del-waba.test.ts
 *
 * Esta función decide a qué clínica se le atribuye —y se le factura— un
 * consumo. Por eso los tests están escritos alrededor de una sola pregunta:
 * ¿puede terminar mostrando el consumo de otro cliente?
 *
 * La respuesta tiene que ser no en todos los casos, incluso a costa de no
 * mostrar nada.
 */

import { describe, it, expect } from "vitest"
import { elegirNumeroDelWaba } from "./numero-del-waba"

const NUM_A = "5491144175052"
const NUM_B = "5492216543210"

describe("el caso que motivó el arreglo: varios números en un WABA", () => {
  it("elige el de la configuración, no el primero de la lista", () => {
    // Antes devolvía siempre numeros[0]. Acá el nuestro es el segundo.
    const r = elegirNumeroDelWaba([NUM_A, NUM_B], NUM_B)
    expect(r).toEqual({ ok: true, numero: NUM_B, unico: false })
  })

  it("no atribuye nada si la config no tiene número cargado", () => {
    const r = elegirNumeroDelWaba([NUM_A, NUM_B], "")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain("Número de WhatsApp")
  })

  it("no atribuye nada si el número configurado no está en el WABA", () => {
    const r = elegirNumeroDelWaba([NUM_A, NUM_B], "5491100000000")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain("no está entre los de este WABA")
  })

  it("no elige a ciegas cuando el número configurado es ambiguo", () => {
    // Un número corto puede ser sufijo de dos del WABA. Elegir uno sería
    // adivinar a quién le facturamos.
    const r = elegirNumeroDelWaba(["5491144175052", "5492144175052"], "44175052")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain("más de un número")
  })
})

describe("formatos distintos del mismo número", () => {
  it("ignora espacios, guiones y el signo +", () => {
    const r = elegirNumeroDelWaba([NUM_A, NUM_B], "+54 9 11 4417-5052")
    expect(r).toMatchObject({ ok: true, numero: NUM_A })
  })

  it("tolera que falte el prefijo internacional de un lado o del otro", () => {
    expect(elegirNumeroDelWaba([NUM_A, NUM_B], "91144175052")).toMatchObject({ ok: true, numero: NUM_A })
    expect(elegirNumeroDelWaba(["91144175052", NUM_B], NUM_A)).toMatchObject({ ok: true, numero: "91144175052" })
  })

  it("devuelve el número con el formato que usa Meta, no el de la config", () => {
    // Ese string se le manda de vuelta a la API: normalizarlo nosotros sería
    // inventar un formato que Meta podría no aceptar.
    const r = elegirNumeroDelWaba(["+54 9 11 4417-5052"], "5491144175052")
    expect(r).toMatchObject({ ok: true, numero: "+54 9 11 4417-5052" })
  })
})

describe("el WABA con un solo número", () => {
  it("no hay ambigüedad posible: se usa aunque la config esté vacía", () => {
    expect(elegirNumeroDelWaba([NUM_A], "")).toEqual({ ok: true, numero: NUM_A, unico: true })
    expect(elegirNumeroDelWaba([NUM_A], null)).toEqual({ ok: true, numero: NUM_A, unico: true })
  })

  it("marca `unico` para que el llamador sepa que no hace falta re-consultar", () => {
    const r = elegirNumeroDelWaba([NUM_A], NUM_A)
    expect(r).toMatchObject({ unico: true })
  })

  it("se queda con el de Meta aunque la config diga otra cosa", () => {
    // El campo de la config se carga a mano; la lista de Meta es la realidad.
    expect(elegirNumeroDelWaba([NUM_A], "5490000000000")).toMatchObject({ ok: true, numero: NUM_A })
  })
})

describe("respuestas rotas de Meta", () => {
  it("sin números no se inventa ninguno", () => {
    for (const entrada of [null, undefined, [], {}, "5491144175052", 42]) {
      const r = elegirNumeroDelWaba(entrada, NUM_A)
      expect(r.ok, JSON.stringify(entrada)).toBe(false)
    }
  })

  it("descarta entradas vacías o sin dígitos de la lista", () => {
    const r = elegirNumeroDelWaba(["", "  ", "sin-digitos", NUM_A], null)
    expect(r).toEqual({ ok: true, numero: NUM_A, unico: true })
  })
})
