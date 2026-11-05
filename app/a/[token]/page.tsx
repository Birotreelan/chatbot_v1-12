/**
 * El chat de atención del paciente (5/11/2026).
 *
 *   /a/<token>
 *
 * ── Por qué `/a/` y no `/p/` ni `/c/` ──────────────────────────────────────
 *
 * Son tres cosas distintas: `/p/` es la gestión de turnos por pantallas, `/c/`
 * es el bot en formato chat, y esto es una conversación con una persona.
 * Compartir prefijo haría que un token de una sirviera para probar suerte en
 * las otras, y además las tres tienen vigencias y permisos propios.
 *
 * ── Se renderiza el historial COMPLETO en el servidor ──────────────────────
 *
 * El paciente que abre el enlace tiene que ver lo de hoy y lo de hace dos
 * meses, sin esperar una consulta del cliente. Es el punto del pedido: que
 * funcione como WhatsApp.
 */

import { getWhatsAppConfigById } from "@/lib/db"
import { marcaDelPortal } from "@/lib/portal/marca"
import { Marco, Aviso } from "@/components/portal/marco"
import { leerEnlaceDeAtencion } from "@/lib/atencion/token"
import { leerConversacion, marcarPresente } from "@/lib/atencion/conversacion"
import { ChatDeAtencion, type MensajeEnPantalla } from "@/components/atencion/chat-de-atencion"

export const dynamic = "force-dynamic"

export default async function PaginaDelChatDeAtencion({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const enlace = await leerEnlaceDeAtencion(token)

  if (!enlace) {
    // Sin marca: no sabemos de qué clínica es un token que no existe, y
    // ponerle el nombre de una sería adivinar.
    return (
      <Marco marca={marcaDelPortal(null)}>
        <Aviso
          tono="atencion"
          titulo="Este enlace venció o no es válido"
          detalle="Escribile a la clínica por WhatsApp y te mandamos uno nuevo con la conversación completa."
        />
      </Marco>
    )
  }

  const config = await getWhatsAppConfigById(enlace.configId).catch(() => null)
  const marca = marcaDelPortal(config)

  // Abrir el chat ya cuenta como estar mirando: si no, el primer mensaje que
  // mande el agente en los segundos siguientes dispararía una notificación de
  // WhatsApp para alguien que tiene la pantalla abierta.
  await marcarPresente(enlace.clienteId, enlace.telefono)

  const guardados = await leerConversacion(enlace.clienteId, enlace.telefono)

  const mensajes: MensajeEnPantalla[] = guardados.map((m) => ({
    id: m.id,
    rol: m.rol,
    texto: m.texto,
    enviadoEl: m.enviadoEl,
    agenteNombre: m.agenteNombre,
    via: m.via,
    media: m.media
      ? {
          tipo: m.media.tipo,
          mimeType: m.media.mimeType,
          nombreArchivo: m.media.nombreArchivo,
          tamanoBytes: m.media.tamanoBytes,
          url: `/api/atencion/media?id=${encodeURIComponent(m.media.mediaId)}`,
        }
      : undefined,
  }))

  return (
    <Marco marca={marca}>
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Chat con {marca.clinica}</h1>
          <p className="text-sm text-muted-foreground">
            Escribís con una persona del equipo. Lo que se hable queda guardado acá, así que podés
            volver a abrir este chat cuando quieras.
          </p>
        </div>

        <ChatDeAtencion
          token={token}
          inicial={mensajes}
          totalInicial={mensajes.length}
          clinica={marca.clinica}
        />
      </div>
    </Marco>
  )
}
