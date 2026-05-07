import type { Paciente, Cita, DisponibilidadHoraria, ApiResponse, SedeResponse } from "./types"
import { getClinicApiConfig } from "./types"
import { getRedisClient } from "../redis"
import { TIMEOUTS, fetchWithTimeout, fetchWithRetry } from "../config/timeouts"

// Obtener la URL del proxy desde las variables de entorno
function getProxyUrl(): string {
  const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
  if (!proxyUrl) {
    throw new Error("PROXY_API_URL o CLINIC_PROXY_URL debe estar configurada en las variables de entorno")
  }
  return proxyUrl
}

// Prefijo para las claves de caché
const CACHE_PREFIX = "api_cache:"
// TTL para la caché (en segundos)
const CACHE_TTL = 60 * 5 // 5 minutos

const NO_CACHE_ACTIONS = [
  "get_paciente", // Incluye turnos_proximos que pueden cambiar
  "get_turnos_paciente", // Turnos del paciente
  "cancelar_turno", // Acciones de modificación
  "confirmar_turno",
  "reservar_turno",
]

// Función para generar clave de caché
function getCacheKey(action: string, params: Record<string, any>): string {
  return `${CACHE_PREFIX}${action}:${JSON.stringify(params)}`
}

// Función principal para hacer peticiones al proxy
async function fetchProxyApi<T>(
  clienteId: string,
  action: string,
  params: Record<string, any> = {},
  useCache = true,
): Promise<ApiResponse<T>> {
  const shouldUseCache = useCache && !NO_CACHE_ACTIONS.includes(action)

  // Generar clave de caché
  const cacheKey = getCacheKey(action, { clienteId, ...params })
  const redis = getRedisClient()

  // Verificar caché si está habilitada
  if (shouldUseCache && redis) {
    const cachedData = await redis.get(cacheKey)
    if (cachedData) {
      console.log(`[CACHE] ✅ Hit para ${action}`)
      // Verificar si cachedData ya es un objeto o es una cadena JSON
      if (typeof cachedData === "string") {
        return JSON.parse(cachedData)
      } else {
        // Si ya es un objeto, devolverlo directamente
        return cachedData as ApiResponse<T>
      }
    }
  } else if (NO_CACHE_ACTIONS.includes(action)) {
    console.log(`[CACHE] 🚫 Sin caché para ${action} (datos dinámicos)`)
  }

  try {
    const proxyUrl = getProxyUrl()

    // Preparar el cuerpo de la solicitud
    const requestBody = {
      Cliente_Id: clienteId.trim(),
      Action: action,
      ...params,
    }

    console.log(`[API] 📤 ${action} → ${proxyUrl}`)
    console.log(`[API] 📋 Params: ${JSON.stringify(params)}`)

    const response = await fetchWithTimeout(
      proxyUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      TIMEOUTS.PROXY_TIMEOUT,
    )

    // Obtener el texto de la respuesta
    const responseText = await response.text()
    console.log(`[API] 📥 ${response.status} Respuesta COMPLETA del proxy:`)
    console.log(`[API] 📥 ${responseText}`)
    console.log(`[API] 📥 Longitud total: ${responseText.length} caracteres`)

    // Intentar parsear la respuesta como JSON
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      console.error(`[API] ❌ JSON inválido:`, e)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `Respuesta inválida: ${responseText.substring(0, 100)}...`,
        },
      }
    }

    // Verificar errores específicos
    if (data.error && typeof data.error === "string" && data.error.includes("Cliente_Id")) {
      console.error(`[API] ❌ Error Cliente_Id:`, data.error)
      return {
        exito: false,
        error: {
          codigo: "CLIENTE_ID_INVALIDO",
          mensaje: data.error,
        },
      }
    }

    // Verificar errores HTTP
    if (!response.ok) {
      console.error(`[API] ❌ HTTP ${response.status}:`, data?.error || response.statusText)
      return {
        exito: false,
        error: {
          codigo: `HTTP_${response.status}`,
          mensaje: data?.message || data?.error || response.statusText || "Error desconocido",
        },
      }
    }

    // Verificar errores de la API
    if (data.error) {
      console.error(`[API] ❌ API Error:`, data.error)
      return {
        exito: false,
        error: {
          codigo: "API_ERROR",
          mensaje: typeof data.error === "string" ? data.error : data.error.message || "Error desconocido",
        },
      }
    }

    // Verificar campo success
    if (data.success !== undefined) {
      if (!data.success) {
        console.error(`[API] ❌ Success=false:`, data)
        return {
          exito: false,
          error: {
            codigo: "API_ERROR",
            mensaje: data.message || "Error desconocido",
          },
        }
      }

      if (shouldUseCache && redis) {
        const result = { exito: true, datos: data.data }
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result))
        console.log(`[CACHE] 💾 Guardado ${action}`)
      }

      return {
        exito: true,
        datos: data.data,
      }
    }

    // Si llegamos aquí, asumimos que la respuesta es exitosa
    const result = { exito: true, datos: data }

    if (shouldUseCache && redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result))
      console.log(`[CACHE] 💾 Guardado ${action}`)
    }

    return result
  } catch (error) {
    console.error(`[API] ❌ Error de red:`, error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_RED",
        mensaje: error instanceof Error ? error.message : "Error de red desconocido",
      },
    }
  }
}

