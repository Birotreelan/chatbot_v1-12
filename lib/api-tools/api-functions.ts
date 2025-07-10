import { getRedisClient } from "@/lib/redis"

// Configuración de caché
const CACHE_TTL = 300 // 5 minutos
const CACHE_PREFIX = "api_cache:"

// Función helper para logging
function logApiCall(functionName: string, clienteId: string, params: any) {
  console.log(`[API-TOOLS] 🔧 ${functionName}`)
  console.log(`[API-TOOLS] 📋 Cliente: ${clienteId}`)
  console.log(`[API-TOOLS] 📋 Parámetros:`, params)
}

// Función helper para caché
async function getCachedData(key: string): Promise<any> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const cached = await redis.get(key)
    if (cached) {
      console.log(`[CACHE] ✅ Hit para ${key}`)
      // Verificar si es string antes de parsear
      if (typeof cached === "string") {
        try {
          return JSON.parse(cached)
        } catch (parseError) {
          console.warn(`[CACHE] ⚠️ Error parsing cached data for ${key}:`, parseError)
          return null
        }
      } else {
        // Si ya es un objeto, devolverlo directamente
        return cached
      }
    }

    console.log(`[CACHE] ❌ Miss para ${key}`)
    return null
  } catch (error) {
    console.warn(`[CACHE] ⚠️ Error accessing cache for ${key}:`, error)
    return null
  }
}

async function setCachedData(key: string, data: any, ttl: number = CACHE_TTL): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return

    // Siempre guardar como string JSON
    const jsonString = JSON.stringify(data)
    await redis.setex(key, ttl, jsonString)
    console.log(`[CACHE] 💾 Guardado ${key}`)
  } catch (error) {
    console.warn(`[CACHE] ⚠️ Error setting cache for ${key}:`, error)
  }
}

// Función helper para hacer requests a la API
async function makeApiRequest(clienteId: string, action: string, additionalParams: any = {}): Promise<any> {
  const proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL
  if (!proxyUrl) {
    throw new Error("URL del proxy no configurada")
  }

  const requestBody = {
    Cliente_Id: clienteId,
    Action: action,
    ...additionalParams,
  }

  console.log(`[API-TOOLS] 🌐 Request: ${proxyUrl}`)
  console.log(`[API-TOOLS] 📦 Body:`, requestBody)

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const data = await response.json()
  console.log(`[API-TOOLS] 📥 Response:`, data)
  return data
}

