import type { ApiResponse, Paciente } from "./api-tools/types"

// Clase ClinicAPI para interactuar con el middleware proxy
export class ClinicAPI {
  private proxyUrl = "https://treelan.net/managment/proxy_service/"
  private clienteId: string

  constructor(clienteId: string) {
    this.clienteId = clienteId
  }

  /**
   * Realiza una petición POST al middleware proxy
   */
  private async fetchProxyApi<T>(action: string, params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    try {
      console.log(`[CLINIC-API] ========== PETICIÓN AL PROXY ==========`)
      console.log(`[CLINIC-API] URL: ${this.proxyUrl}`)
      console.log(`[CLINIC-API] Action: ${action}`)
      console.log(`[CLINIC-API] Cliente_Id: ${this.clienteId}`)
      console.log(`[CLINIC-API] Parámetros:`, params)

      // Preparar el cuerpo de la solicitud - asegurarnos de que Cliente_Id está exactamente como se espera
      const requestBody = {
        Cliente_Id: this.clienteId.trim(), // Eliminar espacios en blanco por si acaso
        Action: action,
        ...params,
      }

      console.log(`[CLINIC-API] Cuerpo de la solicitud:`, JSON.stringify(requestBody, null, 2))

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
      console.log(`[CLINIC-API] ========== RESPUESTA DEL PROXY ==========`)
      console.log(`[CLINIC-API] Status: ${response.status} ${response.statusText}`)
      console.log(`[CLINIC-API] Respuesta (texto):`, responseText)

      // Intentar parsear la respuesta como JSON
      let data
      try {
        data = JSON.parse(responseText)
        console.log(`[CLINIC-API] Respuesta (JSON):`, JSON.stringify(data, null, 2))
      } catch (e) {
        console.error(`[CLINIC-API] ❌ Error al parsear JSON:`, e)
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
        console.error(`[CLINIC-API] ❌ Error de Cliente_Id:`, data.error)
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
        console.error(`[CLINIC-API] ❌ Error HTTP: ${response.status} ${response.statusText}`)
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
        console.error(`[CLINIC-API] ❌ Error en los datos:`, data.error)
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
          console.error(`[CLINIC-API] ❌ API indicó éxito=false:`, data)
          return {
            exito: false,
            error: {
              codigo: "API_ERROR",
              mensaje: data.message || "Error desconocido",
            },
          }
        }
        console.log(`[CLINIC-API] ✅ Respuesta exitosa`)
        return {
          exito: true,
          datos: data.data,
        }
      }

      // Si llegamos aquí, asumimos que la respuesta es exitosa
      console.log(`[CLINIC-API] ✅ Respuesta exitosa (formato directo)`)
      return { exito: true, datos: data }
    } catch (error) {
      // Manejar errores de red u otros
      console.error(`[CLINIC-API] ❌ Error de red:`, error)
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
    console.log(`[CLINIC-API] 🔍 Buscando paciente por DNI: ${dni}`)
    return this.fetchProxyApi<Paciente | null>("get_paciente", { dni })
  }

  /**
   * Busca un paciente por teléfono
   */
  async paciente_telefono(telefono: string): Promise<ApiResponse<Paciente | null>> {
    console.log(`[CLINIC-API] 🔍 Buscando paciente por teléfono: ${telefono}`)
    return this.fetchProxyApi<Paciente | null>("get_paciente", { telefono })
  }

  /**
   * Obtiene las subespecialidades disponibles
   */
  async obtenerSubespecialidades(): Promise<ApiResponse<{ id: string; nombre: string }[]>> {
    console.log(`[CLINIC-API] 🔍 Obteniendo subespecialidades`)
    return this.fetchProxyApi<{ id: string; nombre: string }[]>("get_subespecialidades")
  }

