"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Calendar } from "@/components/ui/calendar"
import { es } from "date-fns/locale"
import { CalendarDays, ChevronLeft, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react"

interface WidgetFormProps {
  clienteId: string
  hideHeader?: boolean
}

interface FormOption {
  id: string
  label: string
  description?: string
}

interface FormTurno {
  numero: number
  fecha: string
  hora: string
  profesionalNombre: string
  especialidad?: string
  sedeNombre?: string
}

interface FormSummary {
  dni?: string
  nombreCompleto?: string
  obraSocial?: string
  sede?: string
  turno?: { fecha: string; hora: string; profesionalNombre: string; sedeNombre?: string }
  email?: string
  telefono?: string
}

type FormInputType =
  | "dni"
  | "text"
  | "email"
  | "tel"
  | "select"
  | "search-type"
  | "turno-picker"
  | "confirmation"
  | "info"

interface FormStep {
  phase: string
  done: boolean
  success?: boolean
  message: string
  inputType: FormInputType
  fieldLabel?: string
  placeholder?: string
  options?: FormOption[]
  turnos?: FormTurno[]
  summary?: FormSummary
  canGoBack?: boolean
}

function newSessionId() {
  return `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function formatYMD(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatDateLabel(fecha: string): string {
  const date = parseYMD(fecha)
  const label = date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 text-right">{value}</span>
    </div>
  )
}

export function WidgetForm({ clienteId, hideHeader = false }: WidgetFormProps) {
  const [sessionId, setSessionId] = useState("")
  const [step, setStep] = useState<FormStep | null>(null)
  const [loading, setLoading] = useState(true)
  const [networkError, setNetworkError] = useState(false)
  const [isEmbedded, setIsEmbedded] = useState(false)
  const [widgetConfig, setWidgetConfig] = useState<any>(null)

  const [textValue, setTextValue] = useState("")
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState<Date | undefined>(undefined)

  const lastMessageRef = useRef<string>("")
  const lastInitRef = useRef<boolean>(false)

  const title = widgetConfig?.widgetTitle || "Agendar turno"
  const subtitle = widgetConfig?.widgetSubtitle || "Completá los datos paso a paso"

  // ── Inicialización ─────────────────────────────────────────────────────
  useEffect(() => {
    setSessionId(newSessionId())
    if (typeof window !== "undefined") {
      setIsEmbedded(window.self !== window.top)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/widget?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setWidgetConfig(data)
      })
      .catch((error) => console.error("[WIDGET-FORM] Error obteniendo configuración:", error))
    return () => {
      cancelled = true
    }
  }, [clienteId])

  const callApi = useCallback(
    async (message: string, init = false) => {
      if (!sessionId) return
      lastMessageRef.current = message
      lastInitRef.current = init
      setLoading(true)
      setNetworkError(false)
      try {
        const res = await fetch("/api/widget-form", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cliente_id: clienteId, session_id: sessionId, message, init }),
        })
        const data = await res.json()
        if (data.success && data.step) {
          setStep(data.step)
          setTextValue("")
          setSelectedDate(null)
        } else {
          setNetworkError(true)
        }
      } catch (error) {
        console.error("[WIDGET-FORM] Error de red:", error)
        setNetworkError(true)
      } finally {
        setLoading(false)
      }
    },
    [clienteId, sessionId],
  )

  // Primer paso, apenas tenemos sessionId (o de nuevo, si se reinicia la conversación)
  useEffect(() => {
    if (sessionId) callApi("", true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Auto-seleccionar la fecha más próxima al entrar al paso de turnos
  useEffect(() => {
    if (step?.inputType === "turno-picker" && step.turnos && step.turnos.length > 0 && !selectedDate) {
      setSelectedDate(step.turnos[0].fecha)
    }
  }, [step, selectedDate])

  useEffect(() => {
    if (selectedDate) setCalendarMonth(parseYMD(selectedDate))
  }, [selectedDate])

  const availableDates = useMemo(() => {
    return new Set((step?.turnos || []).map((t) => t.fecha))
  }, [step])

  const turnosDelDia = useMemo(() => {
    if (!step?.turnos || !selectedDate) return []
    return step.turnos.filter((t) => t.fecha === selectedDate)
  }, [step, selectedDate])

  const mostrarProfesionalPorTurno = useMemo(() => {
    return new Set(turnosDelDia.map((t) => t.profesionalNombre)).size > 1
  }, [turnosDelDia])

  const handleClose = () => {
    try {
      window.parent.postMessage({ source: "iris-widget", type: "close" }, "*")
    } catch (error) {
      console.error("[WIDGET-FORM] Error al enviar mensaje de cierre:", error)
    }
  }

  const handleRestart = () => {
    setStep(null)
    setTextValue("")
    setSelectedDate(null)
    setSessionId(newSessionId())
  }

  const handleTextChange = (raw: string) => {
    if (step?.inputType === "dni" || step?.inputType === "tel") {
      setTextValue(raw.replace(/[^\d]/g, ""))
    } else {
      setTextValue(raw)
    }
  }

  const handleTextSubmit = () => {
    if (!textValue.trim() || loading) return
    callApi(textValue.trim())
  }

  const handleRetry = () => {
    callApi(lastMessageRef.current, lastInitRef.current)
  }

  function renderControl() {
    if (!step) return null

    switch (step.inputType) {
      case "dni":
      case "text":
      case "email":
      case "tel":
        return (
          <div className="space-y-3">
            {step.fieldLabel && <label className="block text-sm font-medium text-gray-700">{step.fieldLabel}</label>}
            <input
              type={step.inputType === "dni" ? "text" : step.inputType}
              inputMode={step.inputType === "dni" || step.inputType === "tel" ? "numeric" : undefined}
              value={textValue}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTextSubmit()
              }}
              placeholder={step.placeholder}
              disabled={loading}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-sky-500 focus:ring-2 focus:ring-sky-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textValue.trim() || loading}
              className="w-full rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium py-3 transition-colors disabled:opacity-50"
            >
              Continuar
            </button>
          </div>
        )

      case "select":
      case "search-type":
        return (
          <div className="space-y-2">
            {step.options?.map((opt) => (
              <button
                key={opt.id}
                onClick={() => callApi(opt.id)}
                disabled={loading}
                className="w-full text-left rounded-lg border border-gray-200 hover:border-sky-400 hover:bg-sky-50 px-4 py-3 transition-colors disabled:opacity-50"
              >
                <div className="font-medium text-gray-800">{opt.label}</div>
                {opt.description && <div className="text-sm text-gray-500 mt-0.5">{opt.description}</div>}
              </button>
            ))}
          </div>
        )

      case "turno-picker":
        return (
          <div>
            <div className="rounded-lg border border-gray-200 bg-white flex justify-center">
              <Calendar
                mode="single"
                locale={es}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                selected={selectedDate ? parseYMD(selectedDate) : undefined}
                onSelect={(date) => date && setSelectedDate(formatYMD(date))}
                disabled={(date) => !availableDates.has(formatYMD(date))}
              />
            </div>
            {selectedDate && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">{formatDateLabel(selectedDate)}</p>
                {turnosDelDia.length === 0 ? (
                  <p className="text-sm text-gray-500">No hay horarios para este día.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {turnosDelDia.map((t) => (
                      <button
                        key={t.numero}
                        onClick={() => callApi(String(t.numero))}
                        disabled={loading}
                        className="rounded-lg border border-gray-200 hover:border-sky-400 hover:bg-sky-50 py-2 px-1 text-sm font-medium text-gray-800 transition-colors disabled:opacity-50"
                      >
                        {t.hora}
                        {mostrarProfesionalPorTurno && (
                          <div className="text-xs text-gray-500 font-normal truncate">{t.profesionalNombre}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )

      case "confirmation":
        return (
          <div className="space-y-4">
            {step.summary && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm">
                {step.summary.nombreCompleto && <SummaryRow label="Nombre" value={step.summary.nombreCompleto} />}
                {step.summary.dni && <SummaryRow label="DNI" value={step.summary.dni} />}
                {step.summary.obraSocial && <SummaryRow label="Obra social" value={step.summary.obraSocial} />}
                {step.summary.turno && (
                  <>
                    <SummaryRow label="Fecha" value={formatDateLabel(step.summary.turno.fecha)} />
                    <SummaryRow label="Hora" value={step.summary.turno.hora} />
                    <SummaryRow label="Profesional" value={`Dr. ${step.summary.turno.profesionalNombre}`} />
                  </>
                )}
                {step.summary.sede && <SummaryRow label="Sede" value={step.summary.sede} />}
                {step.summary.email && <SummaryRow label="Email" value={step.summary.email} />}
                {step.summary.telefono && <SummaryRow label="WhatsApp" value={step.summary.telefono} />}
              </div>
            )}
            <div className="space-y-2">
              {step.options?.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => callApi(opt.id)}
                  disabled={loading}
                  className={
                    opt.id === "1"
                      ? "w-full rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium py-3 transition-colors disabled:opacity-50"
                      : "w-full rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 transition-colors disabled:opacity-50"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )

      case "info":
        return (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            {step.success ? (
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            ) : (
              <AlertCircle className="h-12 w-12 text-orange-500" />
            )}
            <button onClick={handleRestart} className="mt-2 text-sm text-sky-600 hover:underline">
              Iniciar una nueva consulta
            </button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {!hideHeader && (
        <div
          className="bg-sky-600 text-white p-4 flex items-center justify-between gap-3 flex-shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <CalendarDays className="h-6 w-6 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-lg truncate">{title}</h3>
              <p className="text-sm opacity-90 truncate">{subtitle}</p>
            </div>
          </div>
          {isEmbedded && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar"
              className="shrink-0 rounded-full p-2 -mr-1 hover:bg-white/20 active:bg-white/30 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        {!step ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {step.canGoBack && (
              <button
                onClick={() => callApi("0")}
                disabled={loading}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Volver
              </button>
            )}

            <p className="text-base font-medium text-gray-800 whitespace-pre-wrap">{step.message}</p>

            {renderControl()}

            {loading && step.inputType !== "info" && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Enviando...
              </div>
            )}

            {networkError && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3 flex items-center justify-between gap-3">
                <span>Ocurrió un error de conexión.</span>
                <button onClick={handleRetry} className="underline font-medium shrink-0">
                  Reintentar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default WidgetForm