// Función para buscar paciente por DNI o teléfono
export async function buscarPaciente(
  clienteId: string,
  params: { dni?: string; telefono?: string },
  useCache = true,
): Promise<ApiResponse<Paciente | null>> {
  if (!params.dni && !params.telefono) {
    return {
      exito: false,
      error: {
        codigo: "PARAMETROS_INVALIDOS",
        mensaje: "Se requiere al menos un parámetro: dni o telefono",
      },
    }
  }

  const apiParams: Record<string, any> = {}
  if (params.dni) apiParams.dni = params.dni
  if (params.telefono) apiParams.telefono = params.telefono

  const resultado = await fetchProxyApi<any>(clienteId, "get_paciente", apiParams, useCache)

  if (resultado.exito && resultado.datos) {
    const pacienteData = resultado.datos.paciente || resultado.datos
    const turnosProximos = resultado.datos.turnos_proximos || []
    const esPrimeraVez = resultado.datos.es_primera_vez ?? null
    return {
      exito: true,
      datos: pacienteData,
      turnosProximos: turnosProximos,
      esPrimeraVez: esPrimeraVez,
    }
  }

  return resultado
}

// Función para obtener subespecialidades
export async function obtenerSubespecialidades(
  clienteId: string,
  useCache = true,
): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
  return fetchProxyApi<{ id: string; nombre: string }[]>(clienteId, "get_subespecialidades", {}, useCache)
}

// Función para buscar profesionales por nombre o especialidad
export async function buscarProfesionales(
  clienteId: string,
  busqueda: string,
  useCache = true,
): Promise<ApiResponse<{ id: string; nombre: string; especialidad?: string }[]>> {
  const resultado = await fetchProxyApi<any>(clienteId, "get_profesionales", { busqueda }, useCache)

  if (resultado.exito && resultado.datos) {
    const profesionales = resultado.datos.profesionales || resultado.datos
    return {
      exito: true,
      datos: Array.isArray(profesionales) ? profesionales : [],
    }
  }

  return resultado
}

// Función para obtener turnos disponibles o agendados
export async function obtenerTurnos(
  clienteId: string,
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  pacienteDNI?: string,
  useCache = true,
  sedeId?: string,
  subespecialidadId?: string,
  deudorId?: string,
): Promise<ApiResponse<any>> {
  const params: Record<string, any> = {
    Fecha_Desde: fechaDesde,
    Fecha_Hasta: fechaHasta,
  }

  if (profesionalId) {
    params.Profesional_Id = profesionalId
  }

  if (pacienteDNI) {
    params.Paciente_DNI = pacienteDNI
  }

  if (sedeId) {
    params.Sede_Id = sedeId
  }

  if (subespecialidadId) {
    params.Subespecialidad_Id = subespecialidadId
  }

  if (deudorId) {
    params.Deudor_Id = deudorId
  }

  const resultado = await fetchProxyApi<any>(clienteId, "get_turnos", params, useCache)

  if (resultado.exito && resultado.datos) {
    const turnos = resultado.datos.turnos_disponibles || resultado.datos
    return {
      exito: true,
      datos: turnos,
    }
  }

  return resultado
}

