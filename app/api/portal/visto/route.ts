/**
 * "El paciente abrió el enlace" (30/9/2026).
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * El portal sacó al paciente de WhatsApp, y desde el panel eso se ve como un
 * silencio: se mandó un enlace y después no pasa nada hasta que reserva o
 * cancela. Si abandona en el medio —o si el enlace ni siquiera abre— no queda
 * rastro de por dónde se cayó.
 *
 * Esta ruta escribe una línea en la conversación la primera vez que el enlace
 * se abre. Con eso el panel distingue tres cosas que antes se veían iguales:
 * no abrió, abrió y abandonó, abrió y gestionó.
 *
 * ── Por qué la llama el navegador y no la página ───────────────────────────
 *
 * La página es un Server Component: podría anotarlo al renderizar, sin esta
 * ruta. Pero entonces contaría como "el paciente entró" cualquier cosa que
 * siga la URL —un escáner de enlaces, un antivirus corporativo, un proxy—,
 * porque todos reciben el mismo HTML.
 *
 * Que el aviso venga del navegador exige que alguien haya ejecutado
 * JavaScript, que es la evidencia más barata de que del otro lado hay una
 * persona. No es infalible; es mucho mejor que lo otro.
 *
 * Y por eso también el fallo es silencioso: esto es telemetría. Si Redis no
 * está o el token venció, el paciente no tiene que enterarse de nada.
 */

import { NextResponse } from "next/server"
import { nanoid } from "nanoid"

import { marcarVisto } from "@/lib/portal/token"
import { saveConversationMessage } from "@/lib/conversations"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let token = ""
  try {
    token = String((await request.json())?.token || "")
  } catch {
    // Body ilegible: no hay nada que anotar y nada que avisar.
  }

  if (!token) return NextResponse.json({ ok: true })

  try {
    const marca = await marcarVisto(token)

    // Ya estaba marcado, o el enlace no existe. En los dos casos, nada que
    // escribir: el panel no tiene que mostrar una línea por cada recarga.
    if (!marca?.primera) return NextResponse.json({ ok: true })

    const { contexto } = marca

    await saveConversationMessage({
      id: nanoid(),
      role: "assistant",
      content: contexto.demo
        ? "[Portal] Se abrió el enlace de PRUEBA."
        : "[Portal] El paciente abrió el enlace.",
      timestamp: new Date().toISOString(),
      phoneNumber: contexto.phone,
      configId: contexto.configId,
      messageType: "portal",
    })

    console.log(`[PORTAL] ${contexto.phone} abrió el enlace (${contexto.intencion})`)
  } catch (error) {
    console.error("[PORTAL] No se pudo anotar la apertura del enlace:", error)
  }

  return NextResponse.json({ ok: true })
}
