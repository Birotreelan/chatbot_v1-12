interface ClinicAPIResponse<T = any> {
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

class ClinicAPILogger {
  private context: string

  constructor(context: string) {
    this.context = context
  }

  log(level: "INFO" | "ERROR" | "WARN" | "DEBUG", message: string, data?: any) {
    const timestamp = new Date().toISOString()
    const prefix = `[${this.context}] [${level}]`

    if (data) {
      console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2))
    } else {
      console.log(`${prefix} ${message}`)
    }
  }

  info(message: string, data?: any) {
    this.log("INFO", message, data)
  }
  error(message: string, data?: any) {
    this.log("ERROR", message, data)
  }
  warn(message: string, data?: any) {
    this.log("WARN", message, data)
  }
  debug(message: string, data?: any) {
    this.log("DEBUG", message, data)
  }
}

// Función base para hacer requests a la API de la clínica
async function makeClinicAPIRequest<T>(
  endpoint: string,
  clienteId: string,
  options: RequestInit = {},
  timeout = 30000,
): Promise<ClinicAPIResponse<T>> {
  const logger = new ClinicAPILogger("CLINIC-API")

  const baseUrl = process.env.CLINIC_PROXY_URL || process.env.PROXY_API_URL
  if (!baseUrl) {
    throw new Error("CLINIC_PROXY_URL o PROXY_API_URL no configurada")
  }

  const url = `${baseUrl}${endpoint}`

  logger.info("Haciendo request a API de clínica", {
    url,
    clienteId,
    method: options.method || "GET",
    timeout,
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Cliente-ID": clienteId,
        ...options.headers,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseText = await response.text()
    logger.debug("Respuesta de API de clínica", {
      status: response.status,
      statusText: response.statusText,
      responseLength: responseText.length,
    })

    if (!response.ok) {
      logger.error("Error en API de clínica", {
        status: response.status,
        responseText: responseText.substring(0, 500),
      })

      return {
        success: false,
        error: `HTTP ${response.status}: ${responseText}`,
      }
    }

    try {
      const data = JSON.parse(responseText)
      logger.info("Request exitoso a API de clínica")

      return {
        success: true,
        data,
      }
    } catch (parseError) {
      logger.error("Error parseando respuesta JSON", { parseError, responseText: responseText.substring(0, 200) })

      return {
        success: false,
        error: "Error parseando respuesta JSON",
      }
    }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error.name === "AbortError") {
      logger.error("Timeout en request a API de clínica", { timeout })
      return {
        success: false,
        error: `Timeout después de ${timeout}ms`,
      }
    }

    logger.error("Error en request a API de clínica", { error: error.message })

    return {
      success: false,
      error: error.message,
    }
  }
}

export async function getSedes(clienteId: string, sedeId?: string): Promise<ClinicAPIResponse<Sede[]>> {
  const logger = new ClinicAPILogger("GET-SEDES")

  logger.info("Obteniendo sedes", { clienteId, sedeId })

  try {
    const endpoint = sedeId ? `/sedes/${sedeId}` : "/sedes"
    const result = await makeClinicAPIRequest<Sede[]>(endpoint, clienteId)

    if (result.success) {
      logger.info("Sedes obtenidas exitosamente", {
        count: Array.isArray(result.data) ? result.data.length : 1,
      })
    }

    return result
  } catch (error) {
    logger.error("Error obteniendo sedes", { error })
    return {
      success: false,
      error: error.message,
    }
  }
}

export async function getTurnos(
  clienteId: string,
  sedeId: string,
  fechaDesde: string,
  fechaHasta: string,
): Promise<ClinicAPIResponse<Turno[]>> {
  const logger = new ClinicAPILogger("GET-TURNOS")

  logger.info("Obteniendo turnos", { clienteId, sedeId, fechaDesde, fechaHasta })

  try {
    const params = new URLSearchParams({
      sede_id: sedeId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    })

    const endpoint = `/turnos?${params.toString()}`
    const result = await makeClinicAPIRequest<Turno[]>(endpoint, clienteId)

    if (result.success) {
      logger.info("Turnos obtenidos exitosamente", {
        count: Array.isArray(result.data) ? result.data.length : 0,
      })
    }

    return result
  } catch (error) {
    logger.error("Error obteniendo turnos", { error })
    return {
      success: false,
      error: error.message,
    }
  }
}

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
): Promise<ClinicAPIResponse<Turno>> {
  const logger = new ClinicAPILogger("CREAR-TURNO")

  logger.info("Creando turno", { clienteId, turnoData })

  try {
    const result = await makeClinicAPIRequest<Turno>("/turnos", clienteId, {
      method: "POST",
      body: JSON.stringify(turnoData),
    })

    if (result.success) {
      logger.info("Turno creado exitosamente", { turnoId: result.data?.id })
    }

    return result
  } catch (error) {
    logger.error("Error creando turno", { error })
    return {
      success: false,
      error: error.message,
    }
  }
}

export async function buscarPaciente(clienteId: string, dni: string): Promise<ClinicAPIResponse<Paciente[]>> {
  const logger = new ClinicAPILogger("BUSCAR-PACIENTE")

  logger.info("Buscando paciente", { clienteId, dni })

  try {
    const params = new URLSearchParams({ dni })
    const endpoint = `/pacientes/buscar?${params.toString()}`

    const result = await makeClinicAPIRequest<Paciente[]>(endpoint, clienteId)

    if (result.success) {
      logger.info("Búsqueda de paciente completada", {
        count: Array.isArray(result.data) ? result.data.length : 0,
      })
    }

    return result
  } catch (error) {
    logger.error("Error buscando paciente", { error })
    return {
      success: false,
      error: error.message,
    }
  }
}

export async function getMedicos(clienteId: string, sedeId?: string): Promise<ClinicAPIResponse<any[]>> {
  const logger = new ClinicAPILogger("GET-MEDICOS")

  logger.info("Obteniendo médicos", { clienteId, sedeId })

  try {
    const params = sedeId ? new URLSearchParams({ sede_id: sedeId }) : new URLSearchParams()
    const endpoint = `/medicos${params.toString() ? "?" + params.toString() : ""}`

    const result = await makeClinicAPIRequest<any[]>(endpoint, clienteId)

    if (result.success) {
      logger.info("Médicos obtenidos exitosamente", {
        count: Array.isArray(result.data) ? result.data.length : 0,
      })
    }

    return result
  } catch (error) {
    logger.error("Error obteniendo médicos", { error })
    return {
      success: false,
      error: error.message,
    }
  }
}

export async function getHorariosDisponibles(
  clienteId: string,
  medicoId: string,
  sedeId: string,
  fecha: string,
): Promise<ClinicAPIResponse<string[]>> {
  const logger = new ClinicAPILogger("GET-HORARIOS")

  logger.info("Obteniendo horarios disponibles", { clienteId, medicoId, sedeId, fecha })

  try {
    const params = new URLSearchParams({
      medico_id: medicoId,
      sede_id: sedeId,
      fecha: fecha,
    })

    const endpoint = `/horarios-disponibles?${params.toString()}`
    const result = await makeClinicAPIRequest<string[]>(endpoint, clienteId)

    if (result.success) {
      logger.info("Horarios obtenidos exitosamente", {
        count: Array.isArray(result.data) ? result.data.length : 0,
      })
    }

    return result
  } catch (error) {
    logger.error("Error obteniendo horarios", { error })
    return {
      success: false,
      error: error.message,
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
export type { Sede, Turno, Paciente, ClinicAPIResponse }
