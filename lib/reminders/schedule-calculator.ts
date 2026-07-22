/**
 * lib/reminders/schedule-calculator.ts
 *
 * Calcula los horarios (timestamps unix UTC) en los que deben dispararse los
 * recordatorios de reintento de un turno, a partir de la fecha/hora del turno
 * y el objeto "Recordatorios_Config" que llega desde el sistema externo junto
 * con el primer recordatorio (ver app/api/proxylistener/route.ts).
 *
 * Reglas (confirmadas con el cliente el 17/7/2026):
 * - "24h": turno - 24hs. Solo aplica si enviar_recordatorio_24hs=true y el
 *   primer recordatorio se envió con 48 o 72hs de anticipación (si ya se envió
 *   con 24hs, ese YA ES el recordatorio de 24hs).
 * - "segundo": recordatorio de reintento en una ventana fija de 2hs:
 *     - turno "de mañana" (hora < 13:00) -> tarde anterior, 18:30 a 20:30.
 *     - turno "de tarde" (hora >= 13:00) -> misma mañana del turno, 10:00 a 12:00.
 *   Dentro de la ventana, los recordatorios se van encolando secuencialmente
 *   segundo a segundo (10:00:00, 10:00:01, 10:00:02, ...) para no generar un
 *   pico de envíos simultáneos — ver assignSegundoRecordatorioSlot en
 *   reminder-queue.ts (requiere Redis, por eso no se resuelve acá).
 * - "ultimo": turno - 2hs, nunca antes de las 07:00 del mismo día. Si el turno
 *   es tan temprano que el piso de 07:00 cae después del turno, se omite.
 *
 * Zona horaria: Argentina es UTC-3 fijo (sin horario de verano desde 2009), así
 * que alcanza con el offset "-03:00" al construir los Date, sin usar Intl.
 */

export interface RecordatoriosConfig {
  anticipacion_horas?: 24 | 48 | 72
  enviar_recordatorio_24hs?: boolean
  enviar_segundo_recordatorio?: boolean
  enviar_ultimo_recordatorio?: boolean
}

const ARGENTINA_OFFSET = "-03:00"

// Corte entre turno "de mañana" y "de tarde" para elegir la ventana del segundo
// recordatorio.
const CORTE_MANANA_TARDE_HORA = 13

const SEGUNDO_RECORDATORIO_TARDE_INICIO = 18.5 // 18:30
const SEGUNDO_RECORDATORIO_TARDE_FIN = 20.5 // 20:30
const SEGUNDO_RECORDATORIO_MANANA_INICIO = 10 // 10:00
const SEGUNDO_RECORDATORIO_MANANA_FIN = 12 // 12:00

const ULTIMO_RECORDATORIO_ANTICIPACION_HORAS = 2
const ULTIMO_RECORDATORIO_PISO_HORA = 7 // nunca antes de las 07:00

export type PlannedReminder =
  | { kind: "24h"; sendAtUnix: number }
  | { kind: "ultimo"; sendAtUnix: number }
  | {
      kind: "segundo"
      /** Identificador estable de la ventana (fecha + turno) para agrupar el contador secuencial en Redis */
      ventanaKey: string
      ventanaInicioUnix: number
      ventanaFinUnix: number
    }

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Suma/resta días a una fecha "YYYY-MM-DD" en aritmética UTC pura (evita corrimientos). */
function shiftFechaDays(fecha: string, days: number): string {
  const [y, m, d] = fecha.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Convierte fecha "YYYY-MM-DD" + hora decimal (ej: 18.5 = 18:30) en horario de Argentina a unix UTC. */
function argentinaToUnix(fecha: string, hourDecimal: number): number {
  const hours = Math.floor(hourDecimal)
  const minutes = Math.round((hourDecimal - hours) * 60)
  const iso = `${fecha}T${pad(hours)}:${pad(minutes)}:00${ARGENTINA_OFFSET}`
  return Math.floor(new Date(iso).getTime() / 1000)
}

/**
 * Calcula los recordatorios a programar para un turno.
 *
 * @param turnoFecha "YYYY-MM-DD"
 * @param turnoHora "HH:MM" o "HH:MM:SS"
 * @param config Recordatorios_Config ya parseado (JSON.parse del string que llega en el payload)
 * @param nowUnix Momento actual (unix UTC) — parametrizable para tests, default Date.now()
 */
export function calcularRecordatorios(
  turnoFecha: string,
  turnoHora: string,
  config: RecordatoriosConfig,
  nowUnix: number = Math.floor(Date.now() / 1000),
): PlannedReminder[] {
  const resultados: PlannedReminder[] = []

  const [hh, mm] = turnoHora.split(":").map(Number)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return resultados

  const turnoHourDecimal = hh + mm / 60
  const turnoUnix = argentinaToUnix(turnoFecha, turnoHourDecimal)

  // "24h" — solo si el primer recordatorio se envió con más de 24hs de anticipación
  // (Number(...) por robustez: si anticipacion_horas llega como string "48" en vez de 48)
  const anticipacionHorasNum = Number(config.anticipacion_horas)
  if (
    config.enviar_recordatorio_24hs &&
    (anticipacionHorasNum === 48 || anticipacionHorasNum === 72)
  ) {
    const sendAt = turnoUnix - 24 * 3600
    if (sendAt > nowUnix) {
      resultados.push({ kind: "24h", sendAtUnix: sendAt })
    }
  }

  // "segundo" — ventana fija, el instante exacto se asigna después vía contador en Redis
  if (config.enviar_segundo_recordatorio) {
    const esTurnoDeTarde = turnoHourDecimal >= CORTE_MANANA_TARDE_HORA
    const ventanaFecha = esTurnoDeTarde ? turnoFecha : shiftFechaDays(turnoFecha, -1)
    const ventanaInicioHora = esTurnoDeTarde ? SEGUNDO_RECORDATORIO_MANANA_INICIO : SEGUNDO_RECORDATORIO_TARDE_INICIO
    const ventanaFinHora = esTurnoDeTarde ? SEGUNDO_RECORDATORIO_MANANA_FIN : SEGUNDO_RECORDATORIO_TARDE_FIN

    const ventanaInicioUnix = argentinaToUnix(ventanaFecha, ventanaInicioHora)
    const ventanaFinUnix = argentinaToUnix(ventanaFecha, ventanaFinHora)

    if (ventanaFinUnix > nowUnix && ventanaInicioUnix < turnoUnix) {
      resultados.push({
        kind: "segundo",
        ventanaKey: `${ventanaFecha}_${esTurnoDeTarde ? "manana" : "tarde"}`,
        ventanaInicioUnix,
        ventanaFinUnix,
      })
    }
  }

  // "ultimo" — turno - 2hs, con piso de las 07:00 del mismo día
  if (config.enviar_ultimo_recordatorio) {
    const pisoUnix = argentinaToUnix(turnoFecha, ULTIMO_RECORDATORIO_PISO_HORA)
    let sendAt = turnoUnix - ULTIMO_RECORDATORIO_ANTICIPACION_HORAS * 3600
    if (sendAt < pisoUnix) sendAt = pisoUnix

    if (sendAt > nowUnix && sendAt < turnoUnix) {
      resultados.push({ kind: "ultimo", sendAtUnix: sendAt })
    }
  }

  return resultados
}
