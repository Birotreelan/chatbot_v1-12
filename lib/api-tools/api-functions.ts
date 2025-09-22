import { logError } from "../monitoring"

interface APIResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
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
  paciente_id: string
  medico_id: string
  sede_id: string
  estado: string
  observaciones?: string
}

interface Paciente {
  id: string
  dni: string
  nombre: string
  apellido: string
  telefono?: string
  email?: string
  fecha_nacimiento?: string
}

// Función base para hacer requests a la API
async function makeAPIRequest<T>(
  action: string,
  clienteId: string,
  params: Record<string, any> = {},
  timeout = 30000,
): Promise<APIResponse<T>> {
  const proxyUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
  if (!proxyUrl) {
    console.error("❌ CLINIC_PROXY_URL o PROXY_API_URL no configurada")
    return {
      success: false,
      error: "URL del proxy no configurada",
    }
  }

  console.log(`Realizando petición POST a: ${proxyUrl}`)
  console.log(`Action: ${action}, Cliente_Id: ${clienteId}`)
  console.log(`Parámetros:`, JSON.stringify(params, null, 2))

  const requestBody = {
    Cliente_Id: clienteId,
    Action: action,
    ...params,
  }

  console.log(`Cuerpo de la solicitud:`, JSON.stringify(requestBody))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseText = await response.text()
    console.log(`Respuesta (texto) recibida:`, responseText)

    if (!response.ok) {
      console.error(`❌ Error HTTP ${response.status}: ${responseText}`)
      return {
        success: false,
        error: `HTTP ${response.status}: ${responseText}`,
      }
    }

    try {
      const data = JSON.parse(responseText)
      console.log(`Respuesta (JSON) parseada:`, JSON.stringify(data, null, 2))

      // Verificar si hay error en la respuesta
      if (data.error) {
        console.error(`Error en los datos de la respuesta:`, data.error)
        return {
          success: false,
          error: data.error,
        }
      }

      // Verificar si hay datos válidos
      if (data.data || Array.isArray(data) || (typeof data === "object" && !data.error)) {
        console.log(`✅ Respuesta exitosa`)
        return {
          success: true,
          data: data.data || data,
        }
      }

      console.error(`❌ Respuesta sin datos válidos:`, data)
      return {
        success: false,
        error: "Respuesta sin datos válidos",
      }
    } catch (parseError) {
      console.error(`❌ Error parseando JSON:`, parseError)
      console.error(`Texto de respuesta:`, responseText.substring(0, 500))
      return {
        success: false,
        error: "Error parseando respuesta JSON",
      }
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error.name === "AbortError") {
      console.error(`❌ Timeout después de ${timeout}ms`)
      return {
        success: false,
        error: `Timeout después de ${timeout}ms`,
      }
    }

    console.error(`❌ Error en request:`, error)
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para obtener sedes - CORREGIDA
export async function getSedes(clienteId: string, sedeId?: string): Promise<APIResponse<Sede[]>> {
  console.log(`[GET-SEDES] Obteniendo sedes para cliente: ${clienteId}`)
  if (sedeId) {
    console.log(`[GET-SEDES] Sede específica solicitada: ${sedeId}`)
  } else {
    console.log(`[GET-SEDES] Obteniendo todas las sedes`)
  }

  try {
    // Si se proporciona sede_id, usar get_data_sede (singular)
    // Si no se proporciona, usar get_data_sedes_all o similar
    const action = sedeId ? "get_data_sede" : "get_data_sedes_all"
    const params = sedeId ? { sede_id: sedeId } : {}

    console.log(`[GET-SEDES] Usando action: ${action}`)
    console.log(`[GET-SEDES] Parámetros:`, params)

    const result = await makeAPIRequest<Sede[]>(action, clienteId, params)

    if (result.success) {
      const sedes = Array.isArray(result.data) ? result.data : [result.data]
      console.log(`[GET-SEDES] ✅ ${sedes.length} sede(s) obtenida(s)`)
      return {
        success: true,
        data: sedes,
      }
    } else {
      console.log(`[GET-SEDES] ❌ No se encontraron sedes o error: ${JSON.stringify(result)}`)

      // Si falló con get_data_sedes_all, intentar con get_data_sedes y sede_id
      if (!sedeId && action === "get_data_sedes_all") {
        console.log(`[GET-SEDES] Intentando con get_data_sedes y sede_id por defecto`)

        // Intentar con una sede por defecto si está disponible
        const fallbackResult = await makeAPIRequest<Sede[]>("get_data_sedes", clienteId, {})

        if (fallbackResult.success) {
          const sedes = Array.isArray(fallbackResult.data) ? fallbackResult.data : [fallbackResult.data]
          console.log(`[GET-SEDES] ✅ ${sedes.length} sede(s) obtenida(s) con fallback`)
          return {
            success: true,
            data: sedes,
          }
        }
      }

      return result
    }
  } catch (error) {
    console.error(`[GET-SEDES] ❌ Error obteniendo sedes:`, error)
    await logError("get_sedes", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para obtener turnos
export async function getTurnos(
  clienteId: string,
  sedeId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<APIResponse<Turno[]>> {
  console.log(`[GET-TURNOS] Obteniendo turnos para cliente: ${clienteId}, sede: ${sedeId}`)
  console.log(`[GET-TURNOS] Rango de fechas: ${fechaDesde} - ${fechaHasta}`)

  try {
    const params = {
      sede_id: sedeId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    }

    const result = await makeAPIRequest<Turno[]>("get_turnos", clienteId, params)

    if (result.success) {
      const turnos = Array.isArray(result.data) ? result.data : []
      console.log(`[GET-TURNOS] ✅ ${turnos.length} turno(s) obtenido(s)`)
      return {
        success: true,
        data: turnos,
      }
    } else {
      console.log(`[GET-TURNOS] ❌ Error obteniendo turnos: ${JSON.stringify(result)}`)
      return result
    }
  } catch (error) {
    console.error(`[GET-TURNOS] ❌ Error obteniendo turnos:`, error)
    await logError("get_turnos", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para crear turno
export async function crearTurno(
  clienteId: string,
  turnoData: {
    fecha: string
    hora: string
    paciente_id: string
    medico_id: string
    sede_id: string
    observaciones?: string
  },
): Promise<APIResponse<Turno>> {
  console.log(`[CREAR-TURNO] Creando turno para cliente: ${clienteId}`)
  console.log(`[CREAR-TURNO] Datos del turno:`, JSON.stringify(turnoData, null, 2))

  try {
    const result = await makeAPIRequest<Turno>("crear_turno", clienteId, turnoData)

    if (result.success) {
      console.log(`[CREAR-TURNO] ✅ Turno creado exitosamente`)
      return result
    } else {
      console.log(`[CREAR-TURNO] ❌ Error creando turno: ${JSON.stringify(result)}`)
      return result
    }
  } catch (error) {
    console.error(`[CREAR-TURNO] ❌ Error creando turno:`, error)
    await logError("crear_turno", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para buscar paciente
export async function buscarPaciente(clienteId: string, dni: string): Promise<APIResponse<Paciente[]>> {
  console.log(`[BUSCAR-PACIENTE] Buscando paciente con DNI: ${dni} para cliente: ${clienteId}`)

  try {
    const params = {
      dni: dni,
    }

    const result = await makeAPIRequest<Paciente[]>("buscar_paciente", clienteId, params)

    if (result.success) {
      const pacientes = Array.isArray(result.data) ? result.data : [result.data]
      console.log(`[BUSCAR-PACIENTE] ✅ ${pacientes.length} paciente(s) encontrado(s)`)
      return {
        success: true,
        data: pacientes,
      }
    } else {
      console.log(`[BUSCAR-PACIENTE] ❌ Error buscando paciente: ${JSON.stringify(result)}`)
      return result
    }
  } catch (error) {
    console.error(`[BUSCAR-PACIENTE] ❌ Error buscando paciente:`, error)
    await logError("buscar_paciente", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para obtener médicos
export async function getMedicos(clienteId: string, sedeId?: string): Promise<APIResponse<any[]>> {
  console.log(`[GET-MEDICOS] Obteniendo médicos para cliente: ${clienteId}`)
  if (sedeId) {
    console.log(`[GET-MEDICOS] Sede específica: ${sedeId}`)
  }

  try {
    const params = sedeId ? { sede_id: sedeId } : {}

    const result = await makeAPIRequest<any[]>("get_medicos", clienteId, params)

    if (result.success) {
      const medicos = Array.isArray(result.data) ? result.data : []
      console.log(`[GET-MEDICOS] ✅ ${medicos.length} médico(s) obtenido(s)`)
      return {
        success: true,
        data: medicos,
      }
    } else {
      console.log(`[GET-MEDICOS] ❌ Error obteniendo médicos: ${JSON.stringify(result)}`)
      return result
    }
  } catch (error) {
    console.error(`[GET-MEDICOS] ❌ Error obteniendo médicos:`, error)
    await logError("get_medicos", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función para obtener horarios disponibles
export async function getHorariosDisponibles(
  clienteId: string,
  medicoId: string,
  sedeId: string,
  fecha: string,
): Promise<APIResponse<string[]>> {
  console.log(`[GET-HORARIOS] Obteniendo horarios disponibles`)
  console.log(`[GET-HORARIOS] Cliente: ${clienteId}, Médico: ${medicoId}, Sede: ${sedeId}, Fecha: ${fecha}`)

  try {
    const params = {
      medico_id: medicoId,
      sede_id: sedeId,
      fecha: fecha,
    }

    const result = await makeAPIRequest<string[]>("get_horarios_disponibles", clienteId, params)

    if (result.success) {
      const horarios = Array.isArray(result.data) ? result.data : []
      console.log(`[GET-HORARIOS] ✅ ${horarios.length} horario(s) disponible(s)`)
      return {
        success: true,
        data: horarios,
      }
    } else {
      console.log(`[GET-HORARIOS] ❌ Error obteniendo horarios: ${JSON.stringify(result)}`)
      return result
    }
  } catch (error) {
    console.error(`[GET-HORARIOS] ❌ Error obteniendo horarios:`, error)
    await logError("get_horarios_disponibles", error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error.message || "Error desconocido",
    }
  }
}

// Función de utilidad para validar datos de turno
export function validateTurnoData(turnoData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!turnoData.fecha) {
    errors.push("Fecha es requerida")
  }

  if (!turnoData.hora) {
    errors.push("Hora es requerida")
  }

  if (!turnoData.paciente_id) {
    errors.push("ID de paciente es requerido")
  }

  if (!turnoData.medico_id) {
    errors.push("ID de médico es requerido")
  }

  if (!turnoData.sede_id) {
    errors.push("ID de sede es requerido")
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// Exportar tipos para uso externo
export type { Sede, Turno, Paciente, APIResponse }
