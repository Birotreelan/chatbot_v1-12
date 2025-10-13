"use client"

import { useState, useEffect } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface Contact {
  phoneNumber: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
}

interface ConversationsListProps {
  configId: string
  selectedContact: string | null
  onSelectContact: (phoneNumber: string) => void
}

export function ConversationsList({ configId, selectedContact, onSelectContact }: ConversationsListProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 10000) // Actualizar cada 10 segundos
    return () => clearInterval(interval)
  }, [configId])

  async function loadContacts() {
    try {
      console.log("[v0] Loading contacts for configId:", configId)
      const response = await fetch(`/api/conversations/contacts?configId=${configId}`)
      const data = await response.json()
      console.log("[v0] Contacts response:", data)
      console.log("[v0] Number of contacts:", data.contacts?.length || 0)

      if (data.contacts && data.contacts.length > 0) {
        console.log("[v0] First contact sample:", data.contacts[0])
      }

      setContacts(data.contacts || [])
    } catch (error) {
      console.error("[v0] Error cargando contactos:", error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Cargando contactos...</p>
      </div>
    )
  }

  if (contacts.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">No hay conversaciones aún</p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {contacts.map((contact) => {
        console.log("[v0] Rendering contact:", contact.phoneNumber, "lastMessageAt:", contact.lastMessageAt)

        return (
          <button
            key={contact.phoneNumber}
            onClick={() => onSelectContact(contact.phoneNumber)}
            className={cn(
              "w-full p-4 flex items-start gap-3 hover:bg-muted/50 transition-colors text-left",
              selectedContact === contact.phoneNumber && "bg-muted",
            )}
          >
            <Avatar className="h-12 w-12 flex-shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {contact.phoneNumber ? contact.phoneNumber.slice(-2) : "??"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold text-sm truncate">{contact.phoneNumber || "Desconocido"}</p>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                  {(() => {
                    try {
                      if (!contact.lastMessageAt) {
                        console.log("[v0] No lastMessageAt for contact:", contact.phoneNumber)
                        return "Ahora"
                      }

                      const date = new Date(contact.lastMessageAt)
                      if (isNaN(date.getTime())) {
                        console.log(
                          "[v0] Invalid date for contact:",
                          contact.phoneNumber,
                          "value:",
                          contact.lastMessageAt,
                        )
                        return "Ahora"
                      }

                      return formatDistanceToNow(date, {
                        addSuffix: true,
                        locale: es,
                      })
                    } catch (error) {
                      console.error("[v0] Error formatting date:", error)
                      return "Ahora"
                    }
                  })()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground truncate">{contact.lastMessage}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
