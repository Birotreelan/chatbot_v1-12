"use client"

/**
 * El archivo adjunto de un mensaje, dibujado igual en los tres paneles
 * (16/10/2026).
 *
 * ── Por qué vive acá ───────────────────────────────────────────────────────
 *
 * Estaba copiado en `components/support/message-list.tsx` y en
 * `components/support-proxmox/message-list.tsx`. Al sumarlo al Monitor de
 * Conversaciones iba a ser la tercera copia, y las tres tienen que contestar lo
 * mismo a preguntas que ya costaron decisiones: qué se incrusta y qué no, qué
 * se dice cuando el archivo caducó, y cuántos días lo conserva WhatsApp según
 * quién lo mandó.
 *
 * ── La URL la pone quien renderiza ─────────────────────────────────────────
 *
 * Este componente no sabe de qué endpoint sale el archivo, y es a propósito:
 * el panel de atención lo pide a `/api/support/media` con el `_sid` de la
 * sesión SSO, y el Monitor a `/api/conversations/media` con el configId y el
 * teléfono. La diferencia es de autorización, no de dibujo.
 */

import { FileText, Download, FileX } from "lucide-react"
import type { MediaAdjunta } from "@/lib/types"
import { formatearTamano, DIAS_RETENCION_WHATSAPP, DIAS_RETENCION_ENTRANTE } from "@/lib/media-validacion"
import { esPrevisualizable } from "@/lib/media-entrante"

/**
 * El texto de un mensaje con archivo incluye un marcador "[Archivo enviado: x]"
 * para que se lea bien donde no se puede renderizar nada (el resumen que se le
 * pasa a la IA al cerrar la sesión, una exportación). Donde SÍ se muestra el
 * archivo, el marcador sobra y se saca.
 */
export function textoSinMarcador(contenido: string): string {
  return (contenido || "")
    .replace(/\n?\[(?:Archivo (?:enviado|recibido)|Imagen recibida|Video recibido):[^\]]*\]/g, "")
    .trim()
}

/**
 * Muestra un archivo de la conversación.
 *
 * El archivo no está guardado de nuestro lado: lo pedimos a WhatsApp en el
 * momento, a través de /api/support/media. Por eso hay dos estados que no son
 * errores y hay que explicar, no esconder:
 *
 *  - Caducado: WhatsApp conserva los archivos un tiempo limitado. Pasado ese
 *    plazo, el mensaje sigue en el historial pero el archivo ya no.
 *  - Sin URL: quien renderiza no pasó `construirUrlMedia` (por ejemplo, una
 *    vista de solo lectura).
 */
export function AdjuntoDelMensaje({
  media,
  url,
  urlDescarga,
}: {
  media: MediaAdjunta
  url?: string
  /** Misma URL con `descargar=1`: el servidor responde `attachment`. */
  urlDescarga?: string
}) {
  const caducado = new Date(media.disponibleHasta).getTime() < Date.now()

  // Los archivos del paciente duran la mitad: WhatsApp conserva 30 días lo que
  // subimos nosotros y 7 lo que llega por webhook. Decir el número equivocado
  // haría que un agente crea que todavía tiene tiempo de bajarlo.
  const diasRetencion = media.direccion === "entrante" ? DIAS_RETENCION_ENTRANTE : DIAS_RETENCION_WHATSAPP

  if (caducado || !url) {
    return (
      <div className="mb-1.5 flex items-start gap-1.5 rounded border border-dashed px-2 py-1.5 opacity-80">
        <FileX className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-medium truncate">{media.nombreArchivo}</p>
          <p className="text-[10px] opacity-70">
            {caducado
              ? `Ya no está disponible: WhatsApp lo conserva ${diasRetencion} días.`
              : "No se puede mostrar desde esta vista."}
          </p>
        </div>
      </div>
    )
  }

  // Solo se incrusta lo que el servidor acepta servir incrustado: los tipos cuya
  // firma verifica por contenido. Un archivo que manda el paciente lo eligió él,
  // y el servidor devuelve todo lo demás como binario opaco — pedirlo con un
  // <img> mostraría un recuadro roto en vez de ofrecer la descarga.
  const incrustable = esPrevisualizable(media.mimeType)
  const urlBajar = urlDescarga || url

  // `tamanoBytes` es 0 cuando el archivo entró por webhook: WhatsApp no informa
  // el tamaño ahí. Mostrar "0 bytes" sería decir algo falso; mejor no decir nada.
  const detalle = [
    media.tamanoBytes > 0 ? formatearTamano(media.tamanoBytes) : null,
    incrustable ? null : "no se puede previsualizar",
  ]
    .filter(Boolean)
    .join(" · ")

  // La descarga siempre es un control propio y visible, no un efecto lateral de
  // hacer clic en la vista previa (pedido de Nicolás, 21/9/2026). El agente que
  // recibe el estudio de un paciente casi siempre lo quiere guardar, no mirarlo.
  const BarraDescarga = (
    <a
      href={urlBajar}
      download={media.nombreArchivo}
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/60"
    >
      <Download className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{media.nombreArchivo}</span>
      <span className="shrink-0 font-medium">Descargar</span>
    </a>
  )

  if (media.tipo === "image" && incrustable) {
    return (
      <div className="mb-1.5 overflow-hidden rounded border bg-background">
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          {/* Sin next/image a propósito: el archivo lo sirve nuestra propia API con
              autenticación, y el optimizador de Next no reenvía las credenciales. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={media.nombreArchivo}
            className="max-h-48 w-full bg-background object-contain"
            loading="lazy"
          />
        </a>
        <div className="border-t">{BarraDescarga}</div>
      </div>
    )
  }

  return (
    <div className="mb-1.5 overflow-hidden rounded border bg-background/80">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <FileText className="h-4 w-4 shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-foreground truncate">{media.nombreArchivo}</p>
          {detalle && <p className="text-[10px] text-muted-foreground">{detalle}</p>}
        </div>
        {/* Un PDF se puede abrir en una pestaña; un .docx o un video, no. */}
        {incrustable && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/60"
          >
            Abrir
          </a>
        )}
      </div>
      <div className="border-t">{BarraDescarga}</div>
    </div>
  )
}
