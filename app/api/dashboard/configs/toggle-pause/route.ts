/**
 * Pausar/reanudar desde el dashboard.
 *
 * Dos alcances distintos según venga o no `phoneNumber`:
 *
 *  - CON teléfono: pausa la IA en ESA conversación. Es lo de siempre, lo que
 *    usa atención humana para que el bot no le hable encima al agente.
 *
 *  - SIN teléfono: pausa TODOS los envíos del cliente. Esto faltaba (1/10/2026):
 *    la lista de configuraciones tiene un botón "Pausar IA" que manda sólo el
 *    `configId`, y esta ruta le respondía 400 porque exigía el teléfono. O sea
 *    que el botón existía, mostraba su badge "IA Pausada"… y no pausaba nada.
 *    Cualquiera que lo haya tocado creyó que había cortado el servicio.
 *
 * El alcance de cliente usa `lib/pausa-de-envios.ts`, la misma compuerta que el
 * endpoint público, y NO el campo `WhatsAppConfig.paused` que había quedado
 * dando vueltas sin que nadie lo leyera: dos banderas para lo mismo terminan
 * contradiciéndose.
 */

import { NextResponse } from "next/server"

import { isConversationPaused, setConversationPaused } from "@/lib/conversations"
import { estadoDePausa, pausarEnvios, reanudarEnvios } from "@/lib/pausa-de-envios"
import { getWhatsAppConfig } from "@/lib/db"
import { requireAuthForApi } from "@/lib/auth"

export async function POST(request: Request) {
  try {
    const { session, error } = await requireAuthForApi()
    if (!session) {
      return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
    }

    const { configId, phoneNumber } = await request.json()

    if (!configId) {
      return NextResponse.json({ error: "Config ID es requerido" }, { status: 400 })
    }

    // ── Alcance conversación ────────────────────────────────────────────────
    if (phoneNumber) {
      const pausadaAhora = await isConversationPaused(configId, phoneNumber)
      const nuevoEstado = !pausadaAhora

      const ok = await setConversationPaused(configId, phoneNumber, nuevoEstado)
      if (!ok) {
        return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
      }

      console.log(`[API] IA ${nuevoEstado ? "pausada" : "reanudada"} para ${configId}:${phoneNumber}`)

      return NextResponse.json({
        success: true,
        alcance: "conversacion",
        paused: nuevoEstado,
        phoneNumber,
        message: nuevoEstado ? "IA pausada para esta conversación" : "IA reanudada para esta conversación",
      })
    }

    // ── Alcance cliente: todos los envíos ───────────────────────────────────
    const config = await getWhatsAppConfig(configId)
    if (!config?.phoneNumberId) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    const { pausado } = await estadoDePausa(config.phoneNumberId)
    const nuevoEstado = !pausado

    const quien = session.username || "dashboard"
    const ok = nuevoEstado
      ? await pausarEnvios(config.phoneNumberId, { por: quien })
      : await reanudarEnvios(config.phoneNumberId, quien)

    if (!ok) {
      return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      alcance: "cliente",
      paused: nuevoEstado,
      message: nuevoEstado
        ? "Envíos pausados: no se va a enviar ningún mensaje (ni recordatorios) hasta reanudar"
        : "Envíos reanudados",
    })
  } catch (error) {
    console.error("[API] Error al cambiar estado de pausa:", error)
    return NextResponse.json({ error: "Error al cambiar estado de pausa" }, { status: 500 })
  }
}
