import { notFound } from "next/navigation"
import { getConfigById } from "@/lib/db"
import { ChatDemo } from "@/components/chat/chat-demo"

export default async function ChatPage({ params }: { params: { id: string } }) {
  console.log("[CHAT-PAGE] Cargando configuración para ID:", params.id)

  try {
    const config = await getConfigById(params.id)

    if (!config) {
      console.log("[CHAT-PAGE] Configuración no encontrada para ID:", params.id)
      notFound()
    }

    console.log("[CHAT-PAGE] Configuración encontrada:", {
      id: config.id,
      displayName: config.displayName,
      cliente_id: config.cliente_id,
      widgetEnabled: config.widgetEnabled,
    })

    return <ChatDemo config={config} isEmbedded={true} />
  } catch (error) {
    console.error("[CHAT-PAGE] Error al cargar configuración:", error)
    notFound()
  }
}