  /**
   * Busca profesionales por nombre o especialidad
   */
  async buscarProfesionales(
    busqueda: string,
  ): Promise<ApiResponse<{ id: string; nombre: string; especialidad?: string }[]>> {
    console.log(`[CLINIC-API] 🔍 Buscando profesionales: ${busqueda}`)
    return this.fetchProxyApi<{ id: string; nombre: string; especialidad?: string }[]>("get_profesionales", {
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
    console.log(`[CLINIC-API] 🔍 Obteniendo turnos: ${fechaDesde} a ${fechaHasta}`)

    const params: Record<string, any> = {
      Fecha_Desde: fechaDesde,
      Fecha_Hasta: fechaHasta,
    }

    if (profesionalId) {
      params.Profesional_Id = profesionalId
      console.log(`[CLINIC-API] - Con profesional ID: ${profesionalId}`)
    }

    if (pacienteDNI) {
      params.Paciente_DNI = pacienteDNI
      console.log(`[CLINIC-API] - Para paciente DNI: ${pacienteDNI}`)
    }

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
    console.log(`[CLINIC-API] ========== BUSCAR TURNOS DISPONIBLES ==========`)
    console.log(`[CLINIC-API] Parámetros recibidos:`)
    console.log(`[CLINIC-API] - rangoFechas: "${rangoFechas}"`)
    console.log(`[CLINIC-API] - profesional: "${profesional}"`)
    console.log(`[CLINIC-API] - especialidad: "${especialidad}"`)
    console.log(`[CLINIC-API] - profesionalId: "${profesionalId}"`)

    // Validar que rangoFechas no sea undefined
    if (!rangoFechas) {
      console.error(`[CLINIC-API] ❌ rangoFechas es requerido`)
      return {
        exito: false,
        error: {
          codigo: "PARAMETRO_FALTANTE",
          mensaje: "El parámetro rangoFechas es requerido",
        },
      }
    }

    // Extraer fechas desde y hasta del rango
    let fechaDesde: string
    let fechaHasta: string

    try {
      if (rangoFechas.includes(" a ")) {
        ;[fechaDesde, fechaHasta] = rangoFechas.split(" a ")
      } else if (rangoFechas.includes(" to ")) {
        ;[fechaDesde, fechaHasta] = rangoFechas.split(" to ")
      } else {
        // Si no tiene separador, usar como fecha única
        fechaDesde = rangoFechas
        fechaHasta = rangoFechas
      }

      fechaDesde = fechaDesde.trim()
      fechaHasta = fechaHasta ? fechaHasta.trim() : fechaDesde

      console.log(`[CLINIC-API] ✅ Fechas procesadas: ${fechaDesde} a ${fechaHasta}`)
    } catch (error) {
      console.error(`[CLINIC-API] ❌ Error procesando rangoFechas:`, error)
      return {
        exito: false,
        error: {
          codigo: "FORMATO_FECHA_INVALIDO",
          mensaje: `Formato de rango de fechas inválido: ${rangoFechas}`,
        },
      }
    }

    // Si tenemos el ID del profesional, usarlo directamente
    if (profesionalId) {
      console.log(`[CLINIC-API] 🎯 Usando profesional ID directamente: ${profesionalId}`)
      return this.obtenerTurnos(fechaDesde, fechaHasta, profesionalId)
    }

    // Si tenemos el nombre del profesional o especialidad, primero buscar el profesional
    if (profesional || especialidad) {
      const busqueda = profesional || especialidad || ""
      console.log(`[CLINIC-API] 🔍 Buscando profesional primero: ${busqueda}`)

      const profesionalesResponse = await this.buscarProfesionales(busqueda)

      if (!profesionalesResponse.exito || !profesionalesResponse.datos || profesionalesResponse.datos.length === 0) {
        console.log(`[CLINIC-API] ❌ No se encontraron profesionales`)
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
        console.log(`[CLINIC-API] 📋 Múltiples profesionales encontrados: ${profesionalesResponse.datos.length}`)
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
      console.log(
        `[CLINIC-API] 🎯 Profesional único encontrado: ${profesionalEncontrado.nombre} (ID: ${profesionalEncontrado.id})`,
      )
      return this.obtenerTurnos(fechaDesde, fechaHasta, profesionalEncontrado.id)
    }

    // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
    console.log(`[CLINIC-API] 🌐 Buscando todos los turnos disponibles`)
    return this.obtenerTurnos(fechaDesde, fechaHasta)
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
    console.log(`[CLINIC-API] 🔒 Reservando turno: ${agendaId}`)

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

    return this.fetchProxyApi<any>("set_turno", params)
  }
}

/**
 * Crea una instancia de ClinicAPI con la URL del proxy y el ID del cliente
 */
export function createClinicAPI(clienteId: string): ClinicAPI {
  if (!clienteId) {
    throw new Error("Se requiere el ID del cliente para crear una instancia de ClinicAPI")
  }
  console.log(`[CLINIC-API] 🏗️ Creando instancia para cliente: ${clienteId}`)
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
    console.log(`[VALIDATE-DNI] ========== VALIDANDO DNI ==========`)
    console.log(`[VALIDATE-DNI] DNI: ${dni}`)
    console.log(`[VALIDATE-DNI] Cliente ID: ${clienteId}`)

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.paciente_dni(dni)

    if (response.exito && response.datos) {
      console.log(`[VALIDATE-DNI] ✅ DNI válido encontrado`)
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
    console.error(`[VALIDATE-DNI] ❌ Error al validar DNI:`, error)
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
    rangoFechas?: string
    profesional?: string
    especialidad?: string
    profesionalId?: string
    dni?: string
  },
  clienteId: string,
): Promise<{
  success: boolean
  data?: any
  error?: string
}> {
  try {
    console.log(`[SEARCH-TURNOS] ========== BUSCANDO TURNOS ==========`)
    console.log(`[SEARCH-TURNOS] Cliente ID: ${clienteId}`)
    console.log(`[SEARCH-TURNOS] Parámetros:`, params)

    // Validar que tenemos rangoFechas
    let rangoFechas = params.rangoFechas
    if (!rangoFechas) {
      console.log(`[SEARCH-TURNOS] ⚠️ No se proporcionó rangoFechas, usando valor por defecto`)
      const hoy = new Date().toISOString().split("T")[0]
      const mañana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] // 7 días
      rangoFechas = `${hoy} a ${mañana}`
      console.log(`[SEARCH-TURNOS] 📅 Rango por defecto: ${rangoFechas}`)
    }

    const clinicAPI = createClinicAPI(clienteId)
    const response = await clinicAPI.buscarTurnosDisponibles(
      rangoFechas,
      params.profesional,
      params.especialidad,
      params.profesionalId,
    )

    if (response.exito && response.datos) {
      console.log(`[SEARCH-TURNOS] ✅ Turnos encontrados`)
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
    console.error(`[SEARCH-TURNOS] ❌ Error al buscar turnos:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
    }
  }
}
