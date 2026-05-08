"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { User, Phone, Mail, CreditCard, Calendar, Clock, MapPin, UserPlus, AlertCircle } from "lucide-react"

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

  const fetchPatientData = useCallback(async () => {
    // Cache de 2 minutos para evitar llamadas innecesarias
    const now = Date.now()
    if (now - lastFetch < 120000 && patient !== null) {
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/support/patient?sessionId=${sessionId}`, {
        credentials: "include",
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
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      } catch {
        return appointment.fecha
      }
    }
    return "Fecha no disponible"
  }

  if (loading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Datos del Paciente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="pt-4">
            <Skeleton className="h-5 w-1/3 mb-2" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="h-full border-destructive/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (isNewPatient || !patient) {
    return (
      <Card className="h-full border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Paciente Nuevo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            Sin registro previo
          </Badge>
          
          {phoneNumber && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{phoneNumber}</span>
            </div>
          )}
          
          <p className="text-sm text-muted-foreground">
            Este paciente no tiene registros en el sistema. Es la primera vez que se comunica o su numero no esta asociado a ningun paciente.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <User className="h-5 w-5" />
          Datos del Paciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Nombre */}
        {getFullName() && (
          <div>
            <h3 className="font-semibold text-lg">{getFullName()}</h3>
          </div>
        )}

        {/* Documento */}
        {getDocumento() && (
          <div className="flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span>DNI: {getDocumento()}</span>
          </div>
        )}

        {/* Teléfono */}
        {getTelefono() && (
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span>{getTelefono()}</span>
          </div>
        )}

        {/* Email */}
        {getEmail() && (
          <div className="flex items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{getEmail()}</span>
          </div>
        )}

        {/* Obra Social */}
        {patient.obra_social && (
          <div className="pt-2">
            <Badge variant="outline" className="text-xs">
              {patient.obra_social}
              {patient.plan && ` - ${patient.plan}`}
            </Badge>
          </div>
        )}

        {/* Turnos Próximos */}
        {appointments.length > 0 && (
          <div className="pt-4 border-t">
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Turnos Proximos ({appointments.length})
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {appointments.map((apt, index) => (
                <div
                  key={apt.id || index}
                  className="p-2 bg-muted/50 rounded-md text-sm space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatAppointmentDate(apt)}</span>
                    {apt.hora && (
                      <span className="flex items-center gap-1 text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3" />
                        {apt.hora}
                      </span>
                    )}
                  </div>
                  {apt.profesional && (
                    <p className="text-muted-foreground">{apt.profesional}</p>
                  )}
                  {apt.motivo && (
                    <p className="text-xs text-muted-foreground">{apt.motivo}</p>
                  )}
                  {apt.sede && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {apt.sede}
                    </p>
                  )}
                  {apt.estado && (
                    <Badge variant="outline" className="text-xs py-0 h-5">
                      {apt.estado}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sin turnos */}
        {appointments.length === 0 && (
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Sin turnos proximos
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