// Función para buscar paciente por DNI
export async function buscarPaciente(clienteId: string, params: { dni: string }): Promise<any> {
  logApiCall("buscarPaciente", clienteId, params)

  try {
    const cacheKey = `${CACHE_PREFIX}paciente_${clienteId}_${params.dni}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "buscar_paciente", {
      dni: params.dni,
    })

    // Guardar en caché
    await setCachedData(cacheKey, result)

    return result
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
export async function validarObraSocial(clienteId: string, busqueda: string): Promise<any> {
  logApiCall("validarObraSocial", clienteId, { busqueda })

  try {
    const cacheKey = `${CACHE_PREFIX}obras_sociales_${clienteId}`

    // Intentar obtener de caché
    let obrasSociales = await getCachedData(cacheKey)

    if (!obrasSociales) {
      // Hacer request a la API para obtener todas las obras sociales
      obrasSociales = await makeApiRequest(clienteId, "get_obras_sociales")

      // Guardar en caché
      await setCachedData(cacheKey, obrasSociales)
    }

    // Buscar la obra social específica
    if (obrasSociales && obrasSociales.exito && obrasSociales.datos) {
      const obras = Array.isArray(obrasSociales.datos) ? obrasSociales.datos : []
      const busquedaLower = busqueda.toLowerCase()

      const coincidencias = obras.filter(
        (obra: any) => obra.nombre && obra.nombre.toLowerCase().includes(busquedaLower),
      )

      if (coincidencias.length > 0) {
        return {
          exito: true,
          datos: coincidencias,
          mensaje: `Se encontraron ${coincidencias.length} obra(s) social(es) que coinciden con "${busqueda}"`,
        }
      } else {
        return {
          exito: false,
          error: {
            codigo: "OBRA_SOCIAL_NO_ENCONTRADA",
            mensaje: `No se encontró ninguna obra social que coincida con "${busqueda}"`,
          },
        }
      }
    }

    return {
      exito: false,
      error: {
        codigo: "ERROR_OBTENER_OBRAS_SOCIALES",
        mensaje: "No se pudieron obtener las obras sociales",
      },
    }
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
export async function obtenerSubespecialidades(clienteId: string): Promise<any> {
  logApiCall("obtenerSubespecialidades", clienteId, {})

  try {
    const cacheKey = `${CACHE_PREFIX}subespecialidades_${clienteId}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "get_subespecialidades")

    // Guardar en caché
    await setCachedData(cacheKey, result, 3600) // 1 hora para especialidades

    return result
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
export async function buscarProfesionales(clienteId: string, busqueda: string): Promise<any> {
  logApiCall("buscarProfesionales", clienteId, { busqueda })

  try {
    const cacheKey = `${CACHE_PREFIX}profesionales_${clienteId}_${busqueda}`

    // Intentar obtener de caché
    const cachedResult = await getCachedData(cacheKey)
    if (cachedResult) {
      return cachedResult
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "buscar_profesionales", {
      busqueda,
    })

    // Guardar en caché
    await setCachedData(cacheKey, result, 1800) // 30 minutos

    return result
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
): Promise<any> {
  logApiCall("obtenerTurnos", clienteId, {
    fechaDesde,
    fechaHasta,
    profesionalId,
    pacienteDni,
  })

  try {
    // Hacer request a la API (no cachear turnos por ser datos dinámicos)
    const result = await makeApiRequest(clienteId, "get_turnos", {
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      profesional_id: profesionalId,
      paciente_dni: pacienteDni,
    })

    return result
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
export async function reservarTurno(clienteId: string, agendaId: string, pacienteData: any): Promise<any> {
  logApiCall("reservarTurno", clienteId, { agendaId, pacienteData })

  try {
    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "reservar_turno", {
      agenda_id: agendaId,
      paciente_data: pacienteData,
    })

    return result
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

// Funciones de compatibilidad con el código anterior

// Compatibilidad: buscar paciente por DNI
export async function paciente_dni(dni: string, clienteId: string): Promise<any> {
  return buscarPaciente(clienteId, { dni })
}

// Compatibilidad: buscar paciente por DNI
export async function buscarPacientePorDNI(dni: string, clienteId: string): Promise<any> {
  return buscarPaciente(clienteId, { dni })
}

// Compatibilidad: obtener citas de un paciente
export async function obtenerCitasPaciente(
  pacienteDNI: string,
  fechaDesde: string,
  fechaHasta: string,
  clienteId: string,
): Promise<any> {
  return obtenerTurnos(clienteId, fechaDesde, fechaHasta, undefined, pacienteDNI)
}

// Compatibilidad: obtener agenda
export async function obtenerAgenda(
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  clienteId?: string,
): Promise<any> {
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
export async function verificarDisponibilidad(fecha: string, profesionalId?: string, clienteId?: string): Promise<any> {
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
export async function obtenerDoctores(clienteId: string): Promise<any> {
  return buscarProfesionales(clienteId, "")
}

// Compatibilidad: buscar turnos disponibles
export async function buscarTurnosDisponibles(
  rangoFechas: string,
  profesional?: string,
  especialidad?: string,
  profesionalId?: string,
  clienteId?: string,
): Promise<any> {
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
): Promise<any> {
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
export async function obtenerEspecialidades(clienteId: string, useCache = true): Promise<any> {
  return obtenerSubespecialidades(clienteId)
}
