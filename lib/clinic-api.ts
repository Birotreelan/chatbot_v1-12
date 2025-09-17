import type { ApiResponse, Paciente } from "./api-tools/types"

// Función helper para obtener fechas dinámicas
function getDefaultDateRange(): string {
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(today.getDate() + 7)

  const formatDate = (date: Date): string => {
    return date.toISOString().split("T")[0] // YYYY-MM-DD
  }

  return `${formatDate(today)} a ${formatDate(nextWeek)}`
}

// Clase ClinicAPI para interactuar con el middleware proxy
export class ClinicAPI {
  private proxyUrl: string
  private clienteId: string

  constructor(clienteId: string) {
    this.clienteId = clienteId
    this.proxyUrl = process.env.PROXY_API_URL || process.env.CLINIC_PROXY_URL || ""

    if (!this.proxyUrl) {
      throw new Error("PROXY_API_URL o CLINIC_PROXY_URL debe estar configurada en las variables de entorno")
    }
  }

  /**
   * Realiza una petición POST al middleware proxy
   */
  private async fetchProxyApi<T>(action: string, params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    try {
      console.log(`Realizando petición POST a: ${this.proxyUrl}`)
      console.log(`Action: ${action}, Cliente_Id: ${this.clienteId}`)
      console.log(`Parámetros:`, params)

      // Preparar el cuerpo de la solicitud - asegurarnos de que Cliente_Id está exactamente como se espera
      const requestBody = {
        Cliente_Id: this.clienteId.trim(), // Eliminar espacios en blanco por si acaso
        Action: action,
        ...params,
      }

      console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

      // Hacer la petición POST
      const response = await fetch(this.proxyUrl, {
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
              mensaje: data.message || data.mensaje || "Error desconocido",
            },
          }
        }
        // Si success es true, devolver los datos completos
        return {
          exito: true,
          datos: data, // Devolver toda la respuesta, no solo data.data
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

  /**
   * Busca un paciente por DNI
   */
  async paciente_dni(dni: string): Promise<ApiResponse<Paciente | null>> {
    return this.fetchProxyApi<Paciente | null>("get_paciente", { dni })
  }

  /**
   * Busca un paciente por teléfono
   */
  async paciente_telefono(telefono: string): Promise<ApiResponse<Paciente | null>> {
    return this.fetchProxyApi<Paciente | null>("get_paciente", { telefono })
  }

  /**
   * Obtiene las subespecialidades disponibles
   */
  async obtenerSubespecialidades(): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
    return this.fetchProxyApi<{ id: string; nombre: string }[]>("get_subespecialidades")
  }

  /**
   * Busca profesionales por nombre o especialidad
   */
  async buscarProfesionales(
    busqueda: string,
  ): Promise<ApiResponse<{ Id: string; Nombre_Completo: string; Especialidad?: string }[]>> {
    return this.fetchProxyApi<{ Id: string; Nombre_Completo: string; Especialidad?: string }[]>("get_profesionales", {
      busqueda,
    })
  }

  /**
   * Obtiene turnos disponibles o agendados
   */
  async obtenerTurnos(
    fechaDesde: string,
    fechaHasta: string,
    profesionalId?: string,
    pacienteDNI?: string,
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

    console.log(`🗓️ Buscando turnos con parámetros finales:`, params)

    return this.fetchProxyApi<any>("get_turnos", params)
  }

  /**
   * Busca turnos disponibles según el criterio elegido
   */
  async buscarTurnosDisponibles(
    rangoFechas: string,
    profesional?: string,
    especialidad?: string,
    profesionalId?: string,
  ): Promise<ApiResponse<any>> {
    try {
      // Si no se proporciona rango de fechas, usar fechas dinámicas
      let fechasAUsar = rangoFechas
      if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
        fechasAUsar = getDefaultDateRange()
        console.log(`📅 Usando rango de fechas dinámico: ${fechasAUsar}`)
      }

      // Extraer fechas desde y hasta del rango
      const fechas = fechasAUsar.split(" a ")
      const fechaDesde = fechas[0]?.trim()
      const fechaHasta = fechas[1]?.trim() || fechaDesde

      console.log(`🗓️ Buscando turnos desde ${fechaDesde} hasta ${fechaHasta}`)

      // Si tenemos el ID del profesional, usarlo directamente
      if (profesionalId) {
        console.log(`👨‍⚕️ Usando profesional ID directo: ${profesionalId}`)
        return this.obtenerTurnos(fechaDesde, fechaHasta, profesionalId)
      }

      // Si tenemos el nombre del profesional o especialidad, primero buscar el profesional
      if (profesional || especialidad) {
        const busqueda = profesional || especialidad || ""
        console.log(`🔍 Buscando profesional: ${busqueda}`)
        const profesionalesResponse = await this.buscarProfesionales(busqueda)

        if (!profesionalesResponse.exito) {
          console.log(`❌ Error al buscar profesionales:`, profesionalesResponse.error)
          return profesionalesResponse
        }

        // Verificar que tenemos datos y que tienen la estructura correcta
        if (!profesionalesResponse.datos) {
          console.log(`❌ No se recibieron datos de profesionales`)
          return {
            exito: false,
            error: {
              codigo: "PROFESIONAL_NO_ENCONTRADO",
              mensaje: `No se encontraron profesionales con el criterio: ${busqueda}`,
            },
          }
        }

        // La API devuelve { profesionales: [...] }, necesitamos extraer el array
        let profesionales: any[] = []
        if (Array.isArray(profesionalesResponse.datos)) {
          // Si ya es un array, usarlo directamente
          profesionales = profesionalesResponse.datos
        } else if (
          profesionalesResponse.datos.profesionales &&
          Array.isArray(profesionalesResponse.datos.profesionales)
        ) {
          // Si está dentro de una propiedad 'profesionales', extraerlo
          profesionales = profesionalesResponse.datos.profesionales
        } else {
          console.log(`❌ Estructura de datos inesperada:`, profesionalesResponse.datos)
          return {
            exito: false,
            error: {
              codigo: "FORMATO_DATOS_INVALIDO",
              mensaje: "Formato de datos de profesionales no reconocido",
            },
          }
        }

        console.log(`👥 Profesionales encontrados: ${profesionales.length}`)

        if (profesionales.length === 0) {
          return {
            exito: false,
            error: {
              codigo: "PROFESIONAL_NO_ENCONTRADO",
              mensaje: `No se encontraron profesionales con el criterio: ${busqueda}`,
            },
          }
        }

        // Si hay múltiples profesionales, devolver la lista para que el usuario elija
        if (profesionales.length > 1) {
          console.log(`📋 Se encontraron ${profesionales.length} profesionales`)
          return {
            exito: true,
            datos: {
              multiple: true,
              profesionales: profesionales,
              mensaje: "Se encontraron múltiples profesionales. Por favor, seleccione uno.",
            },
          }
        }

        // Si solo hay un profesional, usar su ID para buscar turnos
        const profesionalEncontrado = profesionales[0]
        console.log(`✅ Profesional encontrado: ${profesionalEncontrado.Nombre_Completo} (${profesionalEncontrado.Id})`)
        return this.obtenerTurnos(fechaDesde, fechaHasta, profesionalEncontrado.Id)
      }

      // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
      console.log(`🔍 Buscando todos los turnos disponibles`)
      return this.obtenerTurnos(fechaDesde, fechaHasta)
    } catch (error) {
      console.error(`❌ Error en buscarTurnosDisponibles:`, error)
      return {
        exito: false,
        error: {
          codigo: "ERROR_BUSQUEDA_TURNOS",
          mensaje: error instanceof Error ? error.message : "Error al buscar turnos disponibles",
        },
      }
    }
  }

