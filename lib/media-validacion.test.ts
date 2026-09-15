/**
 * lib/media-validacion.test.ts
 *
 * `validarArchivo` es la primera barrera entre lo que el agente elige en su
 * computadora y lo que le llega al paciente por WhatsApp. Dos formas de
 * equivocarse, y las dos importan:
 *
 *  - Dejar pasar algo que no debería (un ejecutable renombrado, un archivo
 *    enorme que va a fallar recién en Vercel con un error incomprensible).
 *  - Rechazar algo legítimo — un PDF de una orden médica — y que el agente
 *    no pueda hacer su trabajo.
 *
 * Por eso hay tests de los dos lados.
 *
 * Estas mismas funciones corren en el navegador y en el servidor. Los tests
 * cubren las dos, porque son la misma.
 */

import { describe, it, expect } from "vitest"
import {
  validarArchivo,
  detectarTipoReal,
  formatearTamano,
  LIMITE_SUBIDA_PANEL,
} from "./media-validacion"
import { interpretarErrorDeWhatsApp, interpretarErrorCrudo } from "./whatsapp-media"

const MB = 1024 * 1024

describe("validarArchivo — lo que tiene que pasar", () => {
  it("acepta un JPG normal", () => {
    const r = validarArchivo({ mimeType: "image/jpeg", bytes: 800 * 1024, nombreArchivo: "orden.jpg" })
    expect(r.valido).toBe(true)
    if (r.valido) {
      expect(r.tipo).toBe("image")
      expect(r.nombreArchivo).toBe("orden.jpg")
    }
  })

  it("acepta un PNG", () => {
    const r = validarArchivo({ mimeType: "image/png", bytes: 2 * MB, nombreArchivo: "estudio.png" })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.tipo).toBe("image")
  })

  it("acepta un PDF y lo marca como documento", () => {
    const r = validarArchivo({ mimeType: "application/pdf", bytes: 1.2 * MB, nombreArchivo: "indicaciones.pdf" })
    expect(r.valido).toBe(true)
    if (r.valido) {
      expect(r.tipo).toBe("document")
      expect(r.nombreArchivo).toBe("indicaciones.pdf")
    }
  })

  it("acepta image/jpg, que no es un mime formal pero lo mandan varios navegadores", () => {
    const r = validarArchivo({ mimeType: "image/jpg", bytes: 100 * 1024, nombreArchivo: "foto.jpg" })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.mimeType).toBe("image/jpeg")
  })

  it("ignora los parámetros del mime type", () => {
    const r = validarArchivo({ mimeType: "application/pdf; charset=binary", bytes: 50 * 1024 })
    expect(r.valido).toBe(true)
  })

  it("acepta justo el límite", () => {
    const r = validarArchivo({ mimeType: "application/pdf", bytes: LIMITE_SUBIDA_PANEL, nombreArchivo: "a.pdf" })
    expect(r.valido).toBe(true)
  })
})

describe("validarArchivo — lo que tiene que frenar", () => {
  it("rechaza un tipo no permitido", () => {
    const r = validarArchivo({ mimeType: "application/msword", bytes: 50 * 1024, nombreArchivo: "nota.doc" })
    expect(r.valido).toBe(false)
  })

  it("rechaza un ejecutable aunque tenga nombre inocente", () => {
    const r = validarArchivo({
      mimeType: "application/x-msdownload",
      bytes: 20 * 1024,
      nombreArchivo: "orden.pdf",
    })
    expect(r.valido).toBe(false)
  })

  it("rechaza un archivo vacío", () => {
    const r = validarArchivo({ mimeType: "image/png", bytes: 0, nombreArchivo: "vacio.png" })
    expect(r.valido).toBe(false)
  })

  it("rechaza un archivo más grande que el límite y dice cuánto pesa", () => {
    const r = validarArchivo({ mimeType: "application/pdf", bytes: 9 * MB, nombreArchivo: "estudio.pdf" })
    expect(r.valido).toBe(false)
    if (!r.valido) {
      expect(r.motivo).toContain("9,0 MB")
      expect(r.motivo).toContain("4,0 MB")
    }
  })

  it("rechaza una imagen por encima del tope, aunque el tope de imágenes de WhatsApp sea 5 MB", () => {
    // El límite efectivo es el menor de los dos: 4 MB, por el body de Vercel.
    const r = validarArchivo({ mimeType: "image/jpeg", bytes: 4.5 * MB, nombreArchivo: "foto.jpg" })
    expect(r.valido).toBe(false)
  })

  it("rechaza un mime vacío", () => {
    const r = validarArchivo({ mimeType: "", bytes: 1000, nombreArchivo: "x" })
    expect(r.valido).toBe(false)
  })
})