// Función para reservar un turno
export async function reservarTurno(
  clienteId: string,
  agendaId: string,
  pacienteData: {
    nombre?: string
    apellido?: string
    dni?: string
    telefono: string
    email: string
    fechaNacimiento?: string
    direccion?: string
    localidad?: string
    provincia?: string
    sexo?: string
    tipoDoc?: string
    deudorId?: string
    deudorNombre?: string
    planId?: string
    nroAfiliado?: string
    turnoMotivo?: string
    comentarios?: string
  },
  useCache = false, // Reservar turno no debería cachearse
): Promise<ApiResponse<any>> {
  const params: Record<string, any> = {
    Agenda_Id: agendaId,
    Paciente_Telefono: pacienteData.telefono,
    Paciente_Email: pacienteData.email,
  }

  // Añadir campos opcionales si están presentes
  if (pacienteData.nombre) params.Paciente_Nombre = pacienteData.nombre
  if (pacienteData.apellido) params.Paciente_Apellido = pacienteData.apellido
  if (pacienteData.dni) params.Paciente_DNI = pacienteData.dni
  if (pacienteData.fechaNacimiento) params.Paciente_Fecha_Nac = pacienteData.fechaNacimiento
  if (pacienteData.direccion) params.Paciente_Direccion = pacienteData.direccion
  if (pacienteData.localidad) params.Paciente_Localidad = pacienteData.localidad
  if (pacienteData.provincia) params.Paciente_Provincia = pacienteData.provincia
  if (pacienteData.sexo) params.Paciente_Sexo = pacienteData.sexo
  if (pacienteData.tipoDoc) params.Paciente_Tipo_Doc = pacienteData.tipoDoc
  if (pacienteData.deudorId) params.Deudor_Id = pacienteData.deudorId
  if (pacienteData.deudorNombre) params.Deudor_Nombre = pacienteData.deudorNombre
  if (pacienteData.planId) params.Plan_Id = pacienteData.planId
  if (pacienteData.nroAfiliado) params.Nro_Afiliado = pacienteData.nroAfiliado
  if (pacienteData.turnoMotivo) params.Turno_Motivo = pacienteData.turnoMotivo
  if (pacienteData.comentarios) params.Comentarios = pacienteData.comentarios

  return fetchProxyApi<any>(clienteId, "set_turno", params, useCache)
}

// Función para validar obra social
export async function validarObraSocial(
  clienteId: string,
  busqueda: string,
  useCache = true,
): Promise<
  ApiResponse<{
    obras_sociales: Array<{
      id: string
      nombre: string
      razon_social: string
      permite_turnos_online: boolean
      permite_turnos_online_texto: string
    }>
    total_encontradas: number
    busqueda_realizada: string
  }>
> {
  const resultado = await fetchProxyApi<any>(clienteId, "get_obras_sociales", { busqueda }, useCache)

  if (resultado.exito && resultado.datos) {
    return {
      exito: true,
      datos: resultado.datos,
    }
  }

  return resultado
}

