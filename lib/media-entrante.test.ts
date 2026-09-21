/**
 * lib/media-entrante.test.ts
 *
 * Lo que estas funciones deciden: si el agente se entera de que un paciente le
 * mandó su orden médica, y con cuánta información.
 *
 * El bug que las motivó no era un error visible sino una ausencia: una imagen
 * caía en `default: { content: "" }` y seguía viaje vacía. Por eso el primer
 * grupo de tests es sobre no perder nada, y el último sobre no dejar nunca un
 * contenido vacío.
 */

import { describe, it, expect } from "vitest"
import {
  leerMediaDelWebhook,
  describirArchivoRecibido,
  textoSinMarcadorRecibido,
  anotarArchivosEnMotivo,
  esPrevisualizable,
  mensajeDerivacionPorArchivo,
  mensajeSinAtencionHumana,
  MOTIVO_ARCHIVO,
} from "./media-entrante"
import { anteponerPresentacion } from "./conversation-state/presentacion-inicial"

/** Timestamp del webhook: segundos, no milisegundos. */
const TS = "1758412800"

const IMAGEN = {
  type: "image",
  timestamp: TS,
  image: { id: "wamid.imagen123", mime_type: "image/jpeg", sha256: "abc" },
}

const PDF = {
  type: "document",
  timestamp: TS,
  document: {
    id: "wamid.doc456",
    mime_type: "application/pdf",
    filename: "orden médica.pdf",
    caption: "Acá va la orden",
  },
}

