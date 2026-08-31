import { NextResponse } from "next/server"
import { getConversationAudio } from "@/lib/conversation-audio"

/**
 * Sirve el audio original que envió un paciente, para reproducirlo desde el
 * panel de conversaciones (31/8/2026).
 *
 * Sólo devuelve audios que siguen vivos en Redis: caducan junto con la
 * conversación (7 días), así que un audio viejo responde 404 y el panel muestra
 * únicamente la transcripción.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")
    const audioId = searchParams.get("audioId")

    if (!configId || !phoneNumber || !audioId) {
      return NextResponse.json({ error: "configId, phoneNumber y audioId son requeridos" }, { status: 400 })
    }

    const audio = await getConversationAudio(configId, phoneNumber, audioId)

    if (!audio) {
      return NextResponse.json({ error: "El audio ya no está disponible" }, { status: 404 })
    }

    const buffer = Buffer.from(audio.base64, "base64")

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": audio.mimeType,
        "Content-Length": String(buffer.length),
        // Privado: es voz de un paciente, no debe quedar en caches intermedias.
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("[API] Error obteniendo audio de conversación:", error)
    return NextResponse.json({ error: "Error obteniendo el audio" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