// Función para obtener datos de una sede específica
export async function obtenerDatosSede(clienteId: string, sedeId: string): Promise<SedeResponse | null> {
  try {
    console.log(`[API] 🏥 Obteniendo datos de sede: ${sedeId} para cliente: ${clienteId}`)

    const config = getClinicApiConfig()

    if (!config.baseUrl) {
      console.error("[API] ❌ URL de API no configurada")
      return null
    }

    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_data_sedes",
      sede_id: sedeId,
    }

    console.log("[API] 📤 Enviando request:", requestBody)

    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      console.error(`[API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
      return null
    }

    const data = (await response.json()) as SedeResponse
    console.log("[API] 📥 Respuesta recibida:", data)

    if (data.success && data.sede) {
      console.log(`[API] ✅ Datos de sede obtenidos: ${data.sede.Nombre_Completo}`)
      return data
    } else {
      console.error("[API] ❌ Respuesta no exitosa:", data)
      return null
    }
  } catch (error) {
    console.error("[API] ❌ Error al obtener datos de sede:", error)
    return null
  }
}

// Función para obtener listado de todas las sedes
export async function obtenerTodasLasSedes(clienteId: string): Promise<{
  success: boolean
  sedes?: Array<{
    Id: string
    Nombre_Completo: string
    Domicilio: string
    Telefono: string
    E_Mail: string
    Localidad: string
    Provincia: string
    Horario: string
    Dominio_Web: string
  }>
  total?: number
  error?: string
}> {
  try {
    console.log(`[API] 🏥 Obteniendo listado de todas las sedes para cliente: ${clienteId}`)

    const config = getClinicApiConfig()

    if (!config.baseUrl) {
      console.error("[API] ❌ URL de API no configurada")
      return { success: false, error: "URL de API no configurada" }
    }

    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_data_sedes",
    }

    console.log("[API] 📤 Enviando request:", requestBody)

    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(config.timeout),
    })

    if (!response.ok) {
      console.error(`[API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
      return { success: false, error: `Error HTTP: ${response.status}` }
    }

    const data = await response.json()
    console.log("[API] 📥 Respuesta recibida:", data)

    if (data.success && data.sedes) {
      console.log(`[API] ✅ Listado de sedes obtenido: ${data.sedes.length} sedes`)
      return {
        success: true,
        sedes: data.sedes,
        total: data.total || data.sedes.length,
      }
    } else {
      console.error("[API] ❌ Respuesta no exitosa:", data)
      return { success: false, error: data.error || "Error desconocido" }
    }
  } catch (error) {
    console.error("[API] ❌ Error al obtener listado de sedes:", error)
    return { success: false, error: error instanceof Error ? error.message : "Error desconocido" }
  }
}

export const obtenerSedes = obtenerTodasLasSedes

// Función auxiliar para formatear los datos de sede para el bloque SISTEMA
export function formatearDatosSede(sedeData: SedeResponse["sede"]): string {
  return `Sede: ${sedeData.Nombre_Completo}
Domicilio: ${sedeData.Domicilio}
Telefono: ${sedeData.Telefono}
Email: ${sedeData.E_Mail}
Horario: ${sedeData.Horario}
Web: ${sedeData.Dominio_Web}`
}

