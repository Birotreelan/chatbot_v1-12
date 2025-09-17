// Configuración de la API
const PROXY_URL = process.env.CLINIC_PROXY_URL || "https://proxy.santiagovulliez.com/proxy_service/"

// Función auxiliar para hacer peticiones HTTP
async function makeRequest(clienteId: string, action: string, params: Record<string, any> = {}): Promise<any> {
  try {
    const body = {
      Cliente_Id: clienteId,
      Action: action,
      ...params,
    }

    console.log(`Realizando petición POST a: ${PROXY_URL}`)
    console.log(`Action: ${action}, Cliente_Id: ${clienteId}`)
    console.log(`Parámetros:`, params)
    console.log(`Cuerpo de la solicitud:`, JSON.stringify(body))

    const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const textResponse = await response.text()
    console.log(`Respuesta (texto) recibida:`, textResponse)

    let jsonResponse
    try {
      jsonResponse = JSON.parse(textResponse)
      console.log(`Respuesta (JSON) parseada:`, jsonResponse)
    } catch (parseError) {
      console.error(`Error al parsear JSON:`, parseError)
      throw new Error(`Respuesta no es JSON válido: ${textResponse}`)
    }

    // Verificar si hay errores en la respuesta
    if (jsonResponse.error) {
      console.error(`Error en los datos de la respuesta:`, jsonResponse.error)
      return {
        success: false,
        codigo: "API_ERROR",
        mensaje: jsonResponse.error,
        data: null,
      }
    }

    return {
      success: true,
      data: jsonResponse,
      mensaje: "Operación exitosa",
    }
  } catch (error) {
    console.error(`Error en makeRequest:`, error)
    return {
      success: false,
      codigo: "NETWORK_ERROR",
      mensaje: error instanceof Error ? error.message : "Error de red desconocido",
      data: null,
    }
  }
}

// Validar DNI y obtener información del paciente
export async function validateDNI(dni: string, clienteId: string): Promise<any> {
  console.log(`[VALIDATE-DNI] Validando DNI: ${dni} para cliente: ${clienteId}`)

  try {
    const result = await makeRequest(clienteId, "get_paciente", { dni })

    if (result.success && result.data && result.data.paciente) {
      console.log(`[VALIDATE-DNI] ✅ DNI válido encontrado:`, result.data)
      return {
        success: true,
        data: result.data,
      }
    } else {
      console.log(`[VALIDATE-DNI] ❌ DNI no encontrado o inválido`)
      return {
        success: false,
        codigo: "DNI_NOT_FOUND",
        mensaje: "DNI no encontrado en el sistema",
      }
    }
  } catch (error) {
    console.error(`[VALIDATE-DNI] ❌ Error validando DNI:`, error)
    return {
      success: false,
      codigo: "VALIDATION_ERROR",
      mensaje: "Error al validar el DNI",
    }
  }
}

// Obtener sedes disponibles
export async function getSedes(clienteId: string, sedeId?: string): Promise<any> {
  console.log(`[GET-SEDES] Obteniendo sedes para cliente: ${clienteId}`)

  try {
    const params: Record<string, any> = {}
    if (sedeId) {
      params.sede_id = sedeId
    }

    const result = await makeRequest(clienteId, "get_data_sedes", params)

    if (result.success && result.data) {
      console.log(`[GET-SEDES] ✅ Sedes obtenidas:`, result.data)
      return {
        success: true,
        data: Array.isArray(result.data) ? result.data : [result.data],
      }
    } else {
      console.log(`[GET-SEDES] ❌ No se encontraron sedes o error:`, result)
      return {
        success: false,
        codigo: result.codigo || "SEDES_NOT_FOUND",
        mensaje: result.mensaje || "No se encontraron sedes disponibles",
      }
    }
  } catch (error) {
    console.error(`[GET-SEDES] ❌ Error obteniendo sedes:`, error)
    return {
      success: false,
      codigo: "SEDES_ERROR",
      mensaje: "Error al obtener las sedes",
    }
  }
}

// Buscar turnos disponibles
export async function searchTurnos(
  params: {
    rangoFechas?: string
    profesional?: string
    especialidad?: string
    profesionalId?: string
  },
  clienteId: string,
): Promise<any> {
  console.log(`[SEARCH-TURNOS] Buscando turnos para cliente: ${clienteId}`)
  console.log(`[SEARCH-TURNOS] Parámetros:`, params)

  try {
    const result = await makeRequest(clienteId, "search_turnos", params)

    if (result.success && result.data) {
      console.log(`[SEARCH-TURNOS] ✅ Turnos encontrados:`, result.data)
      return {
        success: true,
        data: Array.isArray(result.data) ? result.data : [result.data],
      }
    } else {
      console.log(`[SEARCH-TURNOS] ❌ No se encontraron turnos`)
      return {
        success: false,
        codigo: "TURNOS_NOT_FOUND",
        mensaje: "No se encontraron turnos disponibles",
      }
    }
  } catch (error) {
    console.error(`[SEARCH-TURNOS] ❌ Error buscando turnos:`, error)
    return {
      success: false,
      codigo: "TURNOS_ERROR",
      mensaje: "Error al buscar turnos",
    }
  }
}

// Reservar un turno
export async function reserveTurno(
  params: {
    agendaId: string
    dni: string
    nombre: string
    apellido: string
    telefono: string
    email: string
    fecha: string
    hora: string
    profesional: string
  },
  clienteId: string,
): Promise<any> {
  console.log(`[RESERVE-TURNO] Reservando turno para cliente: ${clienteId}`)
  console.log(`[RESERVE-TURNO] Parámetros:`, params)

  try {
    const result = await makeRequest(clienteId, "reserve_turno", params)

    if (result.success) {
      console.log(`[RESERVE-TURNO] ✅ Turno reservado exitosamente:`, result.data)
      return {
        success: true,
        data: result.data,
        mensaje: "Turno reservado exitosamente",
      }
    } else {
      console.log(`[RESERVE-TURNO] ❌ Error al reservar turno:`, result)
      return {
        success: false,
        codigo: result.codigo || "RESERVA_ERROR",
        mensaje: result.mensaje || "Error al reservar el turno",
      }
    }
  } catch (error) {
    console.error(`[RESERVE-TURNO] ❌ Error reservando turno:`, error)
    return {
      success: false,
      codigo: "RESERVA_ERROR",
      mensaje: "Error al reservar el turno",
    }
  }
}
