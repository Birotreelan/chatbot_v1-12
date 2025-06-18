"use client"

import WidgetChat from "@/components/chat/widget-chat"

export default function WidgetTestPage() {
  console.log("[WIDGET-TEST] 🧪 Página de prueba del widget")

  return (
    <div className="h-screen w-full">
      <WidgetChat clienteId="f11b2a4a-da6a-mi003-a5db-d887b692a8f" />
    </div>
  )
}
