"use client"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Plus, Trash2 } from "lucide-react"
import type { DaySchedule, TimePeriod } from "@/lib/types"

interface ScheduleConfiguratorProps {
  schedule: DaySchedule[]
  onChange: (schedule: DaySchedule[]) => void
  label?: string
  description?: string
}

const DAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
]

export function ScheduleConfigurator({ schedule, onChange, label, description }: ScheduleConfiguratorProps) {
  const getDaySchedule = (dayOfWeek: number): DaySchedule => {
    return (
      schedule.find((s) => s.dayOfWeek === dayOfWeek) || {
        dayOfWeek,
        enabled: false,
        periods: [],
      }
    )
  }

  const updateDaySchedule = (dayOfWeek: number, updates: Partial<DaySchedule>) => {
    const newSchedule = [...schedule]
    const index = newSchedule.findIndex((s) => s.dayOfWeek === dayOfWeek)

    if (index >= 0) {
      newSchedule[index] = { ...newSchedule[index], ...updates }
    } else {
      newSchedule.push({
        dayOfWeek,
        enabled: false,
        periods: [],
        ...updates,
      })
    }

    onChange(newSchedule)
  }

  const toggleDay = (dayOfWeek: number, enabled: boolean) => {
    const daySchedule = getDaySchedule(dayOfWeek)
    updateDaySchedule(dayOfWeek, {
      enabled,
      periods:
        enabled && daySchedule.periods.length === 0 ? [{ startTime: "09:00", endTime: "18:00" }] : daySchedule.periods,
    })
  }

  const addPeriod = (dayOfWeek: number) => {
    const daySchedule = getDaySchedule(dayOfWeek)
    const newPeriod: TimePeriod = { startTime: "09:00", endTime: "18:00" }
    updateDaySchedule(dayOfWeek, {
      periods: [...daySchedule.periods, newPeriod],
    })
  }

  const updatePeriod = (dayOfWeek: number, periodIndex: number, field: keyof TimePeriod, value: string) => {
    const daySchedule = getDaySchedule(dayOfWeek)
    const newPeriods = [...daySchedule.periods]
    newPeriods[periodIndex] = { ...newPeriods[periodIndex], [field]: value }
    updateDaySchedule(dayOfWeek, { periods: newPeriods })
  }

  const removePeriod = (dayOfWeek: number, periodIndex: number) => {
    const daySchedule = getDaySchedule(dayOfWeek)
    const newPeriods = daySchedule.periods.filter((_, i) => i !== periodIndex)
    updateDaySchedule(dayOfWeek, { periods: newPeriods })
  }

  return (
    <div className="space-y-4">
      {label && <Label className="text-base font-semibold">{label}</Label>}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      <div className="space-y-3">
        {DAYS.map((day) => {
          const daySchedule = getDaySchedule(day.value)

          return (
            <Card key={day.value} className={!daySchedule.enabled ? "opacity-60" : ""}>
              <CardContent className="pt-4 pb-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Switch
                        id={`day-${day.value}`}
                        checked={daySchedule.enabled}
                        onCheckedChange={(checked) => toggleDay(day.value, checked)}
                      />
                      <Label htmlFor={`day-${day.value}`} className="font-medium cursor-pointer">
                        {day.label}
                      </Label>
                    </div>

                    {daySchedule.enabled && (
                      <Button type="button" size="sm" variant="outline" onClick={() => addPeriod(day.value)}>
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar período
                      </Button>
                    )}
                  </div>

                  {daySchedule.enabled && daySchedule.periods.length > 0 && (
                    <div className="space-y-2 pl-10">
                      {daySchedule.periods.map((period, periodIndex) => (
                        <div key={periodIndex} className="flex items-center gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <Input
                              type="time"
                              value={period.startTime}
                              onChange={(e) => updatePeriod(day.value, periodIndex, "startTime", e.target.value)}
                              className="w-32"
                            />
                            <span className="text-muted-foreground">a</span>
                            <Input
                              type="time"
                              value={period.endTime}
                              onChange={(e) => updatePeriod(day.value, periodIndex, "endTime", e.target.value)}
                              className="w-32"
                            />
                          </div>

                          {daySchedule.periods.length > 1 && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => removePeriod(day.value, periodIndex)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {daySchedule.enabled && daySchedule.periods.length === 0 && (
                    <p className="text-sm text-muted-foreground pl-10">No hay períodos configurados</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
