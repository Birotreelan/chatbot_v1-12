/**
 * Envío y visualización de archivos desde el panel de atención (15/9/2026).
 *
 * POST — el agente adjunta una imagen o un PDF y se lo manda al paciente.
 * GET  — el panel muestra un archivo de la conversación, pidiéndoselo a WhatsApp.
 *
 * ── Sobre no guardar nada ──────────────────────────────────────────────────
 *
 * Ni el archivo que envía el agente ni el que manda el paciente se guardan de
 * nuestro lado. Guardamos la referencia (media_id) y le pedimos el contenido a
 * WhatsApp cada vez que hay que mostrarlo. Son documentos clínicos: mantenerlos
 * fuera de nuestra infraestructura es lo que se decidió.
 *
 * La contrapartida es que caducan. WhatsApp conserva 30 días lo que subimos
 * nosotros y 7 días lo que manda el paciente. Pasado ese plazo el archivo
 * desaparece del historial del panel, y por eso la interfaz lo avisa al
 * adjuntar, no después.
 *
 * ── Sobre el tamaño ────────────────────────────────────────────────────────
 *
 * El tope efectivo no lo pone WhatsApp (que aceptaría PDFs de 100 MB) sino
 * Vercel, que corta el body de una función serverless en ~4,5 MB. Ver
 * LIMITE_SUBIDA_PANEL en lib/whatsapp-media.ts.
 */

import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getSupportSession, saveSupportMessage } from "@/lib/human-support"
import { getConversationMessages, saveConversationMessage } from "@/lib/conversations"
import { getWhatsAppConfigById } from "@/lib/db"
import { estadoVentana } from "@/lib/ventana-atencion"
import {
  validarArchivo,
  detectarTipoReal,
  uploadWhatsAppMedia,
  sendWhatsAppMedia,
  descargarMediaParaPanel,
  cabeceraContentDisposition,
  formatearTamano,
  ErrorDeWhatsApp,
  DIAS_RETENCION_WHATSAPP,
  DIAS_RETENCION_ENTRANTE,
  LIMITE_DESCARGA_PANEL,
} from "@/lib/whatsapp-media"
import type { HumanSupportMessage, MediaAdjunta } from "@/lib/types"
import { nanoid } from "nanoid"

export const runtime = "nodejs"

/** Cuántos mensajes del historial miramos para validar que un media_id sea de esta conversación. */
const MENSAJES_A_REVISAR = 100

