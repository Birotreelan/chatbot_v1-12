/**
 * lib/api-tools/cache-conmutador.test.ts
 *
 * El interruptor del caché de datos del origen.
 *
 * Lo que importa es el sentido del default: sin la variable, NO se cachea. El
 * error de tenerlo apagado de más es visible y barato —más llamadas al proxy—;
 * el inverso es invisible y hace perder horas persiguiendo respuestas viejas
 * creyendo que son bugs.
 */

import { describe, it, expect, afterEach } from "vitest"
import { cacheDeOrigenHabilitado } from "./cache-conmutador"

const original = process.env.CACHE_ORIGEN_HABILITADO

afterEach(() => {
  if (original === undefined) delete process.env.CACHE_ORIGEN_HABILITADO
  else process.env.CACHE_ORIGEN_HABILITADO = original
})

describe("el default es sin caché", () => {
  it("sin la variable, no se cachea", () => {
    delete process.env.CACHE_ORIGEN_HABILITADO
    expect(cacheDeOrigenHabilitado()).toBe(false)
  })

  it("nada ambiguo lo enciende por accidente", () => {
    // "si", "yes" y "on" suenan a que encienden y no encienden. Es deliberado:
    // sólo un "true" o un "1" explícitos prenden el caché, así que nadie lo
    // enciende sin querer con un valor aproximado.
    for (const valor of ["", "  ", "false", "0", "no", "off", "si", "yes", "TRUE_"]) {
      process.env.CACHE_ORIGEN_HABILITADO = valor
      expect(cacheDeOrigenHabilitado(), JSON.stringify(valor)).toBe(false)
    }
  })
})

describe("encenderlo", () => {
  it("acepta true y 1, sin importar mayúsculas ni espacios", () => {
    for (const valor of ["true", "TRUE", " True ", "1"]) {
      process.env.CACHE_ORIGEN_HABILITADO = valor
      expect(cacheDeOrigenHabilitado(), JSON.stringify(valor)).toBe(true)
    }
  })

  it("se lee en cada llamada, no una vez al cargar el módulo", () => {
    // En Vercel los workers viven un rato largo. Si se leyera al arranque,
    // cambiar la variable en el panel no tendría efecto hasta el próximo
    // despliegue — y uno se pasaría media hora sin entender por qué.
    process.env.CACHE_ORIGEN_HABILITADO = "true"
    expect(cacheDeOrigenHabilitado()).toBe(true)
    process.env.CACHE_ORIGEN_HABILITADO = "false"
    expect(cacheDeOrigenHabilitado()).toBe(false)
  })
})
