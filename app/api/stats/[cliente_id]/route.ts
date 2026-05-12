import { NextResponse } from "next/server"
import { getAppointmentStatsByClienteIdFiltered } from "@/lib/appointment-stats"
import { getConfigByClienteId } from "@/lib/db"

// Función para formatear tiempo en formato legible
function formatearTiempo(minutos: number): string {
  if (minutos === 0) return "—"
  
  const horas = Math.floor(minutos / 60)
  const mins = Math.round(minutos % 60)
  
  if (horas > 0) {
    return `${horas}h ${mins}m`
  }
  return `${mins}m`
}

export async function GET(request: Request, { params }: { params: Promise<{ cliente_id: string }> }) {
  try {
    const { cliente_id } = await params
    const { searchParams } = new URL(request.url)
    
    // Parámetros de fecha (formato: YYYY-MM-DD)
    const fechaInicio = searchParams.get("fechaInicio") || searchParams.get("startDate")
    const fechaFin = searchParams.get("fechaFin") || searchParams.get("endDate")

    // Ambos parámetros de fecha son obligatorios
    if (!fechaInicio || !fechaFin) {
      return NextResponse.json(
        {
          exito: false,
          error: "Los parámetros fechaInicio y fechaFin son obligatorios.",
          ejemplo: "/api/stats/{cliente_id}?fechaInicio=2025-11-01&fechaFin=2025-11-30",
        },
        { status: 400 }
      )
    }

    console.log(`[STATS_API] Solicitando estadísticas para cliente_id: ${cliente_id}, fechas: ${fechaInicio} - ${fechaFin}`)

    // Verificar que el cliente existe
    const config = await getConfigByClienteId(cliente_id)

    if (!config) {
      console.log(`[STATS_API] Cliente no encontrado: ${cliente_id}`)
      return NextResponse.json({ exito: false, error: "Cliente no encontrado" }, { status: 404 })
    }

    console.log(`[STATS_API] Cliente encontrado: ${config.displayName} (ID: ${config.id})`)

    // Obtener estadísticas usando el cliente_id filtradas por fechas
    let stats = await getAppointmentStatsByClienteIdFiltered(cliente_id, fechaInicio, fechaFin)

    // Fallback: buscar con config.id para datos históricos que fueron guardados con ese ID
    if (!stats && config.id !== cliente_id) {
      console.log(`[STATS_API] No hay estadísticas con cliente_id, intentando con config.id: ${config.id}`)
      stats = await getAppointmentStatsByClienteIdFiltered(config.id, fechaInicio, fechaFin)
      
      // Si encontramos stats con config.id, normalizar el clienteId al cliente_id correcto
      if (stats) {
        console.log(`[STATS_API] Estadísticas encontradas con config.id, normalizando a cliente_id`)
        stats = {
          ...stats,
          clienteId: cliente_id,
        }
      }
    }

    // Calcular métricas adicionales
    const totalSinRespuesta = stats 
      ? stats.totalTemplatesSent - stats.totalConfirmed - stats.totalCancelled
      : 0
    const tasaSinRespuesta = stats && stats.totalTemplatesSent > 0 
      ? Math.round(((totalSinRespuesta) / stats.totalTemplatesSent) * 10000) / 100
      : 0
    
    // Tasa de intento de reagendamiento (respecto a cancelados)
    const tasaIntentoReagendamiento = stats && stats.totalCancelled > 0
      ? Math.round((stats.totalRescheduleStarted / stats.totalCancelled) * 10000) / 100
      : 0

    // Total de interacciones
    const totalInteracciones = stats
      ? stats.totalTemplatesSent + stats.totalRescheduleStarted + stats.totalUserInitiated
      : 0

    // Respuesta en español con los mismos nombres del panel
    const respuestaEnEspanol = {
      exito: true,
      datos: {
        nombreCliente: config.displayName,
        clienteId: cliente_id,
        ultimaActualizacion: stats?.lastUpdated || new Date().toISOString(),
        filtroFechas: {
          fechaInicio: fechaInicio || null,
          fechaFin: fechaFin || null,
        },
        
        // Recordatorios
        recordatorios: {
          enviados: stats?.totalTemplatesSent || 0,
          confirmados: stats?.totalConfirmed || 0,
          cancelados: stats?.totalCancelled || 0,
          sinRespuesta: totalSinRespuesta,
          tasaConfirmacion: stats?.confirmationRate || 0,
          tasaCancelacion: stats?.cancellationRate || 0,
          tasaSinRespuesta: tasaSinRespuesta,
        },

        // Proceso de Reagendamiento
        procesoReagendamiento: {
          inicioProceso: stats?.totalRescheduleStarted || 0,
          tasaIntentoReagendamiento: tasaIntentoReagendamiento,
          tasaConversion: stats?.rescheduleConversionRate || 0,
          turnosReagendados: stats?.totalRescheduled || 0,
        },

        // Solicitud de Nuevos Turnos
        solicitudNuevosTurnos: {
          conversacionesIniciadas: stats?.totalUserInitiated || 0,
          tasaConversacionesIniciadas: stats?.userInitiatedRate || 0,
          nuevosTurnos: stats?.totalNewAppointments || 0,
        },

        // Consumo Totalizado
        consumoTotalizado: {
          totalInteracciones: totalInteracciones,
          recordatoriosEnviados: stats?.totalTemplatesSent || 0,
          iniciosReagendamiento: stats?.totalRescheduleStarted || 0,
          conversacionesPorPacientes: stats?.totalUserInitiated || 0,
        },

        // Tiempos de Respuesta
        tiemposRespuesta: {
          promedioGeneral: formatearTiempo(stats?.avgResponseTime || 0),
          promedioGeneralMinutos: stats?.avgResponseTime || 0,
          tiempoHastaConfirmacion: formatearTiempo(stats?.avgConfirmationTime || 0),
          tiempoHastaConfirmacionMinutos: stats?.avgConfirmationTime || 0,
          tiempoHastaCancelacion: formatearTiempo(stats?.avgCancellationTime || 0),
          tiempoHastaCancelacionMinutos: stats?.avgCancellationTime || 0,
        },

        // Tasa de Respuesta General
        tasaRespuestaGeneral: {
          tasaTotal: stats?.responseRate || 0,
          confirmaciones: stats?.confirmationRate || 0,
          cancelaciones: stats?.cancellationRate || 0,
          sinRespuesta: tasaSinRespuesta,
        },

        // Datos por día (para gráficos)
        datosPorDia: {
          confirmadosPorDia: stats?.confirmedByDay || {},
          canceladosPorDia: stats?.cancelledByDay || {},
          reagendadosPorDia: stats?.rescheduledByDay || {},
          plantillasEnviadasPorDia: stats?.templatesSentByDay || {},
          conversacionesIniciadasPorDia: stats?.userInitiatedByDay || {},
          nuevosTurnosPorDia: stats?.newAppointmentsByDay || {},
          iniciosReagendamientoPorDia: stats?.rescheduleStartedByDay || {},
        },
      },
    }

    console.log(`[STATS_API] Estadísticas obtenidas exitosamente para ${config.displayName}`)

    return NextResponse.json(respuestaEnEspanol)
  } catch (error) {
    console.error("[STATS_API] Error al obtener estadísticas:", error)
    return NextResponse.json(
      {
        exito: false,
        error: error instanceof Error ? error.message : "Error al obtener estadísticas",
      },
      { status: 500 },
    )
  }
}

// Permitir CORS para embeds en iframes
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
