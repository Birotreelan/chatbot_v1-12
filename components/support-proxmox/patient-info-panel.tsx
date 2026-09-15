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
  const [datosNoDisponibles, setDatosNoDisponibles] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<number>(0)
  const { getAuthHeaders, sessionId: ssoSessionId } = useSession()

  const fetchPatientData = useCallback(async () => {
    // Cache de 2 minutos para evitar llamadas innecesarias.
    //
    // 15/9/2026: la condición exigía además `patient !== null`. Con el efecto
    // dependiendo de esta función, un paciente NO encontrado (patient = null, que
    // es un resultado válido y frecuente: gente que escribe por primera vez)
    // dejaba la guarda siempre en falso y la carga se repetía sin fin. El corte
    // tiene que ser sólo temporal, que es lo que un caché de 2 minutos significa.
    const now = Date.now()
    if (lastFetch > 0 && now - lastFetch < 120000) {
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
        // 15/9/2026: antes se tiraba un Error genérico y se perdía el status, así
        // que desde el panel era imposible distinguir un 401 (sesión) de un 500
        // (backend) — y había que adivinar. El detalle va al mensaje y a la
        // consola: el agente ve algo accionable y nosotros vemos la causa.
        let detalle = ""
        try {
          const cuerpo = await response.json()
          detalle = cuerpo?.error || ""
        } catch {
          /* la respuesta no era JSON */
        }
        console.error("[PATIENT-PANEL] Fallo la carga", { status: response.status, detalle })

        if (response.status === 401) {
          throw new Error("Tu sesión expiró. Recargá la página para volver a entrar.")
        }
        throw new Error(
          detalle
            ? `No se pudieron cargar los datos del paciente: ${detalle}`
            : `No se pudieron cargar los datos del paciente (error ${response.status}).`,
        )
      }

      const data = await response.json()
      
      if (data.success) {
        setPatient(data.patient)
        setAppointments(data.upcomingAppointments || [])
        setIsNewPatient(data.isNewPatient || (!data.patient && !data.datosNoDisponibles))
        setDatosNoDisponibles(!!data.datosNoDisponibles)
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
    // 15/9/2026: `ssoSessionId` y `getAuthHeaders` faltaban en las dependencias.
    // Como el efecto de abajo dispara la carga apenas monta el componente, la
    // función quedaba capturada con el valor INICIAL de ssoSessionId — que puede
    // ser null mientras el SessionProvider todavía lo está resolviendo. Si en ese
    // momento la cookie tampoco viaja (iframe de terceros en Chrome), la request
    // salía sin ninguna credencial y volvía 401.
  }, [sessionId, lastFetch, ssoSessionId, getAuthHeaders])

  useEffect(() => {
    fetchPatientData()
  }, [sessionId, fetchPatientData])

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

  // No pudimos consultar al sistema de la clínica (15/9/2026). Distinto de
  // "paciente nuevo": mostrarle la ficha de alta al agente cuando en realidad no
  // sabemos nada lo puede llevar a cargar de nuevo a alguien que ya existe.
  if (datosNoDisponibles) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 h-full">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-medium text-amber-800">Datos no disponibles</span>
        </div>
        <p className="text-xs text-amber-700/90">
          No pudimos consultar el sistema de la clínica, así que no sabemos si esta persona está
          registrada. <strong>No asumas que es un paciente nuevo.</strong>
        </p>
        {phoneNumber && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700 mt-2">
            <Phone className="h-3 w-3" />
            <span>{phoneNumber}</span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs mt-3"
          onClick={() => {
            setLastFetch(0)
            fetchPatientData()
          }}
        >
          Reintentar
        </Button>
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
