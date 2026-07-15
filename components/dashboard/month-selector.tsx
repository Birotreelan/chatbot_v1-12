"use client"

import { useMemo } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface MonthSelectorProps {
  value: string // formato "YYYY-MM"
  onChange: (value: string) => void
  monthsBack?: number
}

const NOMBRES_MES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

export function getCurrentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

/** Convierte "YYYY-MM" en { fechaInicio, fechaFin } del mes (formato "YYYY-MM-DD") */
export function monthValueToRange(value: string): { fechaInicio: string; fechaFin: string } {
  const [year, month] = value.split("-").map(Number)
  const fechaInicio = `${year}-${String(month).padStart(2, "0")}-01`
  const ultimoDia = new Date(year, month, 0).getDate()
  const fechaFin = `${year}-${String(month).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`
  return { fechaInicio, fechaFin }
}

export function MonthSelector({ value, onChange, monthsBack = 12 }: MonthSelectorProps) {
  const opciones = useMemo(() => {
    const now = new Date()
    const opts: { value: string; label: string }[] = []
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      opts.push({ value: val, label: `${NOMBRES_MES[d.getMonth()]} ${d.getFullYear()}` })
    }
    return opts
  }, [monthsBack])

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground">Período:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