// Función para obtener turnos disponibles
export async function obtenerTurnosDisponibles(
  clienteId: string,
  especialidadId: string,
  profesionalId?: string,
): Promise<ApiResponse<any>> {
  try {
    console.log(`[API] 🕒 Obteniendo turnos disponibles para especialidad: ${especialidadId}`)

    const config = getClinicApiConfig()

    const requestBody = {
      Cliente_Id: clienteId,
      Action: "get_turnos_disponibles",
      especialidad_id: especialidadId,
      ...(profesionalId && { profesional_id: profesionalId }),
    }

    console.log("[API] 📤 Enviando request:", requestBody)

    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      console.error(`[API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
      return {
        exito: false,
        error: `Error HTTP ${response.status}`,
      }
    }

    const data = await response.json()
    console.log("[API] 📥 Respuesta recibida:", data)

    return data
  } catch (error) {
    console.error("[API] ❌ Error al obtener turnos:", error)
    return {
      exito: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

// Función para confirmar turno con reintentos para respuestas inválidas
export async function confirmarTurno(
  clienteId: string,
  turnoData: {
    fecha: string
    paciente_datos: {
      dni: string
      telefono: string
    }
  },
): Promise<ApiResponse<any>> {
  const MAX_RETRIES = 4
  const RETRY_DELAYS = [0, 5000, 10000, 15000] // Espera progresiva entre reintentos
  
  const config = getClinicApiConfig()
  const requestBody = {
    Cliente_Id: clienteId,
    Action: "confirmar_turno",
    fecha: turnoData.fecha,
    paciente_datos: turnoData.paciente_datos,
  }

  console.log(`[API] 🎯 Confirmando turno:`, turnoData)
  console.log("[API] 📤 Enviando request:", requestBody)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Esperar antes del reintento (excepto el primer intento)
      if (attempt > 1) {
        const delay = RETRY_DELAYS[attempt - 1] || 15000
        console.log(`[API] ⏳ Esperando ${delay}ms antes del reintento ${attempt}/${MAX_RETRIES}...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      console.log(`[API] 🔄 Intento ${attempt}/${MAX_RETRIES} de confirmación de turno`)

      const response = await fetchWithRetry(
        config.baseUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...config.headers,
          },
          body: JSON.stringify(requestBody),
        },
        TIMEOUTS.PROXY_TIMEOUT,
        { maxRetries: 2, initialDelayMs: 3000 }, // Reintentos internos para errores de red
      )

      if (!response.ok) {
        console.error(`[API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
        // Los errores HTTP 5xx son transitorios, reintentar
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Error de servidor ${response.status}, reintentando...`)
          lastError = new Error(`Error HTTP ${response.status}`)
          continue
        }
        return {
          exito: false,
          error: `Error HTTP ${response.status}`,
          mensaje: "No se pudo confirmar el turno. Por favor, intente nuevamente o comuníquese con la clínica.",
        }
      }

      // Obtener el texto de la respuesta primero para validar
      const responseText = await response.text()
      
      // Verificar si la respuesta parece ser HTML (error del servidor)
      if (responseText.trim().startsWith('<') || responseText.includes('<br />') || responseText.includes('<html')) {
        console.error(`[API] ⚠️ Servidor respondió con HTML en lugar de JSON (intento ${attempt}/${MAX_RETRIES})`)
        console.error(`[API] 📄 Respuesta HTML: ${responseText.substring(0, 200)}...`)
        
        if (attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Servidor temporalmente no disponible, reintentando...`)
          lastError = new Error("Servidor respondió con HTML en lugar de JSON")
          continue
        }
        
        return {
          exito: false,
          error: "El servidor está temporalmente no disponible",
          mensaje: "No se pudo confirmar el turno en este momento. Por favor, intente nuevamente en unos segundos.",
        }
      }

      // Intentar parsear como JSON
      let data
      try {
        data = JSON.parse(responseText)
      } catch (parseError) {
        console.error(`[API] ⚠️ Error parseando JSON (intento ${attempt}/${MAX_RETRIES}):`, parseError)
        console.error(`[API] 📄 Respuesta recibida: ${responseText.substring(0, 200)}...`)
        
        if (attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Respuesta inválida, reintentando...`)
          lastError = parseError as Error
          continue
        }
        
        return {
          exito: false,
          error: "Respuesta inválida del servidor",
          mensaje: "No se pudo confirmar el turno. Por favor, intente nuevamente en unos segundos.",
        }
      }

      console.log("[API] 📥 Respuesta recibida:", data)
      
      // Si llegamos aquí, la respuesta fue exitosa
      if (attempt > 1) {
        console.log(`[API] ✅ Confirmación exitosa en el intento ${attempt}`)
      }

      // Retornar la respuesta directamente (nuevo formato de API)
      return data
      
    } catch (error) {
      console.error(`[API] ❌ Error en intento ${attempt}/${MAX_RETRIES}:`, error)
      lastError = error as Error
      
      // Si no es el último intento, continuar con el siguiente
      if (attempt < MAX_RETRIES) {
        console.log(`[API] 🔄 Reintentando después del error...`)
        continue
      }
    }
  }

  // Si llegamos aquí, todos los reintentos fallaron
  console.error(`[API] ❌ Todos los ${MAX_RETRIES} intentos de confirmación fallaron`)
  return {
    exito: false,
    error: lastError?.message || "Error desconocido",
    mensaje: "Ocurrió un error al confirmar el turno. Por favor, intente nuevamente.",
  }
}