  /**
   * Reserva un turno específico para un paciente
   */
  async reservarTurno(
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

    console.log(`🎯 Reservando turno con parámetros finales:`, params)

    return this.fetchProxyApi<any>("set_turno", params)
  }

  /**
   * Obtiene los datos de sedes disponibles
   */
  async obtenerSedes(sedeId?: string): Promise<ApiResponse<any>> {
    const params: Record<string, any> = {}

    if (sedeId) {
      params.sede_id = sedeId
    }

    return this.fetchProxyApi<any>("get_data_sedes", params)
  }
}

/**
 * Crea una instancia de ClinicAPI con la URL del proxy y el ID del cliente
 */
export function createClinicAPI(clienteId: string): ClinicAPI {
  if (!clienteId) {
    throw new Error("Se requiere el ID del cliente para crear una instancia de ClinicAPI")
  }
  return new ClinicAPI(clienteId)
}

/**
 * Valida un DNI usando la API de la clínica
 */
export async function validateDNI(
  dni: string,
  clienteId: string,
): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  try {
    console.log(`[VALIDATE-DNI] Validando DNI: ${dni} para cliente: ${clienteId}`)

    if (!clienteId) {
      console.error(`[VALIDATE-DNI] ❌ Cliente ID faltante`)
      return {
        success: false,
        error: "ID de cliente requerido",
      }
    }

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.paciente_dni(dni)

    if (response.exito && response.datos) {
      console.log(`[VALIDATE-DNI] ✅ DNI válido encontrado:`, response.datos)
      return {
        success: true,
        data: response.datos,
      }
    } else {
      console.log(`[VALIDATE-DNI] ❌ DNI no encontrado o error:`, response.error)
      return {
        success: false,
        error: response.error?.mensaje || "DNI no encontrado",
      }
    }
  } catch (error) {
    console.error(`[VALIDATE-DNI] Error al validar DNI:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

/**
 * Busca turnos disponibles usando la API de la clínica
 */
export async function searchTurnos(
  params: {
    rangoFechas: string
    profesional?: string
    especialidad?: string
    profesionalId?: string
  },
  clienteId: string,
): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  try {
    console.log(`[SEARCH-TURNOS] Buscando turnos para cliente: ${clienteId}`, params)

    if (!clienteId) {
      console.error(`[SEARCH-TURNOS] ❌ Cliente ID faltante`)
      return {
        success: false,
        error: "ID de cliente requerido",
      }
    }

    // Usar fechas dinámicas si no se proporcionan o son fechas del pasado
    let rangoFechas = params.rangoFechas
    if (!rangoFechas || rangoFechas.includes("2024-01-08") || rangoFechas === "hoy a hoy") {
      rangoFechas = getDefaultDateRange()
      console.log(`[SEARCH-TURNOS] 📅 Usando rango de fechas dinámico: ${rangoFechas}`)
    }

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.buscarTurnosDisponibles(
      rangoFechas,
      params.profesional,
      params.especialidad,
      params.profesionalId,
    )

    if (response.exito && response.datos) {
      console.log(`[SEARCH-TURNOS] ✅ Turnos encontrados:`, response.datos)
      return {
        success: true,
        data: response.datos,
      }
    } else {
      console.log(`[SEARCH-TURNOS] ❌ No se encontraron turnos o error:`, response.error)
      return {
        success: false,
        error: response.error?.mensaje || "No se encontraron turnos disponibles",
      }
    }
  } catch (error) {
    console.error(`[SEARCH-TURNOS] Error al buscar turnos:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

/**
 * Reserva un turno usando la API de la clínica
 */
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
): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  try {
    console.log(`[RESERVE-TURNO] Reservando turno para cliente: ${clienteId}`, params)

    if (!clienteId) {
      console.error(`[RESERVE-TURNO] ❌ Cliente ID faltante`)
      return {
        success: false,
        error: "ID de cliente requerido",
      }
    }

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.reservarTurno(params.agendaId, {
      dni: params.dni,
      nombre: params.nombre,
      apellido: params.apellido,
      telefono: params.telefono,
      email: params.email,
    })

    if (response.exito) {
      console.log(`[RESERVE-TURNO] ✅ Turno reservado exitosamente:`, response.datos)
      return {
        success: true,
        data: response.datos,
      }
    } else {
      console.log(`[RESERVE-TURNO] ❌ Error al reservar turno:`, response.error)
      return {
        success: false,
        error: response.error?.mensaje || "Error al reservar el turno",
      }
    }
  } catch (error) {
    console.error(`[RESERVE-TURNO] Error al reservar turno:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}

/**
 * Obtiene los datos de sedes usando la API de la clínica
 */
export async function getSedes(
  clienteId: string,
  sedeId?: string,
): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  try {
    console.log(`[GET-SEDES] Obteniendo sedes para cliente: ${clienteId}, sede: ${sedeId}`)

    if (!clienteId) {
      console.error(`[GET-SEDES] ❌ Cliente ID faltante`)
      return {
        success: false,
        error: "ID de cliente requerido",
      }
    }

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.obtenerSedes(sedeId)

    if (response.exito && response.datos) {
      console.log(`[GET-SEDES] ✅ Sedes obtenidas:`, response.datos)
      return {
        success: true,
        data: response.datos,
      }
    } else {
      console.log(`[GET-SEDES] ❌ No se encontraron sedes o error:`, response.error)
      return {
        success: false,
        error: response.error?.mensaje || "No se encontraron sedes",
      }
    }
  } catch (error) {
    console.error(`[GET-SEDES] Error al obtener sedes:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}
