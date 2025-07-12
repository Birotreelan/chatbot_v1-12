// lib/clinic-api.ts

// Función para validar DNI
export async function validateDNI(dni: string, clienteId: string) {
  console.log(`[VALIDATE-DNI] Validando DNI: ${dni} para cliente: ${clienteId}`)

  try {
    const response = await fetch("https://proxy.santiagovulliez.com/proxy_service/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Cliente_Id: clienteId,
        Action: "get_paciente",
        dni: dni,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[VALIDATE-DNI] Respuesta recibida:`, data)

    if (data.paciente) {
      return {
        success: true,
        data: {
          paciente: {
            id: data.paciente.Id,
            nombre: data.paciente.Nombres,
            apellido: data.paciente.Apellido,
            dni: data.paciente.Nrodoc,
            telefono: data.paciente.Celular,
            email: data.paciente.Mail,
            fechaNacimiento: data.paciente.Fecha_Nac,
            obraSocial: data.paciente.Deudor_Nombre,
            plan: data.paciente.Plan_Nombre,
            nroAfiliado: data.paciente.Nro_Afiliado_Ppal,
          },
          turnosProximos: (data.turnos_proximos || []).map((turno: any) => ({
            id: turno.Id,
            fecha: turno.Fecha,
            hora: turno.Hora,
            profesionalNombre: turno.Profesional_Nombre,
            centroNombre: turno.Centro_Nombre,
            motivoNombre: turno.Motivo_Nombre,
          })),
          esNuevo: false,
          permitePacientesNuevos: data.permite_pacientes_nuevos !== false,
        },
      }
    } else if (data.error) {
      if (
        data.error.toLowerCase().includes("paciente no encontrado") ||
        data.error.toLowerCase().includes("no encontrado")
      ) {
        return {
          success: true,
          data: {
            paciente: null,
            turnosProximos: [],
            esNuevo: true,
            permitePacientesNuevos: data.permite_pacientes_nuevos === true,
            mensajeError: data.error,
          },
        }
      }
      return {
        success: false,
        error: typeof data.error === "string" ? data.error : "Error desconocido",
        permitePacientesNuevos: data.permite_pacientes_nuevos,
      }
    } else {
      return {
        success: true,
        data: {
          paciente: null,
          turnosProximos: [],
          esNuevo: true,
          permitePacientesNuevos: data.permite_pacientes_nuevos !== false,
        },
      }
    }
  } catch (error) {
    console.error("[VALIDATE-DNI] Error:", error)
    throw error
  }
}

interface Turno {
  Id: number
  Fecha: string
  Hora: string
  Profesional_Nombre: string
  Profesional_Id: number
  Especialidad?: string
  Sede_Nombre?: string
  Dia_Semana: string
}

interface TurnoMapeado {
  id: number
  agendaId: number
  fecha: string
  hora: string
  profesional: string
  profesionalId: number
  especialidad: string
  sede: string
  diaSemana: string
}

interface SearchTurnosParams {
  fechaDesde: string
  fechaHasta: string
  especialidadId?: number
  profesionalId?: number
}

interface ReserveTurnoParams {
  agendaId: number
  fecha: string
  hora: string
  profesional: string
  dni: string
  telefono?: string
  email?: string
  nombre?: string
  apellido?: string
}

// Función para buscar turnos disponibles
export async function searchTurnos(
  params: SearchTurnosParams,
  clienteId: string,
): Promise<{ success: boolean; data: TurnoMapeado[] }> {
  console.log(`[SEARCH-TURNOS] Buscando turnos para cliente: ${clienteId}`, params)

  try {
    // Preparar parámetros de búsqueda
    const requestBody: any = {
      Cliente_Id: clienteId,
      Action: "get_turnos",
    }

    // Procesar rango de fechas
    if (params.fechaDesde && params.fechaHasta) {
      requestBody.Fecha_Desde = params.fechaDesde.trim()
      requestBody.Fecha_Hasta = params.fechaHasta.trim()
    } else {
      // Fechas por defecto
      const hoy = new Date()
      const unMesDespues = new Date(hoy)
      unMesDespues.setMonth(hoy.getMonth() + 1)

      requestBody.Fecha_Desde = hoy.toISOString().split("T")[0]
      requestBody.Fecha_Hasta = unMesDespues.toISOString().split("T")[0]
    }

    // Agregar filtros opcionales
    if (params.especialidadId) {
      requestBody.Especialidad_Id = params.especialidadId
    }
    if (params.profesionalId) {
      requestBody.Profesional_Id = params.profesionalId
    }

    console.log(`[SEARCH-TURNOS] Parámetros de búsqueda:`, requestBody)

    const response = await fetch("https://proxy.santiagovulliez.com/proxy_service/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[SEARCH-TURNOS] Respuesta recibida:`, data)

    if (data.turnos_disponibles) {
      const todosLosTurnos = []

      for (const diaData of data.turnos_disponibles) {
        if (diaData.turnos && Array.isArray(diaData.turnos)) {
          for (const turno of diaData.turnos) {
            // LOGGING DETALLADO para verificar mapeo correcto
            console.log(`[SEARCH-TURNOS] 🔍 Procesando turno: ID=${turno.Id}, Fecha=${turno.Fecha}, Hora=${turno.Hora}`)

            const turnoMapeado = {
              id: turno.Id,
              agendaId: turno.Id, // Asegurar que agendaId sea igual a id
              fecha: turno.Fecha,
              hora: turno.Hora,
              profesional: turno.Profesional_Nombre,
              profesionalId: turno.Profesional_Id,
              especialidad: turno.Especialidad || "Consulta General",
              sede: turno.Sede_Nombre || "Sede Principal",
              diaSemana: turno.Dia_Semana,
            }

            console.log(`[SEARCH-TURNOS] ✅ Turno mapeado: ${JSON.stringify(turnoMapeado)}`)
            todosLosTurnos.push(turnoMapeado)
          }
        }
        if (todosLosTurnos.length >= 40) break
      }

      // Log de verificación final
      console.log(`[SEARCH-TURNOS] 📋 MAPEO FINAL DE TURNOS:`)
      todosLosTurnos.slice(0, 15).forEach((t, index) => {
        console.log(`[SEARCH-TURNOS] Turno #${index + 1}: ID=${t.id}, ${t.fecha} ${t.hora} - ${t.profesional}`)
      })

      console.log(`[SEARCH-TURNOS] ✅ ${todosLosTurnos.length} turnos encontrados y mapeados correctamente`)

      return {
        success: true,
        data: todosLosTurnos,
      }
    } else if (data.error) {
      return {
        success: false,
        error: typeof data.error === "string" ? data.error : "Error desconocido",
      }
    } else {
      return {
        success: true,
        data: [],
      }
    }
  } catch (error) {
    console.error("[SEARCH-TURNOS] Error:", error)
    throw error
  }
}

