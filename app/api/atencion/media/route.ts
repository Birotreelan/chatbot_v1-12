/**
 * Los archivos del chat de atención (5/11/2026).
 *
 *   GET  /api/atencion/media?id=web_…   → el archivo
 *   POST /api/atencion/media            → el paciente sube uno (multipart)
 *
 * ── El GET no pide token, y conviene decir por qué ─────────────────────────
 *
 * Porque el id es la credencial: `web_` + 21 caracteres aleatorios, que no se
 * adivina. Es el mismo criterio con el que el panel sirve los media de
 * WhatsApp por su `mediaId`.
 *
 * La alternativa —exigir el token del chat— rompería el otro lado: el panel de
 * la clínica también tiene que poder mostrar estos archivos, y ahí no hay
 * token del paciente. Pedir dos credenciales distintas según quién mira
 * obligaría a dos rutas y a que `AdjuntoDelMensaje` sepa de cuál es cada
 * adjunto, que es exactamente lo que se quiso evitar.
 *
 * ── Se valida el contenido, no lo que declara el navegador ────────────────
 *
 * El `Content-Type` de un formulario lo pone el navegador a partir de la
 * extensión. Para las imágenes y el PDF se mira la firma de los primeros
 * bytes, con el mismo `detectarTipoReal` que usa el panel. Para el audio no:
 * webm/ogg/mp4 tienen firmas que varían con el codec, y el audio no se
 * reenvía a nadie —se sirve desde acá con su mime, así que un archivo
 * mentiroso no se ejecuta en ningún lado—.
 */

import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { leerEnlaceDeAtencion } from "@/lib/atencion/token"
import {
  guardarMediaDelChat,
  leerMediaDelChat,
  validarSubidaDelChat,
  LIMITE_ARCHIVO,
} from "@/lib/atencion/media"
import { detectarTipoReal } from "@/lib/media-validacion"
import {
  agregarMensaje,
  marcarPresente,
  type MensajeDeAtencion,
} from "@/lib/atencion/conversacion"
import { registrarMensajeDelPaciente } from "@/lib/atencion/entrada"
import { cabeceraContentDisposition } from "@/lib/whatsapp-media"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || ""
    const descargar = new URL(request.url).searchParams.get("descargar") === "1"

    const leido = await leerMediaDelChat(id)
    if (!leido) {
      return NextResponse.json({ error: "El archivo no existe" }, { status: 404 })
    }

    return new NextResponse(new Uint8Array(leido.contenido), {
      headers: {
        "Content-Type": leido.media.mimeType,
        "Content-Length": String(leido.contenido.length),
        "Content-Disposition": cabeceraContentDisposition(
          leido.media.nombreArchivo,
          descargar ? "attachment" : "inline",
        ),
        // Privado: es contenido clínico. Y cacheable un rato, porque la misma
        // imagen se pide cada vez que el chat se vuelve a dibujar.
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("[ATENCION_MEDIA] Error sirviendo el archivo:", error)
    return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: "Falta el archivo" }, { status: 400 })
    }

    const token = String(form.get("token") || "")
    const enlace = await leerEnlaceDeAtencion(token)
    if (!enlace) {
      return NextResponse.json({ error: "El enlace no es válido o venció" }, { status: 401 })
    }

    const archivo = form.get("archivo")
    if (!(archivo instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo" }, { status: 400 })
    }
    if (archivo.size > LIMITE_ARCHIVO) {
      return NextResponse.json(
        { error: `El archivo es muy grande. El máximo es ${(LIMITE_ARCHIVO / 1024 / 1024).toFixed(0)} MB.` },
        { status: 400 },
      )
    }

    const validacion = validarSubidaDelChat({ mimeType: archivo.type, bytes: archivo.size })
    if (!validacion.valido) {
      return NextResponse.json({ error: validacion.motivo }, { status: 400 })
    }

    const contenido = Buffer.from(await archivo.arrayBuffer())

    // Para imágenes y PDF se mira la firma: el mime que declara el navegador
    // sale de la extensión y cualquiera puede renombrar un archivo. El audio
    // queda afuera de este control a propósito — ver la nota de arriba.
    if (validacion.tipo !== "audio") {
      const real = detectarTipoReal(new Uint8Array(contenido))
      if (real !== validacion.mimeType) {
        console.warn(
          `[ATENCION_MEDIA] ${enlace.telefono}: declara ${validacion.mimeType} y el contenido es ${real ?? "desconocido"}`,
        )
        return NextResponse.json(
          { error: "El archivo no parece ser una foto JPG/PNG ni un PDF." },
          { status: 400 },
        )
      }
    }

    const guardado = await guardarMediaDelChat({
      contenido,
      mimeType: validacion.mimeType,
      tipo: validacion.tipo,
      extension: validacion.extension,
      nombreArchivo: archivo.name,
    })
    if (!guardado) {
      return NextResponse.json({ error: "No se pudo guardar el archivo" }, { status: 500 })
    }

    const mensaje: MensajeDeAtencion = {
      id: nanoid(),
      rol: "paciente",
      // El texto que lo acompaña, si el paciente escribió algo antes de
      // adjuntar. WhatsApp le llama caption.
      texto: String(form.get("texto") || "").trim().slice(0, 1024),
      enviadoEl: new Date().toISOString(),
      via: "chat",
      media: guardado.media,
    }

    await agregarMensaje(enlace.clienteId, enlace.telefono, mensaje)
    await marcarPresente(enlace.clienteId, enlace.telefono)
    await registrarMensajeDelPaciente({
      configId: enlace.configId,
      clienteId: enlace.clienteId,
      telefono: enlace.telefono,
      mensaje,
    })

    console.log(
      `[ATENCION_MEDIA] ${enlace.telefono} subió ${guardado.media.nombreArchivo} ` +
        `(${guardado.media.mimeType}, ${guardado.media.tamanoBytes} bytes)`,
    )

    return NextResponse.json({
      exito: true,
      mensaje: {
        id: mensaje.id,
        rol: mensaje.rol,
        texto: mensaje.texto,
        enviadoEl: mensaje.enviadoEl,
        via: mensaje.via,
        media: {
          tipo: guardado.media.tipo,
          mimeType: guardado.media.mimeType,
          nombreArchivo: guardado.media.nombreArchivo,
          tamanoBytes: guardado.media.tamanoBytes,
          url: `/api/atencion/media?id=${encodeURIComponent(guardado.media.mediaId)}`,
        },
      },
    })
  } catch (error) {
    console.error("[ATENCION_MEDIA] Error subiendo el archivo:", error)
    return NextResponse.json({ error: "No se pudo subir el archivo" }, { status: 500 })
  }
}