// Función para cancelar turno con reintentos para respuestas inválidas
export async function cancelarTurno(
  clienteId: string,
  turnoData: {
    fecha: string
    motivo: string
    paciente_datos: {
      dni: string
      telefono: string
    }
  },
): Promise<any> {
  const MAX_RETRIES = 4
  const RETRY_DELAYS = [0, 5000, 10000, 15000] // Espera progresiva entre reintentos
  
  const config = getClinicApiConfig()
  const requestBody = {
    Cliente_Id: clienteId,
    Action: "cancelar_turno",
    fecha: turnoData.fecha,
    motivo: turnoData.motivo,
    paciente_datos: turnoData.paciente_datos,
  }

  console.log(`[API] ❌ Cancelando turno:`, turnoData)
  console.log("[API] 📤 Enviando request de cancelación:", requestBody)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Esperar antes del reintento (excepto el primer intento)
      if (attempt > 1) {
        const delay = RETRY_DELAYS[attempt - 1] || 15000
        console.log(`[API] ⏳ Esperando ${delay}ms antes del reintento ${attempt}/${MAX_RETRIES}...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      console.log(`[API] 🔄 Intento ${attempt}/${MAX_RETRIES} de cancelación de turno`)

      const response = await fetchWithRetry(
        config.baseUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...config.headers,
          },
          body: JSON.stringify(requestBody),
        },
        TIMEOUTS.PROXY_TIMEOUT,
        { maxRetries: 2, initialDelayMs: 3000 }, // Reintentos internos para errores de red
      )

      if (!response.ok) {
        console.error(`[API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
        // Los errores HTTP 5xx son transitorios, reintentar
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Error de servidor ${response.status}, reintentando...`)
          lastError = new Error(`Error HTTP ${response.status}`)
          continue
        }
        return {
          success: false,
          error: `Error HTTP ${response.status}`,
          mensaje: "No se pudo cancelar el turno. Por favor, intente nuevamente o comuníquese con la clínica.",
        }
      }

      // Obtener el texto de la respuesta primero para validar
      const responseText = await response.text()
      
      // Verificar si la respuesta parece ser HTML (error del servidor)
      if (responseText.trim().startsWith('<') || responseText.includes('<br />') || responseText.includes('<html')) {
        console.error(`[API] ⚠️ Servidor respondió con HTML en lugar de JSON (intento ${attempt}/${MAX_RETRIES})`)
        console.error(`[API] 📄 Respuesta HTML: ${responseText.substring(0, 200)}...`)
        
        if (attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Servidor temporalmente no disponible, reintentando...`)
          lastError = new Error("Servidor respondió con HTML en lugar de JSON")
          continue
        }
        
        return {
          success: false,
          error: "El servidor está temporalmente no disponible",
          mensaje: "No se pudo cancelar el turno en este momento. Por favor, intente nuevamente en unos segundos.",
        }
      }

      // Intentar parsear como JSON
      let data
      try {
        data = JSON.parse(responseText)
      } catch (parseError) {
        console.error(`[API] ⚠️ Error parseando JSON (intento ${attempt}/${MAX_RETRIES}):`, parseError)
        console.error(`[API] 📄 Respuesta recibida: ${responseText.substring(0, 200)}...`)
        
        if (attempt < MAX_RETRIES) {
          console.log(`[API] 🔄 Respuesta inválida, reintentando...`)
          lastError = parseError as Error
          continue
        }
        
        return {
          success: false,
          error: "Respuesta inválida del servidor",
          mensaje: "No se pudo cancelar el turno. Por favor, intente nuevamente en unos segundos.",
        }
      }

      console.log("[API] 📥 Respuesta de cancelación recibida:", data)
      
      // Si llegamos aquí, la respuesta fue exitosa
      if (attempt > 1) {
        console.log(`[API] ✅ Cancelación exitosa en el intento ${attempt}`)
      }

      // Retornar la respuesta directamente (nuevo formato de API)
      return data
      
    } catch (error) {
      console.error(`[API] ❌ Error en intento ${attempt}/${MAX_RETRIES}:`, error)
      lastError = error as Error
      
      // Si no es el último intento, continuar con el siguiente
      if (attempt < MAX_RETRIES) {
        console.log(`[API] 🔄 Reintentando después del error...`)
        continue
      }
    }
  }

  // Si llegamos aquí, todos los reintentos fallaron
  console.error(`[API] ❌ Todos los ${MAX_RETRIES} intentos de cancelación fallaron`)
  return {
    success: false,
    error: lastError?.message || "Error desconocido",
    mensaje: "Ocurrió un error al cancelar el turno. Por favor, intente nuevamente.",
  }
}