// Función para reservar turno
export async function reserveTurno(
  params: ReserveTurnoParams,
  clienteId: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log(`[RESERVE-TURNO] ========== VALIDACIÓN DE DATOS ==========`)
  console.log(`[RESERVE-TURNO] 📋 Datos recibidos:`)
  console.log(`[RESERVE-TURNO] - agendaId: ${params.agendaId}`)
  console.log(`[RESERVE-TURNO] - fecha: ${params.fecha}`)
  console.log(`[RESERVE-TURNO] - hora: ${params.hora}`)
  console.log(`[RESERVE-TURNO] - profesional: ${params.profesional}`)
  console.log(`[RESERVE-TURNO] - dni: ${params.dni}`)
  console.log(`[RESERVE-TURNO] ================================================`)

  // Validar que agendaId no esté vacío
  if (!params.agendaId) {
    throw new Error("agendaId es requerido para la reserva")
  }

  console.log(`[RESERVE-TURNO] Reservando turno para cliente: ${clienteId}`, params)

  try {
    // Preparar parámetros de reserva con validación estricta
    const requestBody = {
      Cliente_Id: clienteId,
      Action: "set_turno",
      Agenda_Id: params.agendaId, // CRÍTICO: usar exactamente el ID recibido
      Paciente_Telefono: params.telefono,
      Paciente_Email: params.email,
      Paciente_Nombre: params.nombre,
      Paciente_Apellido: params.apellido,
      Paciente_DNI: params.dni,
    }

    console.log(`[RESERVE-TURNO] 🎯 Reservando turno con parámetros finales:`, requestBody)

    console.log(`Realizando petición POST a: https://proxy.santiagovulliez.com/proxy_service/`)
    console.log(`Action: ${requestBody.Action}, Cliente_Id: ${requestBody.Cliente_Id}`)
    console.log(`Parámetros:`, requestBody)
    console.log(`Cuerpo de la solicitud: ${JSON.stringify(requestBody)}`)

    const response = await fetch("https://proxy.santiagovulliez.com/proxy_service/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const responseText = await response.text()
    console.log(`Respuesta (texto) recibida: ${responseText}`)

    const data = JSON.parse(responseText)
    console.log(`Respuesta (JSON) parseada:`, data)

    if (data.success) {
      console.log(`[RESERVE-TURNO] ✅ Turno reservado exitosamente:`, data)

      // VALIDACIÓN POST-RESERVA: Verificar que los datos coincidan
      if (data.turno) {
        console.log(`[RESERVE-TURNO] ========== VERIFICACIÓN POST-RESERVA ==========`)
        console.log(`[RESERVE-TURNO] ✅ Datos del turno reservado:`)
        console.log(`[RESERVE-TURNO] - ID: ${data.turno.Id}`)
        console.log(`[RESERVE-TURNO] - Fecha: ${data.turno.Fecha}`)
        console.log(`[RESERVE-TURNO] - Hora: ${data.turno.Hora}`)
        console.log(`[RESERVE-TURNO] - Profesional: ${data.turno.Profesional_Nombre}`)
        console.log(`[RESERVE-TURNO] ================================================`)

        // Verificar discrepancias críticas
        if (data.turno.Fecha !== params.fecha) {
          console.error(
            `[RESERVE-TURNO] ❌ CRÍTICO: Fecha reservada (${data.turno.Fecha}) difiere de la esperada (${params.fecha})`,
          )
        }
        if (data.turno.Hora !== `${params.hora}:00` && data.turno.Hora !== params.hora) {
          console.error(
            `[RESERVE-TURNO] ❌ CRÍTICO: Hora reservada (${data.turno.Hora}) difiere de la esperada (${params.hora})`,
          )
        }
      }

      return {
        success: true,
        data: data,
      }
    } else if (data.error) {
      return {
        success: false,
        error: typeof data.error === "string" ? data.error : "Error al reservar el turno",
      }
    } else {
      return {
        success: false,
        error: "La API devolvió una respuesta inesperada al reservar el turno",
      }
    }
  } catch (error) {
    console.error("[RESERVE-TURNO] Error:", error)
    throw error
  }
}
