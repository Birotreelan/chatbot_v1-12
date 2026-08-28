/**
 * lib/diagnostics.ts
 *
 * Instrumentación conversacional — "Fase 0" del plan de optimización del bot.
 *
 * POR QUÉ EXISTE
 * Hasta hoy, cada mejora del motor conversacional se hizo de forma reactiva: un
 * paciente real sufría un problema, se leía esa conversación puntual y se
 * parchaba (casos Vicente, Patricia, Belén, Margarita, Carlos, Luis). No había
 * forma de saber si un cambio de prompt o de modelo mejoraba o empeoraba el
 * comportamiento general, ni de dimensionar un problema antes de atacarlo.
 * Esto registra lo que el bot decide y lo que le pasa, para poder medir.
 *
 * DOS NIVELES DE REGISTRO
 *   1. Contadores agregados por día y clínica (hash Redis + HINCRBY). Baratos:
 *      todos los contadores de un evento van en UN pipeline. Sirven para las
 *      tendencias: tasa de fallback, embudo de reserva, errores, etc.
 *   2. Muestras de eventos "interesantes" (fallbacks, errores, baja confianza),
 *      con tope diario. Sirven para el análisis cualitativo: ver el mensaje
 *      exacto que rompió la clasificación.
 *
 * COSTO EN REDIS (deliberadamente acotado — ver PLAN-DE-TRABAJO.md, incidente
 * de costos de agosto 2026): un evento típico son 2-3 comandos en 1 round-trip.
 * Las muestras solo se guardan cuando el evento está marcado como interesante,
 * y se cortan por tope diario, así que no crecen con el tráfico.
 *
 * GARANTÍA: nada de esto puede romper una conversación. Todo va en try/catch y
 * cualquier error se traga con un console.warn. Si Redis no está, es no-op.
 */

import { getRedisClient } from "./redis"

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const DIAG_COUNTER_PREFIX = "diag:d:"     // diag:d:{YYYY-MM-DD}:{configId}  (hash)
const DIAG_SAMPLE_PREFIX = "diag:s:"      // diag:s:{YYYY-MM-DD}             (list)
const DIAG_DAYS_INDEX = "diag:dias"       // set de días con datos

// 30 días: suficiente para comparar antes/después de un cambio sin acumular.
const DIAG_TTL = 30 * 24 * 60 * 60
// Tope de muestras por día (global, no por clínica). Con esto el costo de las
// muestras es constante por día, no proporcional al tráfico.
const MAX_SAMPLES_PER_DAY = 400

/** Permite apagar la instrumentación sin deploy si hiciera falta. */
function diagnosticsEnabled(): boolean {
  return process.env.DIAGNOSTICS_ENABLED !== "false"
}

