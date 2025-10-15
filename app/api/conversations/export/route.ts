import { NextResponse } from "next/server"
import { getConversationContacts, getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const timeFilter = searchParams.get("timeFilter")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const searchPhone = searchParams.get("searchPhone")
    const searchText = searchParams.get("searchText") // Added searchText parameter for global text search

    console.log("[API] GET /api/conversations/export - configId:", configId)

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    let contacts = await getConversationContacts(configId)

    // Apply time-based filters (same logic as contacts route)
    if (timeFilter || startDate || endDate) {
      const now = new Date()
      let filterStartDate: Date | null = null
      let filterEndDate: Date | null = null

      if (timeFilter === "lastHour") {
        filterStartDate = new Date(now.getTime() - 60 * 60 * 1000)
      } else if (timeFilter === "lastDay") {
        filterStartDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      } else if (timeFilter === "custom" && startDate) {
        filterStartDate = new Date(startDate)
        if (endDate) {
          filterEndDate = new Date(endDate)
          filterEndDate.setHours(23, 59, 59, 999)
        }
      }

      if (filterStartDate) {
        contacts = contacts.filter((contact) => {
          const contactDate = new Date(contact.lastMessageAt)
          if (filterEndDate) {
            return contactDate >= filterStartDate && contactDate <= filterEndDate
          }
          return contactDate >= filterStartDate
        })
      }
    }

    // Apply phone number search filter
    if (searchPhone && searchPhone.trim()) {
      const searchTerm = searchPhone.trim().toLowerCase()
      contacts = contacts.filter((contact) => contact.phoneNumber.toLowerCase().includes(searchTerm))
    }

    if (searchText && searchText.trim()) {
      const searchTerm = searchText.trim().toLowerCase()
      console.log("[API] Applying global text search for export:", searchTerm)

      const filteredContacts = []
      for (const contact of contacts) {
        const messages = await getConversationMessages(configId, contact.phoneNumber)
        const hasMatch = messages.some((msg) => msg.content.toLowerCase().includes(searchTerm))

        if (hasMatch) {
          filteredContacts.push(contact)
        }
      }

      contacts = filteredContacts
      console.log("[API] Contacts after text search for export:", contacts.length)
    }

    // Fetch all messages for each contact
    const conversationsData = await Promise.all(
      contacts.map(async (contact) => {
        const messages = await getConversationMessages(configId, contact.phoneNumber)
        return {
          contact,
          messages,
        }
      }),
    )

    // Generate CSV content
    const csvRows: string[] = []

    // CSV Header
    csvRows.push("Número de Teléfono,Rol,Mensaje,Fecha y Hora,Tipo de Mensaje")

    // Add data rows
    for (const { contact, messages } of conversationsData) {
      for (const message of messages) {
        const row = [
          contact.phoneNumber,
          message.role === "user" ? "Usuario" : message.role === "assistant" ? "Asistente" : "Sistema",
          `"${message.content.replace(/"/g, '""')}"`, // Escape quotes in CSV
          new Date(message.timestamp).toLocaleString("es-ES"),
          message.messageType || "texto",
        ]
        csvRows.push(row.join(","))
      }
    }

    const csvContent = csvRows.join("\n")

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split("T")[0]
    const filename = `conversaciones_${configId}_${timestamp}.csv`

    // Return CSV file
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("[API] Error exportando conversaciones:", error)
    return NextResponse.json({ error: "Error exportando conversaciones" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