describe("validarArchivo — saneamiento del nombre", () => {
  it("descarta la ruta y se queda con el nombre", () => {
    const r = validarArchivo({
      mimeType: "application/pdf",
      bytes: 1000,
      nombreArchivo: "../../etc/passwd.pdf",
    })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.nombreArchivo).toBe("passwd.pdf")
  })

  it("corrige la extensión cuando no coincide con el tipo real", () => {
    // Mandar un PDF llamado .jpg es la causa habitual del error 131053.
    const r = validarArchivo({ mimeType: "application/pdf", bytes: 1000, nombreArchivo: "orden.jpg" })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.nombreArchivo).toBe("orden.jpg.pdf")
  })

  it("acepta .jpeg como extensión válida de un JPG", () => {
    const r = validarArchivo({ mimeType: "image/jpeg", bytes: 1000, nombreArchivo: "foto.jpeg" })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.nombreArchivo).toBe("foto.jpeg")
  })

  it("pone un nombre por defecto si no vino ninguno", () => {
    const r = validarArchivo({ mimeType: "image/png", bytes: 1000 })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.nombreArchivo).toBe("archivo.png")
  })

  it("saca comillas y caracteres de control que romperían el multipart", () => {
    const r = validarArchivo({ mimeType: "image/png", bytes: 1000, nombreArchivo: 'fo"to\n.png' })
    expect(r.valido).toBe(true)
    if (r.valido) expect(r.nombreArchivo).not.toContain('"')
  })
})

describe("detectarTipoReal — mira el contenido, no la extensión", () => {
  function conFirma(bytes: number[]): Buffer {
    return Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)])
  }

  it("reconoce un JPEG", () => {
    expect(detectarTipoReal(conFirma([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  })

  it("reconoce un PNG", () => {
    expect(detectarTipoReal(conFirma([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png")
  })

  it("reconoce un PDF", () => {
    expect(detectarTipoReal(Buffer.from("%PDF-1.7\n resto del archivo"))).toBe("application/pdf")
  })

  it("no reconoce un ejecutable de Windows aunque se llame orden.pdf", () => {
    // MZ — cabecera de un .exe. El navegador diría "application/pdf" por la
    // extensión; el contenido dice otra cosa.
    expect(detectarTipoReal(conFirma([0x4d, 0x5a, 0x90, 0x00]))).toBeNull()
  })

  it("no reconoce un ZIP (que es lo que hay dentro de un .docx)", () => {
    expect(detectarTipoReal(conFirma([0x50, 0x4b, 0x03, 0x04]))).toBeNull()
  })

  it("no reconoce un archivo demasiado corto para tener firma", () => {
    expect(detectarTipoReal(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe("interpretarErrorDeWhatsApp", () => {
  it("explica la ventana de 24 horas en lugar de mostrar el JSON de Meta", () => {
    const r = interpretarErrorDeWhatsApp({ error: { code: 131047, message: "Re-engagement message" } })
    expect(r.codigo).toBe(131047)
    expect(r.mensaje).toContain("24 horas")
    expect(r.mensaje).not.toContain("Re-engagement")
  })

  it("distingue el error de tamaño", () => {
    const r = interpretarErrorDeWhatsApp({ error: { code: 131052 } })
    expect(r.mensaje).toContain("tamaño")
  })

  it("distingue el error de formato", () => {
    const r = interpretarErrorDeWhatsApp({ error: { code: 131053 } })
    expect(r.mensaje).toContain("formato")
  })

  it("avisa cuando el token venció, que se arregla de otra manera", () => {
    const r = interpretarErrorDeWhatsApp({ error: { code: 190 } })
    expect(r.mensaje).toContain("credenciales")
  })

  it("con un código desconocido usa el mensaje de Meta sin inventar nada", () => {
    const r = interpretarErrorDeWhatsApp({ error: { code: 999, message: "Algo raro" } })
    expect(r.mensaje).toContain("Algo raro")
  })

  it("no explota si el error no tiene la forma esperada", () => {
    expect(() => interpretarErrorDeWhatsApp(null)).not.toThrow()
    expect(interpretarErrorDeWhatsApp(null).mensaje.length).toBeGreaterThan(0)
  })
})

describe("interpretarErrorCrudo — errores que vienen envueltos en un Error", () => {
  it("desenvuelve el JSON que mete lib/whatsapp-api.ts en el mensaje", () => {
    const error = new Error(
      'WhatsApp API error: {"error":{"code":131047,"message":"Re-engagement message"}}',
    )
    const r = interpretarErrorCrudo(error)
    expect(r.codigo).toBe(131047)
    expect(r.mensaje).toContain("24 horas")
  })

  it("si no hay JSON adentro, devuelve el texto tal cual", () => {
    expect(interpretarErrorCrudo(new Error("fetch failed")).mensaje).toBe("fetch failed")
  })

  it("no explota con null ni con un JSON roto", () => {
    expect(interpretarErrorCrudo(null).mensaje.length).toBeGreaterThan(0)
    expect(interpretarErrorCrudo(new Error("error: {esto no es json")).mensaje.length).toBeGreaterThan(0)
  })
})

describe("formatearTamano", () => {
  it("usa coma decimal, como se escribe en español", () => {
    expect(formatearTamano(1.5 * MB)).toBe("1,5 MB")
  })

  it("usa KB para archivos chicos", () => {
    expect(formatearTamano(200 * 1024)).toBe("200 KB")
  })
})
