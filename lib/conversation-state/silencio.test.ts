/**
 * lib/conversation-state/silencio.test.ts
 *
 * Callar tiene una asimetría incómoda: responder de más se nota en la factura,
 * pero callar de más no se nota en ningún lado. No hay excepción, no hay log de
 * error, y en el panel una conversación donde el bot se calló se ve igual que
 * una donde el paciente no volvió a escribir.
 *
 * Por eso lo que se prueba acá no es tanto que calle cuando corresponde, sino
 * que NO calle cuando no corresponde.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { usaSilencio, yaSeDijo, registrarSilencio } from "./silencio"

describe("a quién le aplica", () => {
  it("sólo a los clientes del portal", () => {
    // En el resto el chat es el único camino: el silencio se lee como "el
    // número no funciona". En los del portal el paciente tiene el enlace y los
    // botones a la vista.
    expect(usaSilencio({ clientePortalWeb: true })).toBe(true)
  })

  it("ante la duda, se responde", () => {
    for (const config of [null, undefined, {}, { clientePortalWeb: false }]) {
      expect(usaSilencio(config), JSON.stringify(config)).toBe(false)
    }
  })
})

describe("sin Redis no se calla", () => {
  it("yaSeDijo devuelve false cuando no hay dónde leer el estado", async () => {
    // El error inofensivo es un mensaje de más. Callar por no poder leer el
    // estado sería callar por accidente, que es justo lo que no queremos.
    expect(await yaSeDijo("cfg", "5491100000000", "derivacion")).toBe(false)
  })
})

describe("el registro de lo que se calló", () => {
  let log: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    log.mockRestore()
  })

  it("deja el teléfono, el motivo y qué se iba a decir", () => {
    // Sin esto, el día que una clasificación falle nos enteramos por un
    // reclamo y no por un log.
    registrarSilencio({
      configId: "cfg",
      phoneNumber: "5491100000000",
      motivo: "cierre_conversacional",
      texto: "¡Gracias por escribirnos! Si necesitás algo más, estoy acá.",
    })

    const linea = String(log.mock.calls[0]?.[0] || "")
    expect(linea).toContain("5491100000000")
    expect(linea).toContain("cierre_conversacional")
    expect(linea).toContain("Gracias por escribirnos")
  })

  it("recorta el texto: es un log, no un archivo de mensajes", () => {
    registrarSilencio({
      configId: "cfg",
      phoneNumber: "549110",
      motivo: "ya_se_dijo",
      texto: "x".repeat(500),
    })
    expect(String(log.mock.calls[0]?.[0] || "").length).toBeLessThan(300)
  })

  it("aguanta un silencio sin texto", () => {
    expect(() =>
      registrarSilencio({ configId: "cfg", phoneNumber: "549110", motivo: "ya_se_dijo" }),
    ).not.toThrow()
  })
})
