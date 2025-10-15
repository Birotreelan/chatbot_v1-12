"use client"

import { useState, useEffect } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { formatDistanceToNow, format } from "date-fns"
import { es } from "date-fns/locale"
import { Search, Download, CalendarIcon, Loader2, MessageSquareText } from "lucide-react"

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
  const [exporting, setExporting] = useState(false)

  const [searchPhone, setSearchPhone] = useState("")
  const [searchText, setSearchText] = useState("")
  const [timeFilter, setTimeFilter] = useState<"all" | "lastHour" | "lastDay" | "custom">("all")
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [showDatePicker, setShowDatePicker] = useState(false)

  useEffect(() => {
    loadContacts()
    const interval = setInterval(loadContacts, 10000)
    return () => clearInterval(interval)
  }, [configId, searchPhone, searchText, timeFilter, startDate, endDate])

  async function loadContacts() {
    try {
      const params = new URLSearchParams({ configId })

      if (timeFilter !== "all") {
        params.append("timeFilter", timeFilter)
      }

      if (timeFilter === "custom" && startDate) {
        params.append("startDate", startDate.toISOString())
        if (endDate) {
          params.append("endDate", endDate.toISOString())
        }
      }

      if (searchPhone.trim()) {
        params.append("searchPhone", searchPhone.trim())
      }

      if (searchText.trim()) {
        params.append("searchText", searchText.trim())
      }

      const response = await fetch(`/api/conversations/contacts?${params.toString()}`)
      const data = await response.json()
      setContacts(data.contacts || [])
    } catch (error) {
      console.error("Error cargando contactos:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    try {
      setExporting(true)

      const params = new URLSearchParams({ configId })

      if (timeFilter !== "all") {
        params.append("timeFilter", timeFilter)
      }

      if (timeFilter === "custom" && startDate) {
        params.append("startDate", startDate.toISOString())
        if (endDate) {
          params.append("endDate", endDate.toISOString())
        }
      }

      if (searchPhone.trim()) {
        params.append("searchPhone", searchPhone.trim())
      }

      if (searchText.trim()) {
        params.append("searchText", searchText.trim())
      }

      const response = await fetch(`/api/conversations/export?${params.toString()}`)

      if (!response.ok) {
        throw new Error("Error al exportar conversaciones")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `conversaciones_${new Date().toISOString().split("T")[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error("Error exportando conversaciones:", error)
      alert("Error al exportar conversaciones")
    } finally {
      setExporting(false)
    }
  }

  function resetFilters() {
    setSearchPhone("")
    setSearchText("")
    setTimeFilter("all")
    setStartDate(undefined)
    setEndDate(undefined)
  }

  if (loading) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Cargando contactos...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b space-y-3">
        <div className="relative">
          <MessageSquareText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar en mensajes..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por teléfono..."
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={timeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTimeFilter("all")
              setStartDate(undefined)
              setEndDate(undefined)
            }}
          >
            Todos
          </Button>
          <Button
            variant={timeFilter === "lastHour" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTimeFilter("lastHour")
              setStartDate(undefined)
              setEndDate(undefined)
            }}
          >
            Última hora
          </Button>
          <Button
            variant={timeFilter === "lastDay" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTimeFilter("lastDay")
              setStartDate(undefined)
              setEndDate(undefined)
            }}
          >
            Último día
          </Button>

          <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
            <PopoverTrigger asChild>
              <Button
                variant={timeFilter === "custom" ? "default" : "outline"}
                size="sm"
                className={cn("gap-2", timeFilter === "custom" && "border-primary")}
              >
                <CalendarIcon className="h-4 w-4" />
                {startDate ? (
                  endDate ? (
                    <>
                      {format(startDate, "dd/MM", { locale: es })} - {format(endDate, "dd/MM", { locale: es })}
                    </>
                  ) : (
                    format(startDate, "dd/MM/yyyy", { locale: es })
                  )
                ) : (
                  "Rango"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Fecha inicio</Label>
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => {
                      setStartDate(date)
                      setTimeFilter("custom")
                    }}
                    locale={es}
                    disabled={(date) => date > new Date()}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha fin (opcional)</Label>
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => {
                      setEndDate(date)
                      setTimeFilter("custom")
                    }}
                    locale={es}
                    disabled={(date) => date > new Date() || (startDate ? date < startDate : false)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setShowDatePicker(false)} className="flex-1">
                    Aplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setStartDate(undefined)
                      setEndDate(undefined)
                      setTimeFilter("all")
                      setShowDatePicker(false)
                    }}
                  >
                    Limpiar
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleExport} disabled={exporting || contacts.length === 0} size="sm" className="flex-1">
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Exportar CSV ({contacts.length})
              </>
            )}
          </Button>
          {(searchPhone || searchText || timeFilter !== "all") && (
            <Button onClick={resetFilters} variant="outline" size="sm">
              Limpiar
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y">
        {contacts.length === 0 ? (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              {searchPhone || searchText || timeFilter !== "all"
                ? "No se encontraron conversaciones"
                : "No hay conversaciones aún"}
            </p>
          </div>
        ) : (
          contacts.map((contact) => (
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
          ))
        )}
      </div>
    </div>
  )
}