// Funciones de compatibilidad con el código anterior

// Compatibilidad: buscar paciente por DNI
export async function paciente_dni(dni: string, clienteId: string): Promise<ApiResponse<Paciente | null>> {
  return buscarPaciente(clienteId, { dni })
}

// Compatibilidad: buscar paciente por DNI
export async function buscarPacientePorDNI(dni: string, clienteId: string): Promise<ApiResponse<Paciente | null>> {
  return buscarPaciente(clienteId, { dni })
}

// Compatibilidad: obtener citas de un paciente
export async function obtenerCitasPaciente(
  pacienteDNI: string,
  fechaDesde: string,
  fechaHasta: string,
  clienteId: string,
): Promise<ApiResponse<Cita[]>> {
  return obtenerTurnos(clienteId, fechaDesde, fechaHasta, undefined, pacienteDNI)
}

// Compatibilidad: obtener agenda
export async function obtenerAgenda(
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  clienteId?: string,
): Promise<ApiResponse<Cita[]>> {
  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "Se requiere el ID del cliente",
      },
    }
  }
  return obtenerTurnos(clienteId, fechaDesde, fechaHasta, profesionalId)
}

// Compatibilidad: verificar disponibilidad
export async function verificarDisponibilidad(
  fecha: string,
  profesionalId?: string,
  clienteId?: string,
): Promise<ApiResponse<DisponibilidadHoraria>> {
  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "Se requiere el ID del cliente",
      },
    }
  }
  // Usar la misma fecha como inicio y fin para obtener los turnos de un solo día
  return obtenerTurnos(clienteId, fecha, fecha, profesionalId)
}

// Compatibilidad: obtener subespecialidades
export async function obtenerDoctores(clienteId: string): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
  return buscarProfesionales(clienteId, "")
}

// Compatibilidad: buscar turnos disponibles
export async function buscarTurnosDisponibles(
  rangoFechas: string,
  profesional?: string,
  especialidad?: string,
  profesionalId?: string,
  clienteId?: string,
  sedeId?: string,
  pacienteDNI?: string,
  subespecialidadId?: string,
  obraSocialId?: string,
): Promise<ApiResponse<any>> {
  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "Se requiere el ID del cliente",
      },
    }
  }

  if (!rangoFechas || typeof rangoFechas !== "string") {
    return {
      exito: false,
      error: {
        codigo: "RANGO_FECHAS_INVALIDO",
        mensaje: "Se requiere un rango de fechas válido",
      },
    }
  }

  // Extraer fechas desde y hasta del rango
  const [fechaDesde, fechaHasta] = rangoFechas.split(" a ")

  // Si tenemos el ID del profesional, usarlo directamente
  if (profesionalId) {
    return obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde, profesionalId, pacienteDNI, true, sedeId, subespecialidadId, obraSocialId)
  }

  // Si tenemos el nombre del profesional o especialidad, primero buscar el profesional
  if (profesional || especialidad) {
    const busqueda = profesional || especialidad || ""
    const profesionalesResponse = await buscarProfesionales(clienteId, busqueda)

    if (!profesionalesResponse.exito || !profesionalesResponse.datos || profesionalesResponse.datos.length === 0) {
      return {
        exito: false,
        error: {
          codigo: "PROFESIONAL_NO_ENCONTRADO",
          mensaje: `No se encontraron profesionales con el criterio: ${busqueda}`,
        },
      }
    }

    // Si hay múltiples profesionales, devolver la lista para que el usuario elija
    if (profesionalesResponse.datos.length > 1) {
      return {
        exito: true,
        datos: {
          multiple: true,
          profesionales: profesionalesResponse.datos,
          mensaje: "Se encontraron múltiples profesionales. Por favor, seleccione uno.",
        },
      }
    }

    // Si solo hay un profesional, usar su ID para buscar turnos
    const profesionalEncontrado = profesionalesResponse.datos[0]
    return obtenerTurnos(
      clienteId,
      fechaDesde,
      fechaHasta || fechaDesde,
      profesionalEncontrado.id,
      pacienteDNI,
      true,
      sedeId,
      subespecialidadId,
      obraSocialId,
    )
  }

  // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
  return obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde, undefined, pacienteDNI, true, sedeId, subespecialidadId, obraSocialId)
}

