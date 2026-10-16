/**
 * Servir un archivo de una conversación (16/10/2026).
 *
 * Dos paneles piden lo mismo por caminos distintos: el de atención, con el
 * `sessionId` de una sesión de atención humana; el Monitor del dashboard, con
 * el `configId` y el teléfono. Lo que cambia entre los dos es QUIÉN puede
 * pedirlo. Lo que sigue después —comprobar que el archivo sea de esa
 * conversación, bajarlo de WhatsApp, decidir con qué tipo se sirve— es idéntico,
 * y es justo la parte donde están las decisiones que no conviene tener por
 * duplicado.
 *
 * Por eso la autorización se resuelve en cada ruta y esto empieza cuando ya
 * está resuelta. Esta función NO autentica: el llamador tiene que haberlo hecho.
 */

import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/conversations"
import { getWhatsAppConfigById } from "@/lib/db"
import {
  descargarMediaParaPanel,
  detectarTipoReal,
  cabeceraContentDisposition,
  formatearTamano,
  DIAS_RETENCION_WHATSAPP,
  DIAS_RETENCION_ENTRANTE,
  LIMITE_DESCARGA_PANEL,
} from "@/lib/whatsapp-media"
import type { MediaAdjunta } from "@/lib/types"

/** Cuántos mensajes del historial se miran para validar que un media_id sea de esta conversación. */
const MENSAJES_A_REVISAR = 100

/**
 * Busca el archivo en el historial de ESA conversación.
 *
 * Es la comprobación que evita que alguien con acceso al panel pida el archivo
 * de otro paciente con solo conocer su id. Se recorre de atrás para adelante
 * porque lo que se mira es casi siempre reciente.
 */
export async function buscarMediaEnLaConversacion(
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

/**
 * Devuelve el archivo, o la respuesta que explica por qué no.
 *
 * Los dos "no" que NO son errores del sistema y hay que explicar, no esconder:
 * el archivo caducó (WhatsApp lo conserva un tiempo limitado) y el archivo pesa
 * más de lo que el panel puede bajar.
 */
export async function servirMediaDeLaConversacion(params: {
  configId: string
  phoneNumber: string
  mediaId: string
  /** `?descargar=1`: el servidor responde `attachment`. Ver la nota de abajo. */
  forzarDescarga?: boolean
  /** Para los logs, cuando algo sale mal. */
  etiqueta?: string
}): Promise<NextResponse> {
  const { configId, phoneNumber, mediaId, forzarDescarga = false } = params
  const etiqueta = params.etiqueta || "MEDIA"

  const media = await buscarMediaEnLaConversacion(configId, phoneNumber, mediaId)
  if (!media) {
    console.warn(`[${etiqueta}] mediaId ajeno a la conversación (${configId}/${phoneNumber})`)
    return NextResponse.json(
      { success: false, error: "El archivo no pertenece a esta conversación" },
      { status: 403 },
    )
  }

  const config = await getWhatsAppConfigById(configId)
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

  // ── Con qué tipo se sirve (21/9/2026) ──────────────────────────────────────
  //
  // Nunca con el mime declarado. Cuando el archivo lo subió un agente, el POST
  // ya verificó el contenido contra la declaración; pero desde que el paciente
  // también manda archivos, el mime del historial puede venir de alguien que lo
  // eligió a propósito. Servir `image/svg+xml` o `text/html` incrustado
  // ejecutaría en el origen del panel, con la sesión de quien mira, un archivo
  // que eligió un tercero.
  //
  // Entonces: se mira el contenido. Si es uno de los tres que sabemos reconocer,
  // se sirve incrustado con ESE tipo. Cualquier otra cosa baja como binario
  // opaco.
  const tipoReal = detectarTipoReal(buffer)

  // `?descargar=1` existe porque el atributo `download` del <a> es sólo una
  // sugerencia y los navegadores no lo respetan igual cuando el servidor manda
  // `inline`: decidirlo del lado del servidor es lo único que se comporta igual
  // en todos.
  const incrustable = tipoReal !== null && !forzarDescarga

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
}
