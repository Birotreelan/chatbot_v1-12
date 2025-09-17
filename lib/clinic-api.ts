import { logError } from "./monitoring"

interface ClinicApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

interface Paciente {
  id: string
  nombre: string
  apellido: string
  dni: string
  telefono?: string
  email?: string
  fechaNacimiento?: string
}

interface Sede {
  id: string
  nombre: string
  direccion?: string
  telefono?: string
  activa: boolean
}

interface Turno {
  id: string
  fecha: string
  hora: string
  pacienteId: string
  pacienteNombre: string
  sedeId: string
  sedeNombre: string
  profesionalId?: string
  profesionalNombre?: string
  estado: string
  observaciones?: string
}

interface CrearTurnoRequest {
  pacienteId: string
  sedeId: string
  fecha: string
  hora: string
  profesionalId?: string
  observaciones?: string
}

// Función para validar DNI
export function validateDNI(dni: string): boolean {
  // Remover espacios y guiones
  const cleanDNI = dni.replace(/[\s-]/g, "")

  // Verificar que solo contenga números y tenga entre 7 y 8 dígitos
  const dniRegex = /^\d{7,8}$/
  return dniRegex.test(cleanDNI)
}

// Función para buscar paciente por DNI
export async function buscarPaciente(clienteId: string, dni: string): Promise<ClinicApiResponse<Paciente>> {
  console.log(`[CLINIC-API] 🔍 Buscando paciente con DNI: ${dni} para cliente: ${clienteId}`)

  try {
    // Validar DNI
    if (!validateDNI(dni)) {
      return {
        success: false,
        error: "DNI inválido. Debe contener entre 7 y 8 dígitos numéricos.",
      }
    }

    const cleanDNI = dni.replace(/[\s-]/g, "")

    // Usar la URL del proxy si está configurada
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${baseUrl}/api/pacientes/buscar`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
      },
      body: JSON.stringify({
        dni: cleanDNI,
      }),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[CLINIC-API] ❌ Error buscando paciente:`, responseData)
      return {
        success: false,
        error: responseData.message || `Error ${response.status}`,
      }
    }

    console.log(`[CLINIC-API] ✅ Paciente encontrado:`, responseData.data?.nombre)
    return {
      success: true,
      data: responseData.data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error buscando paciente:`, error)
    await logError("clinic_buscar_paciente", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: "Error interno del servidor",
    }
  }
}

// Función para obtener sedes
export async function getSedes(clienteId: string, sedeId?: string): Promise<ClinicApiResponse<Sede[]>> {
  console.log(`[CLINIC-API] 🏥 Obteniendo sedes para cliente: ${clienteId}`)

  try {
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      throw new Error("URL del proxy no configurada")
    }

    let url = `${baseUrl}/api/sedes`
    if (sedeId) {
      url += `/${sedeId}`
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
      },
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[CLINIC-API] ❌ Error obteniendo sedes:`, responseData)
      return {
        success: false,
        error: responseData.message || `Error ${response.status}`,
      }
    }

    console.log(`[CLINIC-API] ✅ Sedes obtenidas:`, responseData.data?.length || 1)
    return {
      success: true,
      data: sedeId ? [responseData.data] : responseData.data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error obteniendo sedes:`, error)
    await logError("clinic_get_sedes", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: "Error interno del servidor",
    }
  }
}

// Función para buscar turnos
export async function searchTurnos(
  clienteId: string,
  sedeId: string,
  fechaDesde: string,
  fechaHasta?: string,
  pacienteId?: string,
): Promise<ClinicApiResponse<Turno[]>> {
  console.log(`[CLINIC-API] 📅 Buscando turnos para cliente: ${clienteId}, sede: ${sedeId}`)

  try {
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${baseUrl}/api/turnos/buscar`

    const body: any = {
      sedeId,
      fechaDesde,
    }

    if (fechaHasta) {
      body.fechaHasta = fechaHasta
    }

    if (pacienteId) {
      body.pacienteId = pacienteId
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
      },
      body: JSON.stringify(body),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[CLINIC-API] ❌ Error buscando turnos:`, responseData)
      return {
        success: false,
        error: responseData.message || `Error ${response.status}`,
      }
    }

    console.log(`[CLINIC-API] ✅ Turnos encontrados:`, responseData.data?.length || 0)
    return {
      success: true,
      data: responseData.data || [],
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error buscando turnos:`, error)
    await logError("clinic_search_turnos", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: "Error interno del servidor",
    }
  }
}

// Función para reservar turno
export async function reserveTurno(clienteId: string, turnoData: CrearTurnoRequest): Promise<ClinicApiResponse<Turno>> {
  console.log(`[CLINIC-API] 📝 Reservando turno para cliente: ${clienteId}`)

  try {
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${baseUrl}/api/turnos/crear`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
      },
      body: JSON.stringify(turnoData),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[CLINIC-API] ❌ Error reservando turno:`, responseData)
      return {
        success: false,
        error: responseData.message || `Error ${response.status}`,
      }
    }

    console.log(`[CLINIC-API] ✅ Turno reservado:`, responseData.data?.id)
    return {
      success: true,
      data: responseData.data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error reservando turno:`, error)
    await logError("clinic_reserve_turno", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: "Error interno del servidor",
    }
  }
}

// Función para obtener turnos disponibles
export async function getTurnosDisponibles(
  clienteId: string,
  sedeId: string,
  fecha: string,
  profesionalId?: string,
): Promise<ClinicApiResponse<string[]>> {
  console.log(`[CLINIC-API] ⏰ Obteniendo turnos disponibles para fecha: ${fecha}`)

  try {
    const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
    if (!baseUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${baseUrl}/api/turnos/disponibles`

    const body: any = {
      sedeId,
      fecha,
    }

    if (profesionalId) {
      body.profesionalId = profesionalId
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
      },
      body: JSON.stringify(body),
    })

    const responseData = await response.json()

    if (!response.ok) {
      console.error(`[CLINIC-API] ❌ Error obteniendo turnos disponibles:`, responseData)
      return {
        success: false,
        error: responseData.message || `Error ${response.status}`,
      }
    }

    console.log(`[CLINIC-API] ✅ Turnos disponibles:`, responseData.data?.length || 0)
    return {
      success: true,
      data: responseData.data || [],
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error obteniendo turnos disponibles:`, error)
    await logError("clinic_get_turnos_disponibles", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: "Error interno del servidor",
    }
  }
}

// Aliases para compatibilidad con el código existente
export const getTurnos = searchTurnos
export const crearTurno = reserveTurno
