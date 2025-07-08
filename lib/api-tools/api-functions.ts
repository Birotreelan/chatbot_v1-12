import { Redis } from "@upstash/redis"
import type { Paciente, Cita, DisponibilidadHoraria, ApiResponse } from "./types"

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

// Obtener cliente de Redis
function getRedisClient() {
  try {
    return Redis.fromEnv()
  } catch (error) {
    console.warn("Upstash Redis no está disponible:", error)
    return null
  }
}

// Función para generar clave de caché
function getCacheKey(action: string, params: Record<string, any>): string {
  return `${CACHE_PREFIX}${action}:${JSON.stringify(params)}`
}

// Modificar fetchProxyApi para usar caché
async function fetchProxyApi<T>(
  clienteId: string,
  action: string,
  params: Record<string, any> = {},
  useCache = true,
): Promise<ApiResponse<T>> {
  // Generar clave de caché
  const cacheKey = getCacheKey(action, { clienteId, ...params })
  const redis = getRedisClient()

  // Verificar caché si está habilitada
  if (useCache && redis) {
    const cachedData = await redis.get(cacheKey)
    if (cachedData) {
      console.log(`Usando datos en caché para ${action}`)
      return JSON.parse(cachedData as string)
    }
  }

  try {
    // Usar la URL hardcodeada en lugar del parámetro
    const proxyUrl = getProxyUrl()

    console.log(`Realizando petición POST a: ${proxyUrl}`)
    console.log(`Action: ${action}, Cliente_Id: ${clienteId}`)
    console.log(`Parámetros:`, params)

    // Preparar el cuerpo de la solicitud - asegurarnos de que Cliente_Id está exactamente como se espera
    const requestBody = {
      Cliente_Id: clienteId.trim(), // Eliminar espacios en blanco por si acaso
      Action: action,
      ...params,
    }

    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    // Hacer la petición POST
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    // Obtener el texto de la respuesta
    const responseText = await response.text()
    console.log(`Respuesta (texto) recibida:`, responseText)

    // Intentar parsear la respuesta como JSON
    let data
    try {
      data = JSON.parse(responseText)
      console.log(`Respuesta (JSON) parseada:`, data)
    } catch (e) {
      console.error(`Error al parsear la respuesta JSON:`, e)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_INVALIDO",
          mensaje: `La API devolvió una respuesta con formato inválido: ${responseText.substring(0, 100)}...`,
        },
      }
    }

    // Verificar si hay un error específico de Cliente_Id
    if (data.error && typeof data.error === "string" && data.error.includes("Cliente_Id")) {
      console.error(`Error de Cliente_Id:`, data.error)
      return {
        exito: false,
        error: {
          codigo: "CLIENTE_ID_INVALIDO",
          mensaje: data.error,
        },
      }
    }

    // Verificar si hay un error de la API
    if (!response.ok) {
      console.error(`Error HTTP en la respuesta: ${response.status} ${response.statusText}`)
      return {
        exito: false,
        error: {
          codigo: `HTTP_${response.status}`,
          mensaje: data?.message || data?.error || response.statusText || "Error desconocido",
        },
      }
    }

    // Si la respuesta tiene un formato específico de error
    if (data.error) {
      console.error(`Error en los datos de la respuesta:`, data.error)
      return {
        exito: false,
        error: {
          codigo: "API_ERROR",
          mensaje: typeof data.error === "string" ? data.error : data.error.message || "Error desconocido",
        },
      }
    }

    // Si la respuesta tiene un campo "success"
    if (data.success !== undefined) {
      if (!data.success) {
        console.error(`La API indicó éxito=false:`, data)
        return {
          exito: false,
          error: {
            codigo: "API_ERROR",
            mensaje: data.message || "Error desconocido",
          },
        }
      }
      return {
        exito: true,
        datos: data.data,
      }
    }

    // Si llegamos aquí, asumimos que la respuesta es exitosa
    return { exito: true, datos: data }
  } catch (error) {
    // Manejar errores de red u otros
    console.error(`Error de red o durante el procesamiento:`, error)
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

  // Convertir los parámetros al formato esperado por el API
  const apiParams: Record<string, any> = {}
  if (params.dni) apiParams.dni = params.dni
  if (params.telefono) apiParams.telefono = params.telefono

  return fetchProxyApi<Paciente | null>(clienteId, "get_paciente", apiParams, useCache)
}

// Función para obtener subespecialidades
export async function obtenerSubespecialidades(
  clienteId: string,
  useCache = true,
): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
  // Las subespecialidades cambian con poca frecuencia, podemos cachear por más tiempo
  return fetchProxyApi<{ id: string; nombre: string }[]>(clienteId, "get_subespecialidades", {}, useCache)
}

// Función para buscar profesionales por nombre o especialidad
export async function buscarProfesionales(
  clienteId: string,
  busqueda: string,
  useCache = true,
): Promise<ApiResponse<{ id: string; nombre: string; especialidad?: string }[]>> {
  return fetchProxyApi<{ id: string; nombre: string; especialidad?: string }[]>(
    clienteId,
    "get_profesionales",
    { busqueda },
    useCache,
  )
}

// Función para obtener turnos disponibles o agendados
export async function obtenerTurnos(
  clienteId: string,
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  pacienteDNI?: string,
  useCache = true,
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

  return fetchProxyApi<any>(clienteId, "get_turnos", params, useCache)
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
  if (pacienteData.planId) params.Plan_Id = pacienteData.planId
  if (pacienteData.nroAfiliado) params.Nro_Afiliado = pacienteData.nroAfiliado
  if (pacienteData.turnoMotivo) params.Turno_Motivo = pacienteData.turnoMotivo
  if (pacienteData.comentarios) params.Comentarios = pacienteData.comentarios

  return fetchProxyApi<any>(clienteId, "set_turno", params, useCache)
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

  // Extraer fechas desde y hasta del rango
  const [fechaDesde, fechaHasta] = rangoFechas.split(" a ")

  // Si tenemos el ID del profesional, usarlo directamente
  if (profesionalId) {
    return obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde, profesionalId)
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
    return obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde, profesionalEncontrado.id)
  }

  // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
  return obtenerTurnos(clienteId, fechaDesde, fechaHasta || fechaDesde)
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
    console.log(
      `Procesando reserva de turno para DNI: ${dni}, fecha: ${fecha}, hora: ${hora}, profesional: ${profesional}`,
    )

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
    // Este es un ejemplo genérico que deberás adaptar
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
    console.error("Error al procesar la reserva del turno:", error)
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
