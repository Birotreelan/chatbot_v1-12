import { redis } from "@/lib/redis"

// Configuración de la API
const API_BASE_URL = process.env.PROXY_API_URL || "https://proxy.santiagovulliez.com/proxy_service/"

// Configuración de caché
const CACHE_TTL = {
  PACIENTE: 300, // 5 minutos
  OBRAS_SOCIALES: 1800, // 30 minutos
  SUBESPECIALIDADES: 3600, // 1 hora
  PROFESIONALES: 1800, // 30 minutos
  TURNOS: 300, // 5 minutos
}

// Función helper para hacer requests a la API
async function makeApiRequest(clienteId: string, action: string, additionalParams: Record<string, any> = {}) {
  console.log(`[API-TOOLS] 🔧 ${action}`)
  console.log(`[API-TOOLS] 📋 Cliente: ${clienteId}`)
  console.log(`[API-TOOLS] 📋 Parámetros:`, additionalParams)

  try {
    const body = {
      Cliente_Id: clienteId,
      Action: action,
      ...additionalParams,
    }

    console.log(`[API-TOOLS] 🌐 Request: ${API_BASE_URL}`)
    console.log(`[API-TOOLS] 📦 Body:`, body)

    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()
    console.log(`[API-TOOLS] 📥 Response:`, result)

    return result
  } catch (error) {
    console.error(`[API-TOOLS] ❌ Error en ${action}:`, error)
    throw error
  }
}

// Función helper para caché
async function getCachedData(key: string): Promise<any | null> {
  try {
    const cached = await redis.get(key)
    if (cached) {
      console.log(`[CACHE] ✅ Hit para ${key}`)
      return JSON.parse(cached)
    }
    console.log(`[CACHE] ❌ Miss para ${key}`)
    return null
  } catch (error) {
    console.error(`[CACHE] ❌ Error obteniendo ${key}:`, error)
    return null
  }
}

async function setCachedData(key: string, data: any, ttl: number): Promise<void> {
  try {
    await redis.setex(key, ttl, JSON.stringify(data))
    console.log(`[CACHE] 💾 Guardado ${key}`)
  } catch (error) {
    console.error(`[CACHE] ❌ Error guardando ${key}:`, error)
  }
}

// 1. Buscar paciente por DNI
export async function buscarPaciente(clienteId: string, params: { dni: string }) {
  const cacheKey = `api_cache:paciente_${clienteId}_${params.dni}`

  try {
    // Verificar caché
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return cached
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "buscar_paciente", {
      dni: params.dni,
    })

    // Procesar respuesta
    let response
    if (result.success && result.data) {
      response = {
        exito: true,
        datos: result.data,
      }
    } else if (result.error) {
      response = {
        exito: false,
        error: {
          codigo: "PACIENTE_NO_ENCONTRADO",
          mensaje: result.error,
        },
      }
    } else {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_BUSCAR_PACIENTE",
          mensaje: "No se pudo buscar el paciente",
        },
      }
    }

    // Guardar en caché
    await setCachedData(cacheKey, response, CACHE_TTL.PACIENTE)

    return response
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en buscarPaciente:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_BUSCAR_PACIENTE",
        mensaje: "Error interno al buscar paciente",
      },
    }
  }
}

// 2. Obtener subespecialidades
export async function obtenerSubespecialidades(clienteId: string) {
  const cacheKey = `api_cache:subespecialidades_${clienteId}`

  try {
    // Verificar caché
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return cached
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "get_subespecialidades")

    // Procesar respuesta
    let response
    if (result.success && result.data) {
      response = {
        exito: true,
        datos: result.data,
      }
    } else if (result.error) {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_SUBESPECIALIDADES",
          mensaje: result.error,
        },
      }
    } else {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_SUBESPECIALIDADES",
          mensaje: "No se pudieron obtener las subespecialidades",
        },
      }
    }

    // Guardar en caché
    await setCachedData(cacheKey, response, CACHE_TTL.SUBESPECIALIDADES)

    return response
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en obtenerSubespecialidades:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_OBTENER_SUBESPECIALIDADES",
        mensaje: "Error interno al obtener subespecialidades",
      },
    }
  }
}

// 3. Buscar profesionales
export async function buscarProfesionales(clienteId: string, busqueda: string) {
  const cacheKey = `api_cache:profesionales_${clienteId}_${busqueda}`

  try {
    // Verificar caché
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return cached
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "buscar_profesionales", {
      busqueda: busqueda,
    })

    // Procesar respuesta
    let response
    if (result.success && result.data) {
      response = {
        exito: true,
        datos: result.data,
      }
    } else if (result.error) {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_BUSCAR_PROFESIONALES",
          mensaje: result.error,
        },
      }
    } else {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_BUSCAR_PROFESIONALES",
          mensaje: "No se pudieron buscar profesionales",
        },
      }
    }

    // Guardar en caché
    await setCachedData(cacheKey, response, CACHE_TTL.PROFESIONALES)

    return response
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en buscarProfesionales:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_BUSCAR_PROFESIONALES",
        mensaje: "Error interno al buscar profesionales",
      },
    }
  }
}

