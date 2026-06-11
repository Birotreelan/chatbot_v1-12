"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  User,
  Phone,
  Mail,
  CreditCard,
  Calendar,
  Clock,
  MapPin,
  UserPlus,
  AlertCircle,
  ExternalLink,
  Search,
  RefreshCw,
} from "lucide-react"

interface PatientData {
  nombre?: string
  apellido?: string
  nombre_completo?: string
  dni?: string
  documento?: string
  telefono?: string
  celular?: string
  email?: string
  mail?: string
  fecha_nacimiento?: string
  obra_social?: string
  plan?: string
  nro_afiliado?: string
  url_paciente?: string
  [key: string]: any
}

interface Appointment {
  id?: string
  fecha?: string
  hora?: string
  profesional?: string
  sede?: string
  motivo?: string
  estado?: string
  url_agenda?: string
}

interface MonitorPatientPanelProps {
  configId: string
  phoneNumber: string
}

type PanelState = "idle" | "loading" | "loaded" | "error" | "new_patient"

export function MonitorPatientPanel({ configId, phoneNumber }: MonitorPatientPanelProps) {
  const [state, setState] = useState<PanelState>("idle")
  const [patient, setPatient] = useState<PatientData | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [phoneResult, setPhoneResult] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function fetchPatientData() {
    setState("loading")
    setErrorMsg(null)

    try {
      const response = await fetch(
        `/api/dashboard/patient?configId=${encodeURIComponent(configId)}&phoneNumber=${encodeURIComponent(phoneNumber)}`,
      )

      if (!response.ok) {
        throw new Error("Error al cargar datos del paciente")
      }

      const data = await response.json()

      if (data.success) {
        setPhoneResult(data.phoneNumber)
        if (data.isNewPatient || !data.patient) {
          setPatient(null)
          setAppointments([])
          setState("new_patient")
        } else {
          setPatient(data.patient)
          setAppointments(data.upcomingAppointments || [])
          setState("loaded")
        }
      } else {
        throw new Error(data.error || "Error desconocido")
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al cargar datos")
      setState("error")
    }
  }

  const getFullName = () => {
    if (patient?.nombre_completo) return patient.nombre_completo
    if (patient?.nombre && patient?.apellido) return `${patient.nombre} ${patient.apellido}`
    if (patient?.nombre) return patient.nombre
    if (patient?.apellido) return patient.apellido
    return null
  }

  const getDocumento = () => patient?.dni || patient?.documento || null
  const getTelefono = () => patient?.celular || patient?.telefono || phoneResult || null
  const getEmail = () => patient?.email || patient?.mail || null

  const formatAppointmentDate = (appointment: Appointment) => {
    if (appointment.fecha) {
      try {
        const date = new Date(appointment.fecha)
        return date.toLocaleDateString("es-AR", { day: "numeric", month: "short" })
      } catch {
        return appointment.fecha
      }
    }
    return "N/D"
  }

  // Estado inicial: solo muestra el botón
  if (state === "idle") {
    return (
      <div className="bg-card border rounded-lg p-3 h-full flex flex-col items-center justify-center gap-2 text-center">
        <User className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">Datos del paciente no cargados</p>
        <Button size="sm" variant="outline" className="text-xs h-7 mt-1" onClick={fetchPatientData}>
          <Search className="h-3 w-3 mr-1.5" />
          Obtener datos de paciente
        </Button>
      </div>
    )
  }

  // Cargando
  if (state === "loading") {
    return (
      <div className="bg-card border rounded-lg p-3 h-full">
        <div className="flex items-center gap-2 mb-3">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium">Paciente</span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    )
  }

  // Error
  if (state === "error") {
    return (
      <div className="bg-card border border-destructive/30 rounded-lg p-3 h-full flex flex-col">
        <div className="flex items-center gap-2 text-destructive mb-2">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-medium">Error</span>
        </div>
        <p className="text-xs text-muted-foreground flex-1">{errorMsg}</p>
        <Button size="sm" variant="outline" className="text-xs h-7 mt-2 w-full" onClick={fetchPatientData}>
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Reintentar
        </Button>
      </div>
    )
  }

  // Paciente nuevo / no encontrado
  if (state === "new_patient") {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 h-full flex flex-col dark:bg-blue-950/20 dark:border-blue-800">
        <div className="flex items-center gap-2 mb-2">
          <UserPlus className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-medium text-blue-800 dark:text-blue-300">Paciente Nuevo</span>
        </div>
        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 mb-2 w-fit dark:bg-blue-900 dark:text-blue-300">
          Sin registro
        </Badge>
        {phoneResult && (
          <div className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400">
            <Phone className="h-3 w-3" />
            <span>{phoneResult}</span>
          </div>
        )}
        <p className="text-xs text-blue-600/80 mt-2 dark:text-blue-400/80 flex-1">Primera vez que se comunica</p>
        <Button size="sm" variant="outline" className="text-xs h-7 mt-2 w-full" onClick={fetchPatientData}>
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Actualizar
        </Button>
      </div>
    )
  }

  // Datos cargados
  return (
    <div className="bg-card border rounded-lg p-3 h-full overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <User className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Paciente</span>
        </div>
        <div className="flex items-center gap-1">
          {patient?.url_paciente && (
            <Button variant="ghost" size="sm" asChild className="h-6 text-xs px-2">
              <a href={patient.url_paciente} target="_blank" rel="noopener noreferrer">
                HC <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={fetchPatientData} title="Actualizar">
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Nombre */}
      {getFullName() && <h3 className="font-semibold text-sm mb-2 leading-tight">{getFullName()}</h3>}

      {/* Info básica */}
      <div className="space-y-1.5 text-xs">
        {getDocumento() && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CreditCard className="h-3 w-3" />
            <span>DNI: {getDocumento()}</span>
          </div>
        )}
        {getTelefono() && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="h-3 w-3" />
            <span>{getTelefono()}</span>
          </div>
        )}
        {getEmail() && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3 w-3" />
            <span className="truncate">{getEmail()}</span>
          </div>
        )}
        {patient?.obra_social && (
          <Badge variant="outline" className="text-xs mt-1">
            {patient.obra_social}
            {patient.plan && ` - ${patient.plan}`}
          </Badge>
        )}
      </div>

      {/* Turnos próximos */}
      {appointments.length > 0 && (
        <div className="mt-3 pt-2 border-t">
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Turnos ({appointments.length})
          </h4>
          <div className="space-y-1.5 max-h-28 overflow-y-auto">
            {appointments.slice(0, 3).map((apt, index) => (
              <div key={apt.id || index} className="p-1.5 bg-muted/50 rounded text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{formatAppointmentDate(apt)}</span>
                  <div className="flex items-center gap-1">
                    {apt.hora && (
                      <span className="text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {apt.hora}
                      </span>
                    )}
                    {apt.url_agenda && (
                      <Button variant="ghost" size="sm" asChild className="h-5 text-xs px-1.5 ml-1">
                        <a href={apt.url_agenda} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-2.5 w-2.5 mr-0.5" />
                          Agenda
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                {apt.profesional && <p className="text-muted-foreground truncate">{apt.profesional}</p>}
                {apt.sede && (
                  <p className="text-muted-foreground/70 flex items-center gap-0.5 truncate">
                    <MapPin className="h-2.5 w-2.5" />
                    {apt.sede}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sin turnos */}
      {appointments.length === 0 && state === "loaded" && (
        <div className="mt-3 pt-2 border-t">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Sin turnos proximos
          </p>
        </div>
      )}
    </div>
  )
}