// ─── POST: el agente envía un archivo ────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const userSession = await getSessionFromRequest(request)
    if (!userSession) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }
    if (userSession.role !== "support_agent") {
      return NextResponse.json({ success: false, error: "Se requiere rol de agente de soporte" }, { status: 403 })
    }

    const formData = await request.formData()
    const sessionId = String(formData.get("sessionId") || "")
    const caption = String(formData.get("caption") || "").trim()
    const archivo = formData.get("file")

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'sessionId'" }, { status: 400 })
    }
    if (!(archivo instanceof File)) {
      return NextResponse.json({ success: false, error: "No se recibió ningún archivo" }, { status: 400 })
    }

    // ── Permisos sobre la sesión: los mismos que para mandar un mensaje ──────
    const supportSession = await getSupportSession(sessionId)
    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }
    if (supportSession.tenantId !== userSession.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }
    if (supportSession.assignedTo !== userSession.userId) {
      return NextResponse.json({ success: false, error: "No estás asignado a esta sesión" }, { status: 403 })
    }
    if (supportSession.status !== "in_progress") {
      return NextResponse.json({ success: false, error: "La sesión no está activa" }, { status: 400 })
    }

    // ── Validación declarada: tipo y tamaño ─────────────────────────────────
    const declarado = validarArchivo({
      mimeType: archivo.type,
      bytes: archivo.size,
      nombreArchivo: archivo.name,
    })
    if (!declarado.valido) {
      return NextResponse.json({ success: false, error: declarado.motivo }, { status: 400 })
    }

    const buffer = Buffer.from(await archivo.arrayBuffer())

    // ── Validación real: qué dice el contenido ──────────────────────────────
    // El tipo declarado viene del navegador y sale de la extensión del archivo.
    // Como lo que subamos se le reenvía al paciente, la declaración no alcanza.
    const tipoReal = detectarTipoReal(buffer)
    if (!tipoReal) {
      return NextResponse.json(
        {
          success: false,
          error: "El contenido del archivo no corresponde a una imagen JPG, PNG ni a un PDF.",
        },
        { status: 400 },
      )
    }
    if (tipoReal !== declarado.mimeType) {
      return NextResponse.json(
        {
          success: false,
          error: `El archivo dice ser ${declarado.etiqueta} pero su contenido es otro (${tipoReal}). Revisá que no esté renombrado.`,
        },
        { status: 400 },
      )
    }

    const config = await getWhatsAppConfigById(supportSession.configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    // ── Envío ────────────────────────────────────────────────────────────────
    let mediaId: string
    try {
      mediaId = await uploadWhatsAppMedia(
        config.phoneNumberId,
        config.accessToken,
        buffer,
        declarado.mimeType,
        declarado.nombreArchivo,
      )

      await sendWhatsAppMedia(config.phoneNumberId, config.accessToken, supportSession.phoneNumber, {
        mediaId,
        tipo: declarado.tipo,
        caption,
        nombreArchivo: declarado.nombreArchivo,
      })
    } catch (error: any) {
      if (error instanceof ErrorDeWhatsApp) {
        // La ventana de 24 h cerrada no es una falla del sistema: es una regla de
        // WhatsApp. Se devuelve 409 y con el código, para que el panel pueda
        // explicarlo en vez de mostrar un error genérico.
        const esVentana = error.codigo === 131047
        return NextResponse.json(
          { success: false, error: error.message, codigo: error.codigo, ventanaCerrada: esVentana },
          { status: esVentana ? 409 : 502 },
        )
      }
      throw error
    }

    // ── Historial ────────────────────────────────────────────────────────────
    const media: MediaAdjunta = {
      mediaId,
      tipo: declarado.tipo,
      mimeType: declarado.mimeType,
      nombreArchivo: declarado.nombreArchivo,
      tamanoBytes: buffer.length,
      disponibleHasta: new Date(
        Date.now() + DIAS_RETENCION_WHATSAPP * 24 * 60 * 60 * 1000,
      ).toISOString(),
      direccion: "saliente",
    }

    // El contenido de texto describe el archivo: así el mensaje se lee igual en
    // el monitor del dashboard y en el resumen que se le inyecta a la IA al
    // cerrar la sesión, donde no hay forma de renderizar una imagen.
    const descripcion = caption
      ? `${caption}\n[Archivo enviado: ${declarado.nombreArchivo}]`
      : `[Archivo enviado: ${declarado.nombreArchivo}]`

    // Un solo id compartido entre los dos historiales: el panel deduplica por
    // id al combinarlos, y dos ids distintos duplicarían la burbuja.
    const mensajeId = nanoid()
    const timestamp = new Date().toISOString()

    const supportMessage: HumanSupportMessage = {
      id: mensajeId,
      sessionId,
      role: "agent",
      content: descripcion,
      timestamp,
      agentId: userSession.userId,
      media,
    }

    await saveSupportMessage(supportMessage)
    await saveConversationMessage({
      id: mensajeId,
      role: "assistant",
      content: descripcion,
      timestamp,
      phoneNumber: supportSession.phoneNumber,
      configId: supportSession.configId,
      messageType: "agent",
      media,
    })

    console.log(
      `[SUPPORT_MEDIA] ✅ ${declarado.etiqueta} (${formatearTamano(buffer.length)}) enviado a ${supportSession.phoneNumber}`,
    )

    return NextResponse.json({ success: true, media })
  } catch (error: any) {
    console.error("[SUPPORT_MEDIA] ❌ Error en POST:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

// ─── GET: el panel muestra un archivo, o consulta la ventana ────────────────

export async function GET(request: Request) {
  try {
    const userSession = await getSessionFromRequest(request)
    if (!userSession) {
      return NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("sessionId")
    const mediaId = searchParams.get("mediaId")

    if (!sessionId) {
      return NextResponse.json({ success: false, error: "Falta parámetro 'sessionId'" }, { status: 400 })
    }

    const supportSession = await getSupportSession(sessionId)
    if (!supportSession) {
      return NextResponse.json({ success: false, error: "Sesión no encontrada" }, { status: 404 })
    }
    if (supportSession.tenantId !== userSession.tenantId) {
      return NextResponse.json({ success: false, error: "No autorizado para esta sesión" }, { status: 403 })
    }

    // Sin mediaId, la ruta informa el estado de la ventana de 24 h.
    if (!mediaId) {
      const ventana = await estadoVentana(supportSession.configId, supportSession.phoneNumber)
      return NextResponse.json({ success: true, ventana })
    }

    // El media_id tiene que pertenecer a ESTA conversación. Sin esta
    // comprobación, un agente autenticado podría pedir cualquier archivo de
    // cualquier otro paciente con solo conocer su id.
    const media = await buscarMediaEnLaConversacion(
      supportSession.configId,
      supportSession.phoneNumber,
      mediaId,
    )
    if (!media) {
      return NextResponse.json(
        { success: false, error: "El archivo no pertenece a esta conversación" },
        { status: 403 },
      )
    }

    const config = await getWhatsAppConfigById(supportSession.configId)
    if (!config) {
      return NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 })
    }

    const descarga = await descargarMediaParaPanel(mediaId, config.accessToken)

    if (descarga.estado === "demasiado_grande") {
      return NextResponse.json(
        {
          success: false,
          error:
            `El archivo pesa ${formatearTamano(descarga.tamanoBytes)} y no se puede abrir desde el panel ` +
            `(el máximo es ${formatearTamano(LIMITE_DESCARGA_PANEL)}). Pedile al paciente que lo reenvíe más liviano.`,
          demasiadoGrande: true,
        },
        { status: 413 },
      )
    }

    if (descarga.estado !== "ok") {
      // Lo esperable pasado el plazo de retención. No es un error del sistema.
      const dias = media.direccion === "entrante" ? DIAS_RETENCION_ENTRANTE : DIAS_RETENCION_WHATSAPP
      return NextResponse.json(
        {
          success: false,
          error: `El archivo ya no está disponible. WhatsApp lo conserva ${dias} días.`,
          caducado: true,
        },
        { status: 404 },
      )
    }

    const { buffer } = descarga

    // ── Con qué tipo se sirve (21/9/2026) ────────────────────────────────────
    //
    // Nunca con el mime declarado. Cuando el archivo lo subió un agente, el POST
    // ya verificó el contenido contra la declaración; pero desde que el paciente
    // también manda archivos, el mime del historial puede venir de alguien que
    // lo eligió a propósito. Servir `image/svg+xml` o `text/html` incrustado
    // ejecutaría en el origen del panel, con la sesión del agente, un archivo
    // que eligió un tercero.
    //
    // Entonces: se mira el contenido. Si es uno de los tres que sabemos
    // reconocer, se sirve incrustado con ESE tipo. Cualquier otra cosa se baja
    // como binario opaco, que es lo que el agente pidió poder hacer sin que el
    // navegador la interprete.
    const tipoReal = detectarTipoReal(buffer)
    const incrustable = tipoReal !== null

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": incrustable ? tipoReal! : "application/octet-stream",
        "Content-Length": String(buffer.length),
        // Interpolar el nombre acá directamente devolvía 500 con el archivo ya
        // descargado en cuanto tenía un acento o un espacio fino de macOS: las
        // cabeceras HTTP son Latin-1. Ver cabeceraContentDisposition.
        "Content-Disposition": cabeceraContentDisposition(
          media.nombreArchivo,
          incrustable ? "inline" : "attachment",
        ),
        // Sin esto, un navegador puede adivinar el tipo por el contenido y
        // renderizar como HTML algo que mandamos como binario.
        "X-Content-Type-Options": "nosniff",
        // Son datos clínicos: no deben quedar en caches compartidas.
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error: any) {
    console.error("[SUPPORT_MEDIA] ❌ Error en GET:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function buscarMediaEnLaConversacion(
  configId: string,
  phoneNumber: string,
  mediaId: string,
): Promise<MediaAdjunta | null> {
  const { messages } = await getConversationMessages(configId, phoneNumber, MENSAJES_A_REVISAR, 0)
  for (let i = messages.length - 1; i >= 0; i--) {
    const media = (messages[i] as any)?.media as MediaAdjunta | undefined
    if (media?.mediaId === mediaId) return media
  }
  return null
}
