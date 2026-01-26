"use client"

import { useState } from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface DateRangeFilterProps {
  onFilterChange: (startDate: string | null, endDate: string | null) => void
}

type PresetRange = "today" | "yesterday" | "last7days" | "last30days" | "thisMonth" | "lastMonth" | "custom"

export function DateRangeFilter({ onFilterChange }: DateRangeFilterProps) {
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>(new Date())
  const [preset, setPreset] = useState<PresetRange>("today")

  const applyPreset = (value: PresetRange) => {
    setPreset(value)
    const today = new Date()
    let start: Date
    let end: Date = new Date()

    switch (value) {
      case "today":
        start = new Date()
        break
      case "yesterday":
        start = new Date()
        start.setDate(start.getDate() - 1)
        end = new Date(start)
        break
      case "last7days":
        start = new Date()
        start.setDate(start.getDate() - 6)
        break
      case "last30days":
        start = new Date()
        start.setDate(start.getDate() - 29)
        break
      case "thisMonth":
        start = new Date(today.getFullYear(), today.getMonth(), 1)
        break
      case "lastMonth":
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        end = new Date(today.getFullYear(), today.getMonth(), 0)
        break
      case "custom":
        return // No cambiar fechas para custom
      default:
        start = new Date()
    }

    setStartDate(start)
    setEndDate(end)

    if (value !== "custom") {
      onFilterChange(format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"))
    }
  }

  const handleCustomDateChange = () => {
    if (startDate && endDate) {
      onFilterChange(format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd"))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/50 rounded-lg mb-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Periodo:</span>
        <Select value={preset} onValueChange={(value) => applyPreset(value as PresetRange)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Seleccionar periodo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoy</SelectItem>
            <SelectItem value="yesterday">Ayer</SelectItem>
            <SelectItem value="last7days">Últimos 7 días</SelectItem>
            <SelectItem value="last30days">Últimos 30 días</SelectItem>
            <SelectItem value="thisMonth">Este mes</SelectItem>
            <SelectItem value="lastMonth">Mes anterior</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Desde:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-[140px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? format(startDate, "dd/MM/yyyy", { locale: es }) : "Inicio"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={startDate} onSelect={setStartDate} locale={es} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Hasta:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-[140px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, "dd/MM/yyyy", { locale: es }) : "Fin"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={endDate} onSelect={setEndDate} locale={es} />
              </PopoverContent>
            </Popover>
          </div>

          <Button onClick={handleCustomDateChange} size="sm">
            Aplicar
          </Button>
        </>
      )}

      {startDate && endDate && (
        <div className="ml-auto text-sm text-muted-foreground">
          {format(startDate, "dd MMM yyyy", { locale: es })} - {format(endDate, "dd MMM yyyy", { locale: es })}
        </div>
      )}
    </div>
  )
}
