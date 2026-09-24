/**
 * lib/widget-domain-validation.test.ts
 *
 * Quién puede usar el widget de cada clínica.
 *
 * Esta función decide si el widget se ve o no se ve. Un falso negativo acá es
 * una clínica cuyo widget desapareció sin que nadie sepa por qué, y un falso
 * positivo es el widget de una clínica funcionando en el sitio de otro. Los dos
 * son silenciosos: nadie recibe un error, simplemente pasa o no pasa.
 *
 * Los casos de "se cierra por defecto" son los que cambiaron el 24/9/2026 y los
 * que hay que cuidar de que nadie afloje sin querer.
 */

import { describe, it, expect } from "vitest"
import { isWidgetOriginAllowed, normalizarDominio } from "./widget-domain-validation"

const NUESTRO = "https://treelan-bot.vercel.app/api/widget?cliente_id=x"

function pedido(desde: string | null, via: "origin" | "referer" = "origin"): Request {
  const headers = new Headers()
  if (desde) headers.set(via, desde)
  return new Request(NUESTRO, { headers })
}

describe("con dominios cargados", () => {
  const config = { widgetAllowedDomains: "clinica.com, otra.com.ar" }

  it("deja pasar al dominio declarado", () => {
    expect(isWidgetOriginAllowed(config, pedido("https://clinica.com"))).toBe(true)
  })

  it("deja pasar al www sin que haya que listarlo", () => {
    expect(isWidgetOriginAllowed(config, pedido("https://www.clinica.com"))).toBe(true)
  })

  it("deja pasar a los subdominios", () => {
    // Quien carga "clinica.com" no debería tener que acordarse de
    // "turnos.clinica.com" ni de cada subdominio que agregue después.
    expect(isWidgetOriginAllowed(config, pedido("https://turnos.clinica.com"))).toBe(true)
  })

  it("rechaza a un tercero", () => {
    expect(isWidgetOriginAllowed(config, pedido("https://sitio-ajeno.com"))).toBe(false)
  })

  it("no confunde un dominio que sólo TERMINA parecido", () => {
    // "noesclinica.com" termina con "clinica.com" si se compara con endsWith
    // a secas. El punto del separador es lo que evita ese falso positivo.
    expect(isWidgetOriginAllowed(config, pedido("https://noesclinica.com"))).toBe(false)
  })

  it("sirve el Referer cuando no hay Origin", () => {
    expect(isWidgetOriginAllowed(config, pedido("https://clinica.com/turnos", "referer"))).toBe(true)
  })
})

describe("se cierra por defecto (24/9/2026)", () => {
  it("sin dominios cargados no se puede desde ningún sitio", () => {
    // Antes esto devolvía true: un cliente sin el campo cargado tenía el
    // widget funcionando en cualquier página de internet.
    for (const vacio of [undefined, "", "   ", ","]) {
      expect(
        isWidgetOriginAllowed({ widgetAllowedDomains: vacio }, pedido("https://clinica.com")),
        JSON.stringify(vacio),
      ).toBe(false)
    }
  })

  it("sin Origin ni Referer se rechaza", () => {
    // Antes esto devolvía true, así que para saltear el chequeo alcanzaba con
    // no mandar Referer.
    expect(isWidgetOriginAllowed({ widgetAllowedDomains: "clinica.com" }, pedido(null))).toBe(false)
  })

  it("un Origin que no es una URL se rechaza", () => {
    expect(isWidgetOriginAllowed({ widgetAllowedDomains: "clinica.com" }, pedido("null"))).toBe(false)
  })
})

describe("nuestro propio dominio", () => {
  it("se permite, para poder probar desde /demo y el dashboard", () => {
    expect(
      isWidgetOriginAllowed({ widgetAllowedDomains: "clinica.com" }, pedido("https://treelan-bot.vercel.app")),
    ).toBe(true)
  })

  it("se permite incluso sin dominios cargados", () => {
    // Si no, un cliente recién creado no podría ni ver su propio widget desde
    // el dashboard, y no habría forma de darse cuenta de qué falta completar.
    expect(
      isWidgetOriginAllowed({ widgetAllowedDomains: "" }, pedido("https://treelan-bot.vercel.app")),
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cómo escribe el dominio una persona (24/9/2026)
//
// Caso real: se cargó el dominio correcto y el widget devolvía 403. Estaba
// escrito como URL completa —copiada de la barra del navegador— y se comparaba
// ese texto entero contra el hostname del Origin. El campo decía lo correcto y
// no matcheaba nada.
//
// Mientras el chequeo tenía escapes esto era inofensivo: un dominio mal escrito
// no matcheaba, pero el widget andaba igual. Al cerrarlos, pasó a ser la
// diferencia entre funcionar y un 403.
// ─────────────────────────────────────────────────────────────────────────────

describe("el dominio se acepta como lo escriba la persona", () => {
  it("todas estas formas son el mismo dominio", () => {
    for (const escrito of [
      "clinica.com",
      "https://clinica.com",
      "http://clinica.com",
      "https://clinica.com/",
      "https://www.clinica.com/turnos?x=1",
      "  HTTPS://Clinica.COM  ",
      "www.clinica.com",
      "clinica.com:443",
      "//clinica.com",
      "clinica.com.",
    ]) {
      expect(normalizarDominio(escrito), escrito).toBe("clinica.com")
    }
  })

  it("y todas dejan entrar al sitio", () => {
    for (const escrito of ["clinica.com", "https://clinica.com/", " https://www.clinica.com/turnos "]) {
      expect(
        isWidgetOriginAllowed({ widgetAllowedDomains: escrito }, pedido("https://clinica.com")),
        escrito,
      ).toBe(true)
    }
  })

  it("ser generoso al leer no afloja el chequeo", () => {
    const config = { widgetAllowedDomains: "https://clinica.com/" }
    expect(isWidgetOriginAllowed(config, pedido("https://sitio-ajeno.com"))).toBe(false)
    expect(isWidgetOriginAllowed(config, pedido("https://noesclinica.com"))).toBe(false)
    expect(isWidgetOriginAllowed(config, pedido(null))).toBe(false)
  })
})