function today(): string {
  // Fecha en horario de Argentina: si no, los cortes diarios quedan movidos 3h
  // y las comparaciones "por día" no coinciden con la jornada real de la clínica.
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// ============================================================================
// MÉTRICAS — nombres canónicos
// ============================================================================

/**
 * Catálogo de métricas. Se usan constantes para que un typo no genere
 * silenciosamente una métrica nueva que nadie mira.
 */
export const DIAG = {
  // ── Volumen ──────────────────────────────────────────────────────────────
  MENSAJE_RECIBIDO: "mensaje_recibido",

  // ── AI Dispatcher (router primario) ──────────────────────────────────────
  /** Se concatena el nombre del tool: dispatcher_tool:confirmar_asistencia_turno */
  DISPATCHER_TOOL_PREFIX: "dispatcher_tool:",
  DISPATCHER_FALLBACK: "dispatcher_fallback",      // no eligió tool o falló GPT
  DISPATCHER_ERROR: "dispatcher_error",

  // ── Router de intención por estado (classify) ────────────────────────────
  CLASSIFY_OK: "classify_ok",
  CLASSIFY_TIMEOUT: "classify_timeout",
  CLASSIFY_FUERA_DE_SET: "classify_fuera_de_set",  // eligió una acción no permitida
  CLASSIFY_BAJA_CONFIANZA: "classify_baja_confianza",

  // ── Llamadas al proxy de la clínica ──────────────────────────────────────
  PROXY_REINTENTO: "proxy_reintento",              // hubo que reintentar
  PROXY_REINTENTO_SALVADO: "proxy_reintento_salvado", // el reintento terminó bien
  PROXY_FALLA_DEFINITIVA: "proxy_falla_definitiva",   // se agotaron los intentos

  // ── Identificación del paciente ──────────────────────────────────────────
  MENU_CORTO: "menu_corto",                        // se evitó re-saludar
  SALUDO_COMPLETO: "saludo_completo",
  DNI_DESDE_PRIMER_MENSAJE: "dni_desde_primer_mensaje", // se evitó pedirlo
  DNI_SOLICITADO: "dni_solicitado",
  OBRA_SOCIAL_BLOQUEADA_EN_SALUDO: "obra_social_bloqueada_en_saludo",

  // ── Preferencia del primer mensaje ───────────────────────────────────────
  PREFERENCIA_GUARDADA: "preferencia_guardada",
  PREFERENCIA_APLICADA: "preferencia_aplicada",
  PREFERENCIA_DESCARTADA: "preferencia_descartada",

  // ── Embudo de reserva ────────────────────────────────────────────────────
  RESERVA_INICIADA: "reserva_iniciada",
  TURNOS_MOSTRADOS: "turnos_mostrados",
  RESERVA_EXITOSA: "reserva_exitosa",
  SIN_TURNOS_DISPONIBLES: "sin_turnos_disponibles",

  // ── Salidas de la conversación ───────────────────────────────────────────
  DERIVACION_EXTERNA: "derivacion_externa",
  DERIVACION_HUMANA: "derivacion_humana",
  OTRA_CONSULTA_SIN_RESPUESTA: "otra_consulta_sin_respuesta", // opción 3 del menú
  ERROR_AL_PACIENTE: "error_al_paciente",
} as const

// ============================================================================
// REGISTRO DE CONTADORES
// ============================================================================

/** Evita reescribir el TTL en cada evento dentro de la misma instancia. */
const ttlYaSeteado = new Set<string>()

/**
 * Incrementa uno o más contadores del día para una clínica.
 * Todos los incrementos van en un solo round-trip.
 *
 * @param configId  Clínica (o "global" si el evento no es atribuible a una).
 * @param metricas  Nombre de métrica → cuánto sumar (default 1).
 */
export async function recordDiag(
  configId: string | undefined,
  metricas: string | string[] | Record<string, number>,
): Promise<void> {
  if (!diagnosticsEnabled()) return

  try {
    const redis = getRedisClient()
    if (!redis) return

    const dia = today()
    const key = `${DIAG_COUNTER_PREFIX}${dia}:${configId || "global"}`

    // Normalizar la entrada a pares [métrica, incremento]
    let pares: Array<[string, number]>
    if (typeof metricas === "string") {
      pares = [[metricas, 1]]
    } else if (Array.isArray(metricas)) {
      pares = metricas.map((m) => [m, 1] as [string, number])
    } else {
      pares = Object.entries(metricas)
    }
    if (pares.length === 0) return

    const pipeline = redis.pipeline()
    for (const [metrica, inc] of pares) {
      pipeline.hincrby(key, metrica, inc)
    }

    if (!ttlYaSeteado.has(key)) {
      pipeline.expire(key, DIAG_TTL)
      pipeline.sadd(DIAG_DAYS_INDEX, dia)
      pipeline.expire(DIAG_DAYS_INDEX, DIAG_TTL)
      ttlYaSeteado.add(key)
    }

    await pipeline.exec()
  } catch (error) {
    // Nunca romper el flujo por instrumentación.
    console.warn("[DIAG] No se pudo registrar métrica:", error)
  }
}

// ============================================================================
// MUESTREO DE EVENTOS
// ============================================================================

export interface DiagSample {
  /** Qué tipo de evento se está muestreando (ej: "dispatcher_fallback"). */
  tipo: string
  /** Mensaje del paciente que originó el evento (se trunca). */
  mensaje?: string
  /** Datos libres del evento: tool elegido, confianza, fase del flujo, etc. */
  detalle?: Record<string, any>
  configId?: string
}

/**
 * Guarda una muestra de un evento interesante para análisis cualitativo
 * posterior. NO guardar acá eventos de volumen normal: son para los casos que
 * queremos poder leer uno por uno (una clasificación dudosa, un error, un
 * abandono). El tope diario impide que esto crezca con el tráfico.
 *
 * No se guarda el teléfono del paciente — para el análisis alcanza con el
 * mensaje y el contexto de la decisión.
 */
export async function recordDiagSample(sample: DiagSample): Promise<void> {
  if (!diagnosticsEnabled()) return

  try {
    const redis = getRedisClient()
    if (!redis) return

    const dia = today()
    const key = `${DIAG_SAMPLE_PREFIX}${dia}`

    const entrada = JSON.stringify({
      ts: new Date().toISOString(),
      tipo: sample.tipo,
      configId: sample.configId,
      mensaje: (sample.mensaje || "").slice(0, 200),
      detalle: sample.detalle,
    })

    const pipeline = redis.pipeline()
    pipeline.rpush(key, entrada)
    pipeline.ltrim(key, -MAX_SAMPLES_PER_DAY, -1)
    pipeline.expire(key, DIAG_TTL)
    await pipeline.exec()
  } catch (error) {
    console.warn("[DIAG] No se pudo registrar muestra:", error)
  }
}

// ============================================================================
// LECTURA (para el endpoint de exportación)
// ============================================================================

export interface DiagDayReport {
  dia: string
  porClinica: Record<string, Record<string, number>>
  totales: Record<string, number>
}

/** Lee los contadores de un día para las clínicas indicadas. */
export async function readDiagDay(dia: string, configIds: string[]): Promise<DiagDayReport | null> {
  try {
    const redis = getRedisClient()
    if (!redis) return null

    const claves = [...configIds.map((id) => `${DIAG_COUNTER_PREFIX}${dia}:${id}`), `${DIAG_COUNTER_PREFIX}${dia}:global`]

    const pipeline = redis.pipeline()
    claves.forEach((k) => pipeline.hgetall(k))
    const resultados = (await pipeline.exec()) as Array<Record<string, string> | null>

    const porClinica: Record<string, Record<string, number>> = {}
    const totales: Record<string, number> = {}
    const etiquetas = [...configIds, "global"]

    resultados.forEach((hash, i) => {
      if (!hash || Object.keys(hash).length === 0) return
      const numerico: Record<string, number> = {}
      for (const [k, v] of Object.entries(hash)) {
        const n = Number(v) || 0
        numerico[k] = n
        totales[k] = (totales[k] || 0) + n
      }
      porClinica[etiquetas[i]] = numerico
    })

    if (Object.keys(porClinica).length === 0) return null
    return { dia, porClinica, totales }
  } catch (error) {
    console.warn("[DIAG] No se pudo leer el día:", error)
    return null
  }
}

/** Lee las muestras de un día. */
export async function readDiagSamples(dia: string): Promise<any[]> {
  try {
    const redis = getRedisClient()
    if (!redis) return []
    const items = await redis.lrange(`${DIAG_SAMPLE_PREFIX}${dia}`, 0, -1)
    if (!items || items.length === 0) return []
    return items
      .map((i: any) => {
        try {
          return typeof i === "string" ? JSON.parse(i) : i
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch (error) {
    console.warn("[DIAG] No se pudieron leer las muestras:", error)
    return []
  }
}

/** Días con datos registrados (más reciente primero). */
export async function listDiagDays(): Promise<string[]> {
  try {
    const redis = getRedisClient()
    if (!redis) return []
    const dias = (await redis.smembers(DIAG_DAYS_INDEX)) as string[]
    return (dias || []).sort().reverse()
  } catch {
    return []
  }
}
