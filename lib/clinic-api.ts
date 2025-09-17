import { logError } from "./monitoring"

// Interfaces para las respuestas de la API
interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

interface Paciente {
  Id: string
  Nombres: string
  Apellido: string
  Nrodoc: string
  Celular: string
  Mail: string
  Fecha_Nac: string
  Deudor_Nombre: string
  Plan_Nombre: string
  Nro_Afiliado_Ppal: string
}

interface Sede {
  Id: string
  Nombre: string
  Direccion: string
  Telefono?: string
  Email?: string
}

interface Turno {
  Id: string
  Fecha: string
  Hora: string
  Profesional_Nombre: string
  Centro_Nombre: string
  Motivo_Nombre: string
  Agenda_Id: string
}

interface TurnoDisponible {
  Agenda_Id: string
  Fecha: string
  Hora: string
  Profesional_Nombre: string
  Especialidad: string
  Centro_Nombre: string
}

// Configuración de la API
const DEFAULT_PROXY_URL = process.env.CLINIC_PROXY_URL || "https://treelan.net/managment/proxy_service/"

// Función auxiliar para hacer peticiones a la API
async function makeApiRequest<T>(
  clienteId: string,
  action: string,
  additionalParams: Record<string, any> = {},
  proxyUrl: string = DEFAULT_PROXY_URL,
): Promise<ApiResponse<T>> {
  console.log(`[CLINIC-API] 🔧 ${action} para cliente: ${clienteId}`)
  console.log(`[CLINIC-API] 📦 Parámetros:`, additionalParams)

  try {
    const requestBody = {
      Cliente_Id: clienteId.trim(),
      Action: action,
      ...additionalParams,
    }

    console.log(`[CLINIC-API] 📤 POST ${proxyUrl}`)
    console.log(`[CLINIC-API] 📦 Body:`, JSON.stringify(requestBody, null, 2))

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 segundos timeout
    })

    const responseText = await response.text()
    console.log(`[CLINIC-API] 📥 Response Status: ${response.status}`)
    console.log(
      `[CLINIC-API] 📥 Response Body: ${responseText.substring(0, 500)}${responseText.length > 500 ? "..." : ""}`,
    )

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    console.log(`[CLINIC-API] ✅ ${action} completado exitosamente`)
    return {
      success: true,
      data: data,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[CLINIC-API] ❌ Error en ${action}:`, errorMessage)

    await logError(`clinic_api_${action}`, error instanceof Error ? error : new Error(errorMessage))

    return {
      success: false,
      error: errorMessage,
    }
  }
}

// Función para validar DNI
export async function validateDNI(
  clienteId: string,
  dni: string,
): Promise<ApiResponse<{ paciente: Paciente | null; es_nuevo: boolean }>> {
  console.log(`[CLINIC-API] 🆔 Validando DNI: ${dni}`)

  const result = await makeApiRequest<any>(clienteId, "get_paciente", { dni })

  if (!result.success) {
    return result
  }

  const data = result.data

  if (data.paciente) {
    return {
      success: true,
      data: {
        paciente: data.paciente,
        es_nuevo: false,
      },
    }
  } else {
    return {
      success: true,
      data: {
        paciente: null,
        es_nuevo: true,
      },
    }
  }
}

// Función para buscar paciente por DNI
export async function buscarPaciente(clienteId: string, dni: string): Promise<ApiResponse<Paciente | null>> {
  console.log(`[CLINIC-API] 👤 Buscando paciente con DNI: ${dni}`)

  const result = await makeApiRequest<any>(clienteId, "get_paciente", { dni })

  if (!result.success) {
    return result
  }

  return {
    success: true,
    data: result.data?.paciente || null,
  }
}

// Función para obtener sedes
export async function getSedes(clienteId: string, sedeId?: string): Promise<ApiResponse<Sede[]>> {
  console.log(`[CLINIC-API] 🏥 Obteniendo sedes${sedeId ? ` para sede: ${sedeId}` : ""}`)

  const params = sedeId ? { sede_id: sedeId } : {}
  const result = await makeApiRequest<any>(clienteId, "get_sedes", params)

  if (!result.success) {
    return result
  }

  const sedes = result.data?.sedes || result.data || []

  return {
    success: true,
    data: Array.isArray(sedes) ? sedes : [sedes],
  }
}

// Función para buscar turnos disponibles
export async function searchTurnos(
  clienteId: string,
  sedeId?: string,
  fechaDesde?: string,
  fechaHasta?: string,
  profesionalId?: string,
  especialidadId?: string,
): Promise<ApiResponse<TurnoDisponible[]>> {
  console.log(`[CLINIC-API] 📅 Buscando turnos disponibles`)

  const params: Record<string, any> = {}

  if (sedeId) params.sede_id = sedeId
  if (fechaDesde) params.Fecha_Desde = fechaDesde
  if (fechaHasta) params.Fecha_Hasta = fechaHasta
  if (profesionalId) params.Profesional_Id = profesionalId
  if (especialidadId) params.Subespecialidad_Id = especialidadId

  // Si no se especifican fechas, usar rango por defecto
  if (!fechaDesde && !fechaHasta) {
    const hoy = new Date()
    const unMesDespues = new Date(hoy)
    unMesDespues.setMonth(unMesDespues.getMonth() + 1)

    params.Fecha_Desde = hoy.toISOString().split("T")[0]
    params.Fecha_Hasta = unMesDespues.toISOString().split("T")[0]
  }

  const result = await makeApiRequest<any>(clienteId, "get_turnos", params)

  if (!result.success) {
    return result
  }

  const turnos = result.data?.turnos || result.data || []

  return {
    success: true,
    data: Array.isArray(turnos) ? turnos : [],
  }
}

// Función para reservar turno
export async function reserveTurno(
  clienteId: string,
  turnoData: {
    Agenda_Id: string
    Paciente_DNI: string
    Paciente_Nombre: string
    Paciente_Apellido: string
    Paciente_Telefono: string
    Paciente_Email: string
    Fecha?: string
    Hora?: string
    Profesional_Nombre?: string
  },
): Promise<ApiResponse<{ confirmacion: string }>> {
  console.log(`[CLINIC-API] 📝 Reservando turno para DNI: ${turnoData.Paciente_DNI}`)

  const result = await makeApiRequest<any>(clienteId, "set_turno", turnoData)

  if (!result.success) {
    return result
  }

  return {
    success: true,
    data: {
      confirmacion: result.data?.confirmacion || "Turno reservado exitosamente",
    },
  }
}

// Función para obtener turnos próximos de un paciente
export async function getTurnosProximos(clienteId: string, dni: string): Promise<ApiResponse<Turno[]>> {
  console.log(`[CLINIC-API] 📋 Obteniendo turnos próximos para DNI: ${dni}`)

  const result = await makeApiRequest<any>(clienteId, "get_paciente", { dni })

  if (!result.success) {
    return result
  }

  const turnos = result.data?.turnos_proximos || []

  return {
    success: true,
    data: Array.isArray(turnos) ? turnos : [],
  }
}

// Función para obtener especialidades
export async function getEspecialidades(clienteId: string): Promise<ApiResponse<any[]>> {
  console.log(`[CLINIC-API] 🩺 Obteniendo especialidades`)

  const result = await makeApiRequest<any>(clienteId, "get_subespecialidades")

  if (!result.success) {
    return result
  }

  const especialidades = result.data?.subespecialidades || result.data || []

  return {
    success: true,
    data: Array.isArray(especialidades) ? especialidades : [],
  }
}

// Función para buscar profesionales
export async function buscarProfesionales(clienteId: string, busqueda: string): Promise<ApiResponse<any[]>> {
  console.log(`[CLINIC-API] 👨‍⚕️ Buscando profesionales: ${busqueda}`)

  const result = await makeApiRequest<any>(clienteId, "get_profesionales", { busqueda })

  if (!result.success) {
    return result
  }

  const profesionales = result.data?.profesionales || result.data || []

  return {
    success: true,
    data: Array.isArray(profesionales) ? profesionales : [],
  }
}

// Función para validar obra social
export async function validarObraSocial(clienteId: string, busqueda: string): Promise<ApiResponse<any[]>> {
  console.log(`[CLINIC-API] 🏥 Validando obra social: ${busqueda}`)

  const result = await makeApiRequest<any>(clienteId, "get_obras_sociales", { busqueda })

  if (!result.success) {
    return result
  }

  const obrasSociales = result.data?.obras_sociales || result.data || []

  return {
    success: true,
    data: Array.isArray(obrasSociales) ? obrasSociales : [],
  }
}

// Aliases para compatibilidad con el código existente
export const getTurnos = searchTurnos
export const crearTurno = reserveTurno
export const getTurnosDisponibles = searchTurnos
export const getSubespecialidades = getEspecialidades