describe("leerMediaDelWebhook — no perder el media_id", () => {
  it("lee una imagen sin nombre", () => {
    const r = leerMediaDelWebhook(IMAGEN)!
    expect(r.media.mediaId).toBe("wamid.imagen123")
    expect(r.media.tipo).toBe("image")
    expect(r.media.mimeType).toBe("image/jpeg")
  })

  it("lee un documento y conserva el nombre que puso el paciente", () => {
    const r = leerMediaDelWebhook(PDF)!
    expect(r.media.nombreArchivo).toBe("orden médica.pdf")
    expect(r.caption).toBe("Acá va la orden")
  })

  it("lee un video, aunque no lo podamos previsualizar", () => {
    const r = leerMediaDelWebhook({
      type: "video",
      timestamp: TS,
      video: { id: "wamid.vid", mime_type: "video/mp4" },
    })!
    expect(r.media.tipo).toBe("video")
    expect(r.media.nombreArchivo).toMatch(/^video-.*\.mp4$/)
  })

  it("marca la retención de 7 días, la mitad que la de salida", () => {
    const r = leerMediaDelWebhook(IMAGEN)!
    const dias = (new Date(r.media.disponibleHasta).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThan(7.1)
    expect(r.media.direccion).toBe("entrante")
  })

  it("el audio no entra por acá: tiene su propio camino de transcripción", () => {
    // Si lo tomáramos, una nota de voz terminaría derivada a atención humana en
    // vez de transcribirse, que es un cambio de comportamiento que nadie pidió.
    expect(leerMediaDelWebhook({ type: "audio", audio: { id: "x", mime_type: "audio/ogg" } })).toBeNull()
  })

  it("un mensaje sin archivo devuelve null, que es el caso normal", () => {
    expect(leerMediaDelWebhook({ type: "text", text: { body: "hola" } })).toBeNull()
    expect(leerMediaDelWebhook({ type: "sticker", sticker: { id: "s" } })).toBeNull()
    expect(leerMediaDelWebhook(null)).toBeNull()
    expect(leerMediaDelWebhook({})).toBeNull()
  })

  it("un media sin id no sirve para nada: se descarta", () => {
    expect(leerMediaDelWebhook({ type: "image", image: { mime_type: "image/jpeg" } })).toBeNull()
  })
})

describe("nombres de archivo", () => {
  it("cinco fotos seguidas no se llaman todas igual", () => {
    const a = leerMediaDelWebhook({ ...IMAGEN, timestamp: "1758412800" })!
    const b = leerMediaDelWebhook({ ...IMAGEN, timestamp: "1758412807" })!
    expect(a.media.nombreArchivo).not.toBe(b.media.nombreArchivo)
  })

  it("le saca la ruta a un nombre que venga con directorios", () => {
    const r = leerMediaDelWebhook({
      type: "document",
      timestamp: TS,
      document: { id: "d", mime_type: "application/pdf", filename: "../../etc/passwd" },
    })!
    expect(r.media.nombreArchivo).toBe("passwd")
  })

  it("no rompe con un mime type desconocido", () => {
    const r = leerMediaDelWebhook({
      type: "document",
      timestamp: TS,
      document: { id: "d", mime_type: "application/vnd.oasis.opendocument.text" },
    })!
    expect(r.media.nombreArchivo).toBeTruthy()
    expect(r.media.mimeType).toBe("application/vnd.oasis.opendocument.text")
  })
})

describe("esPrevisualizable", () => {
  it("acepta los tres que sabemos verificar por contenido", () => {
    expect(esPrevisualizable("image/jpeg")).toBe(true)
    expect(esPrevisualizable("image/png")).toBe(true)
    expect(esPrevisualizable("application/pdf")).toBe(true)
  })

  it("ignora los parámetros del mime", () => {
    expect(esPrevisualizable("application/pdf; charset=binary")).toBe(true)
  })

  it("rechaza todo lo demás, que es lo que se ofrece para descargar", () => {
    for (const m of ["video/mp4", "image/svg+xml", "text/html", "application/msword", ""]) {
      expect(esPrevisualizable(m), m).toBe(false)
    }
  })

  it("un SVG no se previsualiza aunque sea 'una imagen'", () => {
    // Un SVG incrustado ejecuta script en el origen del panel, con la sesión
    // del agente. Lo elige el paciente: no hay razón para confiar en él.
    expect(esPrevisualizable("image/svg+xml")).toBe(false)
  })
})

describe("describirArchivoRecibido — el contenido nunca queda vacío", () => {
  it("una imagen sin texto igual dice algo", () => {
    const r = leerMediaDelWebhook(IMAGEN)!
    const texto = describirArchivoRecibido(r.media, r.caption)
    expect(texto).toContain("Imagen recibida")
    expect(texto.trim().length).toBeGreaterThan(0)
  })

  it("conserva el texto que escribió el paciente y le agrega el marcador", () => {
    const r = leerMediaDelWebhook(PDF)!
    const texto = describirArchivoRecibido(r.media, r.caption)
    expect(texto).toContain("Acá va la orden")
    expect(texto).toContain("[Archivo recibido: orden médica.pdf]")
  })

  it("el video se nombra como video", () => {
    const r = leerMediaDelWebhook({ type: "video", timestamp: TS, video: { id: "v", mime_type: "video/mp4" } })!
    expect(describirArchivoRecibido(r.media, "")).toContain("Video recibido")
  })

  it("el marcador se saca donde sí se dibuja el archivo", () => {
    const r = leerMediaDelWebhook(PDF)!
    const texto = describirArchivoRecibido(r.media, r.caption)
    expect(textoSinMarcadorRecibido(texto)).toBe("Acá va la orden")
  })

  it("sin caption, sacar el marcador deja vacío y el panel no muestra texto", () => {
    const r = leerMediaDelWebhook(IMAGEN)!
    expect(textoSinMarcadorRecibido(describirArchivoRecibido(r.media, ""))).toBe("")
  })
})

describe("los mensajes al paciente no se comen el saludo", () => {
  /**
   * El bug (21/9/2026, Instituto Santa Lucía Paraná): el aviso de derivación
   * decía "como soy un asistente virtual de inteligencia artificial y no puedo
   * abrirlo". `YA_SE_PRESENTA` es /asistente virtual|bienvenid/i, así que el
   * embudo daba por hecho que el mensaje ya se identificaba y lo dejaba intacto.
   * En el primer mensaje del día el paciente no recibía ningún saludo.
   *
   * Se prueba contra `anteponerPresentacion` de verdad, no contra una copia de
   * la regex: si mañana cambia el criterio del embudo, estos tests lo siguen.
   */
  const PACIENTE = { nombre: "Nicolás", clinica: "Instituto Santa Lucía Paraná" }

  it("el aviso de derivación recibe el saludo completo", () => {
    const texto = anteponerPresentacion(mensajeDerivacionPorArchivo(), PACIENTE)
    expect(texto).toContain("*¡Hola, Nicolás!*")
    expect(texto).toContain("asistente virtual de inteligencia artificial")
    expect(texto).toContain("Recibí tu archivo")
  })

  it("el aviso de 'no recibimos archivos' también", () => {
    const texto = anteponerPresentacion(mensajeSinAtencionHumana("Instituto Santa Lucía Paraná"), PACIENTE)
    expect(texto).toContain("*¡Hola, Nicolás!*")
    expect(texto).toContain("asistente virtual de inteligencia artificial")
  })

  it("ninguno se identifica por su cuenta: esa es justamente la trampa", () => {
    for (const texto of [mensajeDerivacionPorArchivo(), mensajeSinAtencionHumana("X")]) {
      expect(texto.toLowerCase()).not.toContain("asistente virtual")
      expect(texto.toLowerCase()).not.toContain("bienvenid")
    }
  })

  it("el aviso fuera de horario se agrega al final, sin romper el saludo", () => {
    const texto = anteponerPresentacion(
      mensajeDerivacionPorArchivo("lunes a viernes de 9:00 a 18:00"),
      PACIENTE,
    )
    expect(texto).toContain("*¡Hola, Nicolás!*")
    expect(texto).toContain("fuera del horario de atención (lunes a viernes de 9:00 a 18:00)")
  })

  it("en horario no menciona horarios", () => {
    expect(mensajeDerivacionPorArchivo()).not.toContain("horario")
  })

  it("sin horarios configurados no deja un paréntesis vacío", () => {
    expect(mensajeDerivacionPorArchivo("")).not.toContain("()")
  })

  it("sin nombre de clínica no deja un hueco", () => {
    expect(mensajeSinAtencionHumana(null)).toContain("la clínica")
    expect(mensajeSinAtencionHumana(null)).not.toContain("con .")
  })
})

describe("anotarArchivosEnMotivo — el agente ve cuántos lo esperan", () => {
  it("al crear la sesión por un archivo, arranca en uno", () => {
    expect(anotarArchivosEnMotivo(MOTIVO_ARCHIVO)).toBe("Envío de archivo (1 archivo)")
  })

  it("suma a un motivo que el paciente ya había elegido", () => {
    expect(anotarArchivosEnMotivo("Solicitud o consulta sobre estudios")).toBe(
      "Solicitud o consulta sobre estudios (1 archivo)",
    )
  })

  it("cuenta en vez de repetir la frase", () => {
    // El caso real: fotografiar una orden médica son cuatro o cinco fotos.
    let motivo = anotarArchivosEnMotivo(MOTIVO_ARCHIVO)
    for (let i = 0; i < 4; i++) motivo = anotarArchivosEnMotivo(motivo)
    expect(motivo).toBe("Envío de archivo (5 archivos)")
    expect(motivo.match(/archivo/g)?.length).toBe(2) // "Envío de archivo" + "(5 archivos)"
  })

  it("usa el plural recién a partir de dos", () => {
    expect(anotarArchivosEnMotivo("Recetas")).toContain("(1 archivo)")
    expect(anotarArchivosEnMotivo("Recetas (1 archivo)")).toContain("(2 archivos)")
  })

  it("un motivo vacío no deja un paréntesis colgado", () => {
    expect(anotarArchivosEnMotivo("")).toBe("Envío de archivo (1 archivo)")
    expect(anotarArchivosEnMotivo("   ")).toBe("Envío de archivo (1 archivo)")
  })

  it("no confunde un paréntesis que ya traía el motivo", () => {
    expect(anotarArchivosEnMotivo("Consulta urgente (guardia oftalmológica)")).toBe(
      "Consulta urgente (guardia oftalmológica) (1 archivo)",
    )
  })
})
