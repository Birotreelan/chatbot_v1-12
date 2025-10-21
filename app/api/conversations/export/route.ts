import { NextResponse } from "next/server"
import { getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumbersParam = searchParams.get("phoneNumbers")

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    if (!phoneNumbersParam) {
      return NextResponse.json({ error: "No hay contactos para exportar" }, { status: 400 })
    }

    console.log(`[API] Exportando conversaciones para configId: ${configId}`)

    const phoneNumbers = phoneNumbersParam.split(",").filter(Boolean)

    if (phoneNumbers.length === 0) {
      return NextResponse.json({ error: "No hay conversaciones para exportar" }, { status: 404 })
    }

    const allMessages = []
    for (const phoneNumber of phoneNumbers) {
      const messages = await getConversationMessages(configId, phoneNumber)
      allMessages.push(...messages)
    }

    // Ordenar por timestamp
    allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Generar CSV
    const csvRows = [
      // Header
      ["Fecha", "Hora", "Número de Teléfono", "Rol", "Mensaje", "Tipo de Mensaje"].join(","),
    ]

    for (const message of allMessages) {
      const date = new Date(message.timestamp)
      const dateStr = date.toLocaleDateString("es-ES")
      const timeStr = date.toLocaleTimeString("es-ES")
      const role = message.role === "user" ? "Usuario" : message.role === "assistant" ? "Asistente" : "Sistema"
      const content = `"${message.content.replace(/"/g, '""')}"` // Escapar comillas
      const messageType = message.messageType || "text"

      csvRows.push([dateStr, timeStr, message.phoneNumber, role, content, messageType].join(","))
    }

    const csvContent = csvRows.join("\n")

    // Retornar CSV con headers apropiados
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="conversaciones_${configId}_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    })
  } catch (error) {
    console.error("[API] Error exportando conversaciones:", error)
    return NextResponse.json({ error: "Error exportando conversaciones" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