// 4. Obtener turnos disponibles
export async function obtenerTurnos(
  clienteId: string,
  fechaDesde: string,
  fechaHasta: string,
  profesionalId?: string,
  pacienteDni?: string,
) {
  const cacheKey = `api_cache:turnos_${clienteId}_${fechaDesde}_${fechaHasta}_${profesionalId || "all"}`

  try {
    // Verificar caché
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return cached
    }

    // Preparar parámetros
    const params: any = {
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    }

    if (profesionalId) {
      params.profesional_id = profesionalId
    }

    if (pacienteDni) {
      params.paciente_dni = pacienteDni
    }

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "get_turnos", params)

    // Procesar respuesta
    let response
    if (result.success && result.data) {
      response = {
        exito: true,
        datos: result.data,
      }
    } else if (result.error) {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_TURNOS",
          mensaje: result.error,
        },
      }
    } else {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_TURNOS",
          mensaje: "No se pudieron obtener los turnos",
        },
      }
    }

    // Guardar en caché
    await setCachedData(cacheKey, response, CACHE_TTL.TURNOS)

    return response
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en obtenerTurnos:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_OBTENER_TURNOS",
        mensaje: "Error interno al obtener turnos",
      },
    }
  }
}

// 5. Reservar turno
export async function reservarTurno(clienteId: string, agendaId: string, pacienteData: any) {
  try {
    console.log(`[API-TOOLS] 🎯 Reservando turno`)
    console.log(`[API-TOOLS] 📋 Cliente: ${clienteId}`)
    console.log(`[API-TOOLS] 📋 Agenda ID: ${agendaId}`)
    console.log(`[API-TOOLS] 📋 Datos paciente:`, pacienteData)

    // Hacer request a la API
    const result = await makeApiRequest(clienteId, "reservar_turno", {
      agenda_id: agendaId,
      paciente_nombre: pacienteData.nombre,
      paciente_apellido: pacienteData.apellido,
      paciente_dni: pacienteData.dni,
      paciente_telefono: pacienteData.telefono,
      paciente_email: pacienteData.email,
      paciente_fecha_nac: pacienteData.fechaNacimiento,
      paciente_direccion: pacienteData.direccion,
      paciente_localidad: pacienteData.localidad,
      paciente_provincia: pacienteData.provincia,
      paciente_sexo: pacienteData.sexo,
      paciente_tipo_doc: pacienteData.tipoDoc,
      deudor_id: pacienteData.deudorId,
      plan_id: pacienteData.planId,
      nro_afiliado: pacienteData.nroAfiliado,
      turno_motivo: pacienteData.turnoMotivo,
      comentarios: pacienteData.comentarios,
    })

    // Procesar respuesta
    if (result.success && result.data) {
      return {
        exito: true,
        datos: result.data,
      }
    } else if (result.error) {
      return {
        exito: false,
        error: {
          codigo: "ERROR_RESERVAR_TURNO",
          mensaje: result.error,
        },
      }
    } else {
      return {
        exito: false,
        error: {
          codigo: "ERROR_RESERVAR_TURNO",
          mensaje: "No se pudo reservar el turno",
        },
      }
    }
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en reservarTurno:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_RESERVAR_TURNO",
        mensaje: "Error interno al reservar turno",
      },
    }
  }
}

// 6. Validar obra social - CORREGIDA
export async function validarObraSocial(clienteId: string, busqueda: string) {
  const cacheKey = `api_cache:obra_social_${clienteId}_${busqueda}`

  try {
    // Verificar caché
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return cached
    }

    // Hacer request a la API con el parámetro de búsqueda
    const result = await makeApiRequest(clienteId, "get_obras_sociales", {
      busqueda: busqueda,
    })

    // Procesar respuesta
    let response
    if (result.success && result.data) {
      // Filtrar resultados que coincidan con la búsqueda
      const obrasSociales = Array.isArray(result.data) ? result.data : []
      const obrasSocialesFiltradas = obrasSociales.filter((obra: any) =>
        obra.nombre?.toLowerCase().includes(busqueda.toLowerCase()),
      )

      response = {
        exito: true,
        datos: obrasSocialesFiltradas,
        total: obrasSocialesFiltradas.length,
      }
    } else if (result.error) {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_OBRAS_SOCIALES",
          mensaje: result.error,
        },
      }
    } else {
      response = {
        exito: false,
        error: {
          codigo: "ERROR_OBTENER_OBRAS_SOCIALES",
          mensaje: "No se pudieron obtener las obras sociales",
        },
      }
    }

    // Guardar en caché
    await setCachedData(cacheKey, response, CACHE_TTL.OBRAS_SOCIALES)

    return response
  } catch (error) {
    console.error("[API-TOOLS] ❌ Error en validarObraSocial:", error)
    return {
      exito: false,
      error: {
        codigo: "ERROR_OBTENER_OBRAS_SOCIALES",
        mensaje: "Error interno al validar obra social",
      },
    }
  }
}
