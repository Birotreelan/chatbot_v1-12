import { NextResponse } from "next/server"
import { getConversationContacts, getConversationMessages } from "@/lib/conversations"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const timeFilter = searchParams.get("timeFilter") // 'lastHour', 'lastDay', 'custom'
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const searchPhone = searchParams.get("searchPhone")
    const searchText = searchParams.get("searchText")

    console.log("[API] GET /api/conversations/contacts - configId:", configId)
    console.log("[API] Filters:", { timeFilter, startDate, endDate, searchPhone, searchText })

    if (!configId) {
      return NextResponse.json({ error: "configId es requerido" }, { status: 400 })
    }

    let contacts = await getConversationContacts(configId)

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
          filterEndDate.setHours(23, 59, 59, 999) // End of day
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

    if (searchPhone && searchPhone.trim()) {
      const searchTerm = searchPhone.trim().toLowerCase()
      contacts = contacts.filter((contact) => contact.phoneNumber.toLowerCase().includes(searchTerm))
    }

    if (searchText && searchText.trim()) {
      const searchTerm = searchText.trim().toLowerCase()
      console.log("[API] Applying global text search:", searchTerm)

      // Filter contacts that have at least one message matching the search text
      const filteredContacts = []
      for (const contact of contacts) {
        const messages = await getConversationMessages(configId, contact.phoneNumber)
        const hasMatch = messages.some((msg) => msg.content.toLowerCase().includes(searchTerm))

        if (hasMatch) {
          filteredContacts.push(contact)
        }
      }

      contacts = filteredContacts
      console.log("[API] Contacts after text search:", contacts.length)
    }

    console.log("[API] Contacts fetched:", contacts.length, "after filters")

    return NextResponse.json({ contacts })
  } catch (error) {
    console.error("[API] Error obteniendo contactos:", error)
    return NextResponse.json({ error: "Error obteniendo contactos" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
