"use client"

import { useEffect, useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { User, Phone, Mail, CreditCard, Calendar, Clock, MapPin, UserPlus, AlertCircle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSession } from "./session-provider"

interface PatientData {
  // Campos comunes que puede retornar la API
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
  direccion?: string
  localidad?: string
  provincia?: string
  obra_social?: string
  plan?: string
  nro_afiliado?: string
  url_paciente?: string
  // Campos adicionales que pueden venir
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

interface PatientInfoPanelProps {
  sessionId: string
}

export function PatientInfoPanel({ sessionId }: PatientInfoPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [patient, setPatient] = useState<PatientData | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [isNewPatient, setIsNewPatient] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<number>(0)
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  const fetchPatientData = useCallback(async () => {
    // Cache de 2 minutos para evitar llamadas innecesarias
    const now = Date.now()
    if (now - lastFetch < 120000 && patient !== null) {
      return
    }

    try {
      setLoading(true)
      
      // Construir URL con _sid para Safari fallback
      let url = `/api/support/patient?sessionId=${sessionId}`
      if (ssoSessionId) {
        url += `&_sid=${encodeURIComponent(ssoSessionId)}`
      }
      
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
        },
      })
      
      if (!response.ok) {
        throw new Error("Error al cargar datos del paciente")
      }

      const data = await response.json()
      
      if (data.success) {
        setPatient(data.patient)
        setAppointments(data.upcomingAppointments || [])
        setIsNewPatient(data.isNewPatient || !data.patient)
        setPhoneNumber(data.phoneNumber)
        setLastFetch(now)
        setError(null)
      } else {
        setError(data.error || "Error desconocido")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar datos")
    } finally {
      setLoading(false)
    }
  }, [sessionId, lastFetch, patient])

  useEffect(() => {
    fetchPatientData()
  }, [sessionId]) // Solo recargar cuando cambie el sessionId

  // Formatear nombre completo
  const getFullName = () => {
    if (patient?.nombre_completo) return patient.nombre_completo
    if (patient?.nombre && patient?.apellido) return `${patient.nombre} ${patient.apellido}`
    if (patient?.nombre) return patient.nombre
    if (patient?.apellido) return patient.apellido
    return null
  }

  // Formatear documento
  const getDocumento = () => {
    return patient?.dni || patient?.documento || null
  }

  // Formatear teléfono
  const getTelefono = () => {
    return patient?.celular || patient?.telefono || phoneNumber || null
  }

  // Formatear email
  const getEmail = () => {
    return patient?.email || patient?.mail || null
  }

  // Formatear fecha de turno
  const formatAppointmentDate = (appointment: Appointment) => {
    if (appointment.fecha) {
      try {
        const date = new Date(appointment.fecha)
        return date.toLocaleDateString("es-AR", {
          day: "numeric",
          month: "short",
        })
      } catch {
        return appointment.fecha
      }
    }
    return "N/D"
  }

  if (loading) {
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
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card border border-destructive/30 rounded-lg p-3 h-full">
        <div className="flex items-center gap-2 text-destructive mb-2">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-medium">Error</span>
        </div>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (isNewPatient || !patient) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 h-full">
        <div className="flex items-center gap-2 mb-2">
          <UserPlus className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-medium text-blue-800">Paciente Nuevo</span>
        </div>
        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 mb-2">
          Sin registro
        </Badge>
        {phoneNumber && (
          <div className="flex items-center gap-1.5 text-xs text-blue-700">
            <Phone className="h-3 w-3" />
            <span>{phoneNumber}</span>
          </div>
        )}
        <p className="text-xs text-blue-600/80 mt-2">
          Primera vez que se comunica
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border rounded-lg p-3 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <User className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium">Paciente</span>
        </div>
        {patient.url_paciente && (
          <Button variant="ghost" size="sm" asChild className="h-6 text-xs px-2">
            <a href={patient.url_paciente} target="_blank" rel="noopener noreferrer">
              HC <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        )}
      </div>

      {/* Nombre */}
      {getFullName() && (
        <h3 className="font-semibold text-sm mb-2 leading-tight">{getFullName()}</h3>
      )}

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

        {/* Obra Social */}
        {patient.obra_social && (
          <Badge variant="outline" className="text-xs mt-2">
            {patient.obra_social}
            {patient.plan && ` - ${patient.plan}`}
          </Badge>
        )}
      </div>

      {/* Turnos Próximos */}
      {appointments.length > 0 && (
        <div className="mt-3 pt-2 border-t">
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Turnos ({appointments.length})
          </h4>
          <div className="space-y-1.5 max-h-28 overflow-y-auto">
            {appointments.slice(0, 3).map((apt, index) => (
              <div
                key={apt.id || index}
                className="p-1.5 bg-muted/50 rounded text-xs"
              >
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
                {apt.profesional && (
                  <p className="text-muted-foreground truncate">{apt.profesional}</p>
                )}
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
      {appointments.length === 0 && (
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