// Compatibilidad: procesar reserva de turno
export async function procesarReservaTurno(
  dni: string,
  fecha: string,
  hora: string,
  profesional: string,
  clienteId?: string,
): Promise<ApiResponse<any>> {
  if (!clienteId) {
    return {
      exito: false,
      error: {
        codigo: "CLIENTE_ID_FALTANTE",
        mensaje: "Se requiere el ID del cliente",
      },
    }
  }

  try {
    console.log(`[API] 🎯 Reservando turno: DNI=${dni}, fecha=${fecha}, hora=${hora}, profesional=${profesional}`)

    // 1. Primero obtenemos los datos del paciente
    const pacienteResponse = await buscarPaciente(clienteId, { dni })
    if (!pacienteResponse.exito || !pacienteResponse.datos) {
      return {
        exito: false,
        error: {
          codigo: "PACIENTE_NO_ENCONTRADO",
          mensaje: "No se encontró información del paciente con el DNI proporcionado",
        },
      }
    }

    const paciente = pacienteResponse.datos

    // 2. Buscar el profesional por nombre
    const profesionalesResponse = await buscarProfesionales(clienteId, profesional)
    if (!profesionalesResponse.exito || !profesionalesResponse.datos || profesionalesResponse.datos.length === 0) {
      return {
        exito: false,
        error: {
          codigo: "PROFESIONAL_NO_ENCONTRADO",
          mensaje: `No se encontró el profesional: ${profesional}`,
        },
      }
    }

    // Tomar el primer profesional que coincida con el nombre
    const profesionalEncontrado = profesionalesResponse.datos.find((p) =>
      p.nombre.toLowerCase().includes(profesional.toLowerCase()),
    )

    if (!profesionalEncontrado) {
      return {
        exito: false,
        error: {
          codigo: "PROFESIONAL_NO_ENCONTRADO",
          mensaje: `No se encontró el profesional: ${profesional}`,
        },
      }
    }

    // 3. Buscar turnos disponibles para ese profesional en esa fecha
    const turnosResponse = await obtenerTurnos(clienteId, fecha, fecha, profesionalEncontrado.id)

    if (!turnosResponse.exito || !turnosResponse.datos) {
      return {
        exito: false,
        error: {
          codigo: "TURNOS_NO_ENCONTRADOS",
          mensaje: "No se encontraron turnos disponibles para la fecha y profesional indicados",
        },
      }
    }

    // 4. Buscar el turno específico por hora
    let agendaId = null
    const turnos = turnosResponse.datos

    // La estructura exacta dependerá de cómo devuelve los datos tu API
    for (const turno of turnos) {
      if (turno.hora === hora || turno.hora.startsWith(hora)) {
        agendaId = turno.id || turno.agenda_id
        break
      }
    }

    if (!agendaId) {
      return {
        exito: false,
        error: {
          codigo: "TURNO_NO_ENCONTRADO",
          mensaje: "No se encontró un turno disponible para la fecha, hora y profesional indicados",
        },
      }
    }

    // 5. Reservar el turno
    const reservaResponse = await reservarTurno(clienteId, agendaId, {
      nombre: paciente.nombre || "",
      apellido: paciente.apellido || "",
      dni: dni,
      telefono: paciente.telefono || "0000000000", // Campo obligatorio
      email: paciente.email || "sin-email@example.com", // Campo obligatorio
    })

    return reservaResponse
  } catch (error) {
    console.error("[API] ❌ Error al procesar reserva:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_PROCESAMIENTO",
        mensaje: error instanceof Error ? error.message : "Error desconocido al procesar la reserva",
      },
    }
  }
}

// Función para obtener especialidades (alias para subespecialidades)
export async function obtenerEspecialidades(
  clienteId: string,
  useCache = true,
): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
  return obtenerSubespecialidades(clienteId, useCache)
}
