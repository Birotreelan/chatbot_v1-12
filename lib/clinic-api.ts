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
  ): Promise<ApiResponse<{ id: string; nombre: string; especialidad?: string }[]>> {
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
    // Extraer fechas desde y hasta del rango
    const [fechaDesde, fechaHasta] = rangoFechas.split(" a ")

    // Si tenemos el ID del profesional, usarlo directamente
    if (profesionalId) {
      return this.obtenerTurnos(fechaDesde, fechaHasta || fechaDesde, profesionalId)
    }

    // Si tenemos el nombre del profesional o especialidad, primero buscar el profesional
    if (profesional || especialidad) {
      const busqueda = profesional || especialidad || ""
      const profesionalesResponse = await this.buscarProfesionales(busqueda)

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
      return this.obtenerTurnos(fechaDesde, fechaHasta || fechaDesde, profesionalEncontrado.id)
    }

    // Si no tenemos ni profesional ni especialidad, buscar todos los turnos disponibles
    return this.obtenerTurnos(fechaDesde, fechaHasta || fechaDesde)
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
  return new ClinicAPI(clienteId)
}
