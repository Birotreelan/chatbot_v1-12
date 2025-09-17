import { logError } from "./monitoring"

const PROXY_URL = process.env.CLINIC_PROXY_URL || "https://treelan.net/managment/proxy_service/"

interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

interface Sede {
  Id: string
  Nombre: string
  Direccion: string
}

interface Turno {
  Id: string
  Fecha: string
  Hora: string
  Profesional_Nombre: string
  Centro_Nombre: string
  Motivo_Nombre: string
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

export async function getSedes(clienteId: string, sedeId?: string): Promise<ApiResponse<Sede[]>> {
  console.log(`[CLINIC-API] 🏥 Obteniendo sedes para cliente: ${clienteId}`)
  if (sedeId) {
    console.log(`[CLINIC-API] 🎯 Sede específica: ${sedeId}`)
  }

  try {
    const requestBody = {
      Cliente_Id: clienteId.trim(),
      Action: "get_sedes",
      ...(sedeId && { sede_id: sedeId.trim() }),
    }

    console.log(`[CLINIC-API] 📤 Request:`, requestBody)

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })

    const responseText = await response.text()
    console.log(`[CLINIC-API] 📥 Response (${response.status}):`, responseText.substring(0, 500))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    if (data.error) {
      return {
        success: false,
        error: data.error,
      }
    }

    return {
      success: true,
      data: data.sedes || data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error obteniendo sedes:`, error)
    await logError("clinic_api_get_sedes", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

export async function validateDNI(
  clienteId: string,
  dni: string,
): Promise<ApiResponse<{ paciente: Paciente | null; turnos_proximos: Turno[] }>> {
  console.log(`[CLINIC-API] 🆔 Validando DNI: ${dni} para cliente: ${clienteId}`)

  try {
    const requestBody = {
      Cliente_Id: clienteId.trim(),
      Action: "get_paciente",
      dni: dni.trim(),
    }

    console.log(`[CLINIC-API] 📤 Request:`, requestBody)

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })

    const responseText = await response.text()
    console.log(`[CLINIC-API] 📥 Response (${response.status}):`, responseText.substring(0, 500))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    if (data.error) {
      return {
        success: false,
        error: data.error,
      }
    }

    return {
      success: true,
      data: {
        paciente: data.paciente || null,
        turnos_proximos: data.turnos_proximos || [],
      },
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error validando DNI:`, error)
    await logError("clinic_api_validate_dni", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

export async function searchTurnos(
  clienteId: string,
  sedeId?: string,
  fechaDesde?: string,
  fechaHasta?: string,
  profesionalId?: string,
  especialidadId?: string,
): Promise<ApiResponse<any>> {
  console.log(`[CLINIC-API] 📅 Buscando turnos para cliente: ${clienteId}`)

  try {
    const requestBody: any = {
      Cliente_Id: clienteId.trim(),
      Action: "get_turnos",
    }

    if (sedeId) requestBody.sede_id = sedeId.trim()
    if (fechaDesde) requestBody.Fecha_Desde = fechaDesde
    if (fechaHasta) requestBody.Fecha_Hasta = fechaHasta
    if (profesionalId) requestBody.Profesional_Id = profesionalId
    if (especialidadId) requestBody.Subespecialidad_Id = especialidadId

    console.log(`[CLINIC-API] 📤 Request:`, requestBody)

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })

    const responseText = await response.text()
    console.log(`[CLINIC-API] 📥 Response (${response.status}):`, responseText.substring(0, 500))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    if (data.error) {
      return {
        success: false,
        error: data.error,
      }
    }

    return {
      success: true,
      data: data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error buscando turnos:`, error)
    await logError("clinic_api_search_turnos", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

export async function reserveTurno(
  clienteId: string,
  turnoData: {
    agenda_id: string
    dni: string
    nombre: string
    apellido: string
    telefono: string
    email: string
    fecha?: string
    hora?: string
    profesional?: string
  },
): Promise<ApiResponse<any>> {
  console.log(`[CLINIC-API] 📝 Reservando turno para cliente: ${clienteId}`)
  console.log(`[CLINIC-API] 👤 Paciente: ${turnoData.nombre} ${turnoData.apellido} (${turnoData.dni})`)

  try {
    const requestBody = {
      Cliente_Id: clienteId.trim(),
      Action: "set_turno",
      Agenda_Id: turnoData.agenda_id,
      Paciente_DNI: turnoData.dni,
      Paciente_Nombre: turnoData.nombre,
      Paciente_Apellido: turnoData.apellido,
      Paciente_Telefono: turnoData.telefono,
      Paciente_Email: turnoData.email,
      ...(turnoData.fecha && { Fecha: turnoData.fecha }),
      ...(turnoData.hora && { Hora: turnoData.hora }),
      ...(turnoData.profesional && { Profesional_Nombre: turnoData.profesional }),
    }

    console.log(`[CLINIC-API] 📤 Request:`, requestBody)

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })

    const responseText = await response.text()
    console.log(`[CLINIC-API] 📥 Response (${response.status}):`, responseText.substring(0, 500))

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText}`)
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Invalid JSON response: ${responseText}`)
    }

    if (data.error) {
      return {
        success: false,
        error: data.error,
      }
    }

    return {
      success: true,
      data: data,
    }
  } catch (error) {
    console.error(`[CLINIC-API] ❌ Error reservando turno:`, error)
    await logError("clinic_api_reserve_turno", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}
