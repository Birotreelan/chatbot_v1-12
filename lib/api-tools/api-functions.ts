import { getRedisClient } from "@/lib/redis"
import type {
  ApiResponse,
  PacienteData,
  ObraSocialData,
  SubespecialidadData,
  ProfesionalData,
  TurnoData,
  ReservaData,
} from "./types"

// Configuración de caché
const CACHE_TTL = 300 // 5 minutos en segundos
const CACHE_PREFIX = "api_cache:"

// Función helper para logging
function logApiCall(functionName: string, clienteId: string, params?: any) {
  console.log(`[API-TOOLS] 🔧 ${functionName}`)
  console.log(`[API-TOOLS] 📋 Cliente: ${clienteId}`)
  if (params) {
    console.log(`[API-TOOLS] 📋 Parámetros:`, params)
  }
}

// Función helper para caché - MEJORADA
async function getCachedData(key: string): Promise<any> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.log(`[CACHE] ⚠️ Redis no disponible`)
      return null
    }

    const cachedData = await redis.get(key)
    if (!cachedData) {
      console.log(`[CACHE] ❌ Miss para ${key}`)
      return null
    }

    console.log(`[CACHE] ✅ Hit para ${key}`)

    // MEJORADO: Verificar tipo antes de parsear
    let parsedData
    if (typeof cachedData === "string") {
      try {
        parsedData = JSON.parse(cachedData)
      } catch (parseError) {
        console.warn(`[CACHE] ⚠️ Error parsing JSON para ${key}:`, parseError)
        return null
      }
    } else if (typeof cachedData === "object") {
      // Si ya es un objeto, usarlo directamente
      parsedData = cachedData
    } else {
      console.warn(`[CACHE] ⚠️ Tipo de dato inesperado para ${key}:`, typeof cachedData)
      return null
    }

    return parsedData
  } catch (error) {
    console.warn(`[CACHE] ⚠️ Error obteniendo caché para ${key}:`, error)
    return null
  }
}

// Función helper para guardar en caché - MEJORADA
async function setCachedData(key: string, data: any, ttl: number = CACHE_TTL): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      console.log(`[CACHE] ⚠️ Redis no disponible para guardar`)
      return
    }

    // MEJORADO: Asegurar que siempre guardamos como string JSON
    const serializedData = typeof data === "string" ? data : JSON.stringify(data)

    await redis.setex(key, ttl, serializedData)
    console.log(`[CACHE] ✅ Guardado ${key} (TTL: ${ttl}s)`)
  } catch (error) {
    console.warn(`[CACHE] ⚠️ Error guardando caché para ${key}:`, error)
  }
}

