"use client"

import { useState, useEffect } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, format } from "date-fns"
import { es } from "date-fns/locale"
import { Search, CalendarIcon } from "lucide-react"

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
  onFilteredContactsChange?: (contacts: Contact[]) => void
}

export function ConversationsList({
  configId,
  selectedContact,
  onSelectContact,
  onFilteredContactsChange,
}: ConversationsListProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [phoneFilter, setPhoneFilter] = useState("")
  const [dateFrom, setDateFrom] = useState<Date>(new Date())
  const [dateTo, setDateTo] = useState<Date>(new Date())

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 10000)
    return () => clearInterval(interval)
  }, [configId, dateFrom, dateTo])

  async function loadContacts() {
    try {
      const fromStr = format(dateFrom, "yyyy-MM-dd")
      const toStr = format(dateTo, "yyyy-MM-dd")
      const response = await fetch(
        `/api/conversations/contacts?configId=${configId}&dateFrom=${fromStr}&dateTo=${toStr}`,
      )
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

  useEffect(() => {
    if (onFilteredContactsChange) {
      onFilteredContactsChange(filteredContacts)
    }
  }, [filteredContacts, onFilteredContactsChange])

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Cargando contactos...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b bg-background sticky top-0 z-10 space-y-3">
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

        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start text-left font-normal bg-transparent">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateFrom, "dd/MM/yyyy", { locale: es })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateFrom} onSelect={(date) => date && setDateFrom(date)} />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start text-left font-normal bg-transparent">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(dateTo, "dd/MM/yyyy", { locale: es })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={dateTo} onSelect={(date) => date && setDateTo(date)} />
            </PopoverContent>
          </Popover>
        </div>

        <p className="text-xs text-muted-foreground">
          {filteredContacts.length} de {contacts.length} contactos
          {phoneFilter && " (filtrado por número)"}
        </p>
      </div>

      {filteredContacts.length === 0 ? (
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            {phoneFilter
              ? "No se encontraron contactos con ese número"
              : "No hay conversaciones en el rango de fechas seleccionado"}
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
