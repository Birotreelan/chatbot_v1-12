/**
 * app/api/admin/diagnostics/route.ts
 *
 * Exporta las métricas conversacionales capturadas por lib/diagnostics.ts
 * ("Fase 0" del plan de optimización del bot).
 *
 * Objetivo: después de una semana de captura, poder responder con números
 * preguntas que hoy solo se pueden contestar por intuición —
 *   ¿Cuánto cae al fallback el dispatcher, y con qué mensajes?
 *   ¿En qué estados el clasificador está adivinando (confianza baja)?
 *   ¿Cuántas llamadas al proxy salvan los reintentos?
 *   ¿Cuántos pacientes piden "otra consulta" y se van con un teléfono?
 *   ¿Mejoró el embudo de reserva después de los cambios?
 *
 * SOLO LECTURA. Acceso exclusivo super_admin (sesión del dashboard).
 *
 * Uso:
 *   GET /api/admin/diagnostics                → últimos 7 días
 *   GET /api/admin/diagnostics?dias=14
 *   GET /api/admin/diagnostics?muestras=false → solo agregados, sin ejemplos
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { readDiagDay, readDiagSamples, listDiagDays, DIAG } from "@/lib/diagnostics"

const DEFAULT_DIAS = 7
const MAX_DIAS = 30

/** Fecha (Argentina) de hace N días, en formato YYYY-MM-DD. */
function diaHaceNDias(n: number): string {
  const ms = Date.now() - 3 * 60 * 60 * 1000 - n * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Divide a/b devolviendo null si no hay denominador (evita 0% engañosos). */
function tasa(numerador: number, denominador: number): number | null {
  if (!denominador) return null
  return Math.round((numerador / denominador) * 1000) / 10
}

export async function GET(request: Request) {
  try {
    const { session, error } = await requireAuthFromRequest(request)
    if (!session) {
      return NextResponse.json({ error: error || "No autenticado" }, { status: 401 })
    }
    if (session.role !== "super_admin") {
      return NextResponse.json({ error: "No autorizado — se requiere super_admin" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const dias = Math.min(Number(searchParams.get("dias")) || DEFAULT_DIAS, MAX_DIAS)
    const incluirMuestras = searchParams.get("muestras") !== "false"

    const configs = await getAllWhatsAppConfigs()
    const configIds = configs.map((c) => c.id)
    const nombrePorId: Record<string, string> = {}
    configs.forEach((c) => {
      nombrePorId[c.id] = c.displayName
    })

    // ── Agregados por día ────────────────────────────────────────────────────
    const fechas = Array.from({ length: dias }, (_, i) => diaHaceNDias(i))
    const reportes = await Promise.all(fechas.map((f) => readDiagDay(f, configIds)))

    const porDia: any[] = []
    const acumulado: Record<string, number> = {}

    reportes.forEach((r) => {
      if (!r) return
      porDia.push({
        dia: r.dia,
        totales: r.totales,
        porClinica: Object.fromEntries(
          Object.entries(r.porClinica).map(([id, m]) => [nombrePorId[id] || id, m]),
        ),
      })
      for (const [k, v] of Object.entries(r.totales)) {
        acumulado[k] = (acumulado[k] || 0) + v
      }
    })

    // ── Indicadores derivados ────────────────────────────────────────────────
    const mensajes = acumulado[DIAG.MENSAJE_RECIBIDO] || 0
    const reservaIniciada = acumulado[DIAG.RESERVA_INICIADA] || 0
    const turnosMostrados = acumulado[DIAG.TURNOS_MOSTRADOS] || 0
    const reservaExitosa = acumulado[DIAG.RESERVA_EXITOSA] || 0
    const reintentos = acumulado[DIAG.PROXY_REINTENTO] || 0
    const salvados = acumulado[DIAG.PROXY_REINTENTO_SALVADO] || 0
    const fallasDefinitivas = acumulado[DIAG.PROXY_FALLA_DEFINITIVA] || 0
    const menuCorto = acumulado[DIAG.MENU_CORTO] || 0
    const saludoCompleto = acumulado[DIAG.SALUDO_COMPLETO] || 0

    // Distribución de decisiones del dispatcher
    const distribucionTools: Record<string, number> = {}
    for (const [k, v] of Object.entries(acumulado)) {
      if (k.startsWith(DIAG.DISPATCHER_TOOL_PREFIX)) {
        distribucionTools[k.slice(DIAG.DISPATCHER_TOOL_PREFIX.length)] = v
      }
    }

    const indicadores = {
      mensajesProcesados: mensajes,

      dispatcher: {
        distribucionTools,
        fallback: acumulado[DIAG.DISPATCHER_FALLBACK] || 0,
        errores: acumulado[DIAG.DISPATCHER_ERROR] || 0,
        tasaFallbackPct: tasa((acumulado[DIAG.DISPATCHER_FALLBACK] || 0) + (acumulado[DIAG.DISPATCHER_ERROR] || 0), mensajes),
      },

      clasificador: {
        ok: acumulado[DIAG.CLASSIFY_OK] || 0,
        timeouts: acumulado[DIAG.CLASSIFY_TIMEOUT] || 0,
        fueraDeSet: acumulado[DIAG.CLASSIFY_FUERA_DE_SET] || 0,
        bajaConfianza: acumulado[DIAG.CLASSIFY_BAJA_CONFIANZA] || 0,
        tasaBajaConfianzaPct: tasa(acumulado[DIAG.CLASSIFY_BAJA_CONFIANZA] || 0, acumulado[DIAG.CLASSIFY_OK] || 0),
      },

      // Mide si los reintentos valen lo que cuestan en latencia.
      proxyClinica: {
        reintentos,
        llamadasSalvadasPorReintento: salvados,
        fallasDefinitivas,
        tasaExitoDelReintentoPct: tasa(salvados, salvados + fallasDefinitivas),
      },

      identificacion: {
        menuCorto,
        saludoCompleto,
        // Cuántos re-saludos completos se evitaron.
        ahorroReSaludoPct: tasa(menuCorto, menuCorto + saludoCompleto),
        dniTomadoDelPrimerMensaje: acumulado[DIAG.DNI_DESDE_PRIMER_MENSAJE] || 0,
        obraSocialAvisadaEnSaludo: acumulado[DIAG.OBRA_SOCIAL_BLOQUEADA_EN_SALUDO] || 0,
      },

      preferenciaPrimerMensaje: {
        guardadas: acumulado[DIAG.PREFERENCIA_GUARDADA] || 0,
        aplicadas: acumulado[DIAG.PREFERENCIA_APLICADA] || 0,
        descartadas: acumulado[DIAG.PREFERENCIA_DESCARTADA] || 0,
        tasaAplicacionPct: tasa(acumulado[DIAG.PREFERENCIA_APLICADA] || 0, acumulado[DIAG.PREFERENCIA_GUARDADA] || 0),
      },

      embudoReserva: {
        iniciadas: reservaIniciada,
        turnosMostrados,
        exitosas: reservaExitosa,
        sinTurnosDisponibles: acumulado[DIAG.SIN_TURNOS_DISPONIBLES] || 0,
        conversionPct: tasa(reservaExitosa, reservaIniciada),
      },

      salidas: {
        derivacionExterna: acumulado[DIAG.DERIVACION_EXTERNA] || 0,
        derivacionHumana: acumulado[DIAG.DERIVACION_HUMANA] || 0,
        otraConsultaSinRespuesta: acumulado[DIAG.OTRA_CONSULTA_SIN_RESPUESTA] || 0,
        erroresAlPaciente: acumulado[DIAG.ERROR_AL_PACIENTE] || 0,
      },
    }

    // ── Muestras cualitativas ────────────────────────────────────────────────
    let muestras: any[] = []
    if (incluirMuestras) {
      const porFecha = await Promise.all(fechas.map((f) => readDiagSamples(f)))
      muestras = porFecha.flat()
      // Reemplazar configId por el nombre de la clínica, más legible al analizar.
      muestras = muestras.map((m) => ({ ...m, clinica: m.configId ? nombrePorId[m.configId] || m.configId : undefined }))
    }

    const resumenMuestras: Record<string, number> = {}
    muestras.forEach((m) => {
      resumenMuestras[m.tipo] = (resumenMuestras[m.tipo] || 0) + 1
    })

    return NextResponse.json({
      generadoEl: new Date().toISOString(),
      ventana: { dias, desde: fechas[fechas.length - 1], hasta: fechas[0] },
      diasConDatos: await listDiagDays(),
      indicadores,
      acumulado,
      porDia,
      resumenMuestras,
      muestras,
    })
  } catch (error) {
    console.error("[DIAGNOSTICS_API] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error obteniendo diagnóstico" },
      { status: 500 },
    )
  }
}
