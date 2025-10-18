"use client"

import { useState, useEffect } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Search } from "lucide-react"

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
  const [phoneFilter, setPhoneFilter] = useState("")

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 10000) // Actualizar cada 10 segundos
    return () => clearInterval(interval)
  }, [configId])

  async function loadContacts() {
    try {
      const response = await fetch(`/api/conversations/contacts?configId=${configId}`)
      const data = await response.json()
      setContacts(data.contacts || [])
    } catch (error) {
      console.error("Error cargando contactos:", error)
    } finally {
      setLoading(false)
    }
  }

  const filteredContacts = contacts.filter((contact) =>
    contact.phoneNumber.toLowerCase().includes(phoneFilter.toLowerCase()),
  )

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Cargando contactos...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b bg-background sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por número de teléfono..."
            value={phoneFilter}
            onChange={(e) => setPhoneFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        {phoneFilter && (
          <p className="text-xs text-muted-foreground mt-2">
            {filteredContacts.length} de {contacts.length} contactos
          </p>
        )}
      </div>

      {filteredContacts.length === 0 ? (
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            {phoneFilter ? "No se encontraron contactos con ese número" : "No hay conversaciones aún"}
          </p>
        </div>
      ) : (
        <div className="divide-y overflow-y-auto flex-1">
          {filteredContacts.map((contact) => (
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
                        if (!contact.lastMessageAt) return "Ahora"

                        const date = new Date(contact.lastMessageAt)
                        if (isNaN(date.getTime())) return "Ahora"

                        return formatDistanceToNow(date, {
                          addSuffix: true,
                          locale: es,
                        })
                      } catch (error) {
                        return "Ahora"
                      }
                    })()}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground truncate">{contact.lastMessage}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