// Función helper para hacer requests HTTP
async function makeApiRequest(url: string, options: RequestInit = {}): Promise<any> {
  try {
    console.log(`[API-TOOLS] 🌐 Request: ${url}`)

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    console.log(`[API-TOOLS] ✅ Response recibida`)
    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error en request:`, error)
    throw error
  }
}

// Función para buscar paciente por DNI
export async function buscarPaciente(clienteId: string, params: { dni: string }): Promise<ApiResponse<PacienteData>> {
  logApiCall("buscarPaciente", clienteId, params)

  try {
    const cacheKey = `${CACHE_PREFIX}paciente_${clienteId}_${params.dni}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Si no está en caché, hacer request a la API
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/pacientes/buscar`
    const requestBody = {
      cliente_id: clienteId,
      dni: params.dni,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    // Guardar en caché
    await setCachedData(cacheKey, data)

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error buscarPaciente:`, error)
    return {
      exito: false,
      error: {
        codigo: "BUSCAR_PACIENTE_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}

// Función para validar obra social
export async function validarObraSocial(clienteId: string, busqueda: string): Promise<ApiResponse<ObraSocialData[]>> {
  logApiCall("validarObraSocial", clienteId, { busqueda })

  try {
    const cacheKey = `${CACHE_PREFIX}obras_sociales_${clienteId}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      // Filtrar por búsqueda
      if (cachedResult.exito && cachedResult.datos) {
        const filtered = cachedResult.datos.filter((obra: any) =>
          obra.nombre?.toLowerCase().includes(busqueda.toLowerCase()),
        )
        return {
          ...cachedResult,
          datos: filtered,
        }
      }
      return cachedResult
    }

    // Si no está en caché, hacer request a la API
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/obras-sociales`
    const requestBody = {
      cliente_id: clienteId,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    // Guardar en caché
    await setCachedData(cacheKey, data)

    // Filtrar por búsqueda
    if (data.exito && data.datos) {
      const filtered = data.datos.filter((obra: any) => obra.nombre?.toLowerCase().includes(busqueda.toLowerCase()))
      return {
        ...data,
        datos: filtered,
      }
    }

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error validarObraSocial:`, error)
    return {
      exito: false,
      error: {
        codigo: "VALIDAR_OBRA_SOCIAL_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}

// Función para obtener subespecialidades
export async function obtenerSubespecialidades(clienteId: string): Promise<ApiResponse<SubespecialidadData[]>> {
  logApiCall("obtenerSubespecialidades", clienteId)

  try {
    const cacheKey = `${CACHE_PREFIX}subespecialidades_${clienteId}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Si no está en caché, hacer request a la API
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/subespecialidades`
    const requestBody = {
      cliente_id: clienteId,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    // Guardar en caché con TTL más largo para datos que cambian poco
    await setCachedData(cacheKey, data, 3600) // 1 hora

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error obtenerSubespecialidades:`, error)
    return {
      exito: false,
      error: {
        codigo: "OBTENER_SUBESPECIALIDADES_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}

// Función para buscar profesionales
export async function buscarProfesionales(
  clienteId: string,
  busqueda: string,
): Promise<ApiResponse<ProfesionalData[]>> {
  logApiCall("buscarProfesionales", clienteId, { busqueda })

  try {
    const cacheKey = `${CACHE_PREFIX}profesionales_${clienteId}_${busqueda.toLowerCase()}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Si no está en caché, hacer request a la API
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/profesionales/buscar`
    const requestBody = {
      cliente_id: clienteId,
      busqueda: busqueda,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    // Guardar en caché
    await setCachedData(cacheKey, data, 600) // 10 minutos

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error buscarProfesionales:`, error)
    return {
      exito: false,
      error: {
        codigo: "BUSCAR_PROFESIONALES_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}

// Función para obtener turnos
export async function obtenerTurnos(
  clienteId: string,
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  pacienteDni?: string,
): Promise<ApiResponse<TurnoData[]>> {
  logApiCall("obtenerTurnos", clienteId, { fechaDesde, fechaHasta, profesionalId, pacienteDni })

  try {
    const cacheKey = `${CACHE_PREFIX}turnos_${clienteId}_${fechaDesde}_${fechaHasta}_${profesionalId || "all"}`

    // Para turnos, usar caché más corto ya que cambian frecuentemente
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Si no está en caché, hacer request a la API
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/turnos`
    const requestBody = {
      cliente_id: clienteId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      profesional_id: profesionalId,
      paciente_dni: pacienteDni,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    // Guardar en caché con TTL corto
    await setCachedData(cacheKey, data, 60) // 1 minuto

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error obtenerTurnos:`, error)
    return {
      exito: false,
      error: {
        codigo: "OBTENER_TURNOS_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}

// Función para reservar turno
export async function reservarTurno(
  clienteId: string,
  agendaId: string,
  pacienteData: {
    nombre?: string
    apellido?: string
    dni?: string
    telefono?: string
    email?: string
    fechaNacimiento?: string
    direccion?: string
    localidad?: string
    provincia?: string
    sexo?: string
    tipoDoc?: string
    deudorId?: string
    planId?: string
    nroAfiliado?: string
    turnoMotivo?: string
    comentarios?: string
  },
): Promise<ApiResponse<ReservaData>> {
  logApiCall("reservarTurno", clienteId, { agendaId, pacienteData })

  try {
    // No usar caché para reservas
    const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
    if (!proxyUrl) {
      throw new Error("URL del proxy no configurada")
    }

    const url = `${proxyUrl}/api/turnos/reservar`
    const requestBody = {
      cliente_id: clienteId,
      agenda_id: agendaId,
      paciente: pacienteData,
    }

    const data = await makeApiRequest(url, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    return data
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error reservarTurno:`, error)
    return {
      exito: false,
      error: {
        codigo: "RESERVAR_TURNO_ERROR",
        mensaje: error instanceof Error ? error.message : "Error desconocido",
      },
    }
  }
}
