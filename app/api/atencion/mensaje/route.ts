/**
 * El chat del paciente: leer lo nuevo y escribir (5/11/2026).
 *
 *   GET  /api/atencion/mensaje?token=…&desde=<n>   → los mensajes a partir de n
 *   POST /api/atencion/mensaje  { token, texto }   → el paciente escribe
 *
 * ── La autorización es el token, y nada más ────────────────────────────────
 *
 * No hay sesión ni cookie: quien tiene el enlace es el paciente. Es el mismo
 * modelo que el portal de turnos, con la misma consecuencia —el enlace ES la
 * credencial— y por eso vence y se reemite en cada aviso. Ver
 * lib/atencion/token.ts.
 *
 * El token no viaja en el cuerpo por comodidad: va también en el GET como
 * query porque es una lectura. Lo que NO hace es viajar en la URL de la página
 * hacia ningún tercero: la página es nuestra y no carga nada de afuera.
 *
 * ── Por qué consultas y no un stream ──────────────────────────────────────
 *
 * Porque un SSE mantiene viva una instancia de función mientras el chat esté
 * abierto, y en Fluid compute la memoria se factura por tiempo de vida de la
 * instancia. Ya nos pasó con el widget de notificaciones: 731,9 GB-hora en un
 * mes para entregar una latencia de 30 segundos. Acá la latencia es de 5
 * segundos y cuesta una consulta de 100 ms.
 */

import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { leerEnlaceDeAtencion } from "@/lib/atencion/token"
import {
  agregarMensaje,
  leerConversacion,
  marcarPresente,
  type MensajeDeAtencion,
} from "@/lib/atencion/conversacion"
import { registrarMensajeDelPaciente } from "@/lib/atencion/entrada"

export const dynamic = "force-dynamic"

/** Lo que el chat necesita para dibujar un mensaje. */
function paraElChat(m: MensajeDeAtencion) {
  return {
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
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const token = params.get("token") || ""

    const enlace = await leerEnlaceDeAtencion(token)
    if (!enlace) {
      return NextResponse.json({ error: "El enlace no es válido o venció" }, { status: 401 })
    }

    // El latido: mientras el chat esté abierto consultando, el paciente está
    // presente y no se le notifica cada respuesta por WhatsApp. Ver
    // lib/atencion/aviso.ts.
    await marcarPresente(enlace.clienteId, enlace.telefono)

    const todos = await leerConversacion(enlace.clienteId, enlace.telefono)
    const desde = Math.max(0, Number(params.get("desde") || 0) || 0)

    return NextResponse.json(
      {
        exito: true,
        // `total` es la posición absoluta: el chat manda `desde=total` en la
        // consulta siguiente y recibe sólo lo que llegó en el medio. Sin esto
        // habría que comparar ids o fechas en el cliente, y una fecha repetida
        // duplica un mensaje en pantalla.
        total: todos.length,
        mensajes: todos.slice(desde).map(paraElChat),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    console.error("[ATENCION_MENSAJE] Error leyendo:", error)
    return NextResponse.json({ error: "No se pudo leer la conversación" }, { status: 500 })
  }
}

/** Tope del texto. WhatsApp permite 4096; acá no hace falta más. */
const MAXIMO_TEXTO = 4096

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = typeof body?.token === "string" ? body.token : ""

    const enlace = await leerEnlaceDeAtencion(token)
    if (!enlace) {
      return NextResponse.json({ error: "El enlace no es válido o venció" }, { status: 401 })
    }

    const texto = String(body?.texto ?? "").trim().slice(0, MAXIMO_TEXTO)
    if (!texto) {
      return NextResponse.json({ error: "El mensaje está vacío" }, { status: 400 })
    }

    const mensaje: MensajeDeAtencion = {
      id: nanoid(),
      rol: "paciente",
      texto,
      enviadoEl: new Date().toISOString(),
      via: "chat",
    }

    await agregarMensaje(enlace.clienteId, enlace.telefono, mensaje)
    await marcarPresente(enlace.clienteId, enlace.telefono)

    /**
     * Y que llegue al panel.
     *
     * Es lo que hace que "del lado de la clínica queda igual" sea cierto: el
     * mensaje entra a la sesión de soporte y al historial de la conversación,
     * así que el agente lo ve donde ve todo lo demás, sin saber que vino por
     * el chat. Ver lib/atencion/entrada.ts.
     */
    await registrarMensajeDelPaciente({
      configId: enlace.configId,
      clienteId: enlace.clienteId,
      telefono: enlace.telefono,
      mensaje,
    })

    return NextResponse.json({ exito: true, mensaje: paraElChat(mensaje) })
  } catch (error) {
    console.error("[ATENCION_MENSAJE] Error escribiendo:", error)
    return NextResponse.json({ error: "No se pudo enviar el mensaje" }, { status: 500 })
  }
}
