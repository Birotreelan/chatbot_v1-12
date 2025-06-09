import { notFound } from "next/navigation"
import { getConfig } from "@/lib/db"
import { WidgetDemo } from "@/components/chat/widget-demo"

export default async function ChatPage({ params }: { params: { id: string } }) {
  const config = await getConfig(params.id)

  if (!config) {
    notFound()
  }

  // Determinar el color primario con fallback a azul
  const primaryColor = config.widgetPrimaryColor || "#3b82f6"

  return <WidgetDemo config={config} primaryColor={primaryColor} />
}
