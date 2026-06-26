import { getRedisClient } from "./redis"
import type { DaySchedule } from "./types"

const SCHEDULE_PREFIX = "human_support_schedule:"
const SCHEDULE_TTL = 365 * 24 * 60 * 60 // 1 año

// ─── Redis helpers ────────────────────────────────────────────────────────────

export async function getHumanSupportSchedule(configId: string): Promise<DaySchedule[]> {
  const redis = getRedisClient()
  if (!redis) return []
  const raw = await redis.get(`${SCHEDULE_PREFIX}${configId}`)
  if (!raw) return []
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function setHumanSupportSchedule(
  configId: string,
  schedule: DaySchedule[],
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.set(`${SCHEDULE_PREFIX}${configId}`, JSON.stringify(schedule))
  await redis.expire(`${SCHEDULE_PREFIX}${configId}`, SCHEDULE_TTL)
}

// ─── Schedule checker ─────────────────────────────────────────────────────────

/**
 * Returns true if the current moment falls within any enabled period
 * of the schedule. If the schedule is empty or has no enabled days,
 * returns true (no restriction = always available).
 */
export function isWithinHumanSupportHours(
  schedule: DaySchedule[],
  timezone: string = "America/Argentina/Buenos_Aires",
): boolean {
  const enabledDays = schedule.filter((d) => d.enabled && d.periods?.length > 0)
  if (enabledDays.length === 0) return true // no restrictions configured

  // Get current time in the clinic's timezone
  const now = new Date()
  const localStr = now.toLocaleString("en-US", { timeZone: timezone })
  const local = new Date(localStr)

  const currentDayOfWeek = local.getDay() // 0=Sunday … 6=Saturday
  const currentMinutes = local.getHours() * 60 + local.getMinutes()

  const todaySchedule = enabledDays.find((d) => d.dayOfWeek === currentDayOfWeek)
  if (!todaySchedule) return false // today not in schedule

  return todaySchedule.periods.some((p) => {
    const start = timeToMinutes(p.startTime)
    const end = timeToMinutes(p.endTime)
    return currentMinutes >= start && currentMinutes < end
  })
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ─── Human-readable formatter ─────────────────────────────────────────────────

const DAYS_SHORT: Record<number, string> = {
  0: "dom",
  1: "lun",
  2: "mar",
  3: "mié",
  4: "jue",
  5: "vie",
  6: "sáb",
}

/**
 * Returns a compact, patient-facing summary of support hours.
 * Example: "lunes a viernes de 9:00 a 18:00" or
 *          "lun, mié, vie de 9:00 a 18:00" or
 *          "lunes a viernes de 9:00 a 13:00 y de 15:00 a 18:00"
 */
export function formatSupportHoursForPatient(schedule: DaySchedule[]): string {
  const enabled = schedule
    .filter((d) => d.enabled && d.periods?.length > 0)
    .sort((a, b) => {
      // Sort Mon-Sun: 1,2,3,4,5,6,0
      const order = [1, 2, 3, 4, 5, 6, 0]
      return order.indexOf(a.dayOfWeek) - order.indexOf(b.dayOfWeek)
    })

  if (enabled.length === 0) return ""

  // Check if all days share the same periods (most common case)
  const firstPeriods = JSON.stringify(enabled[0].periods)
  const allSamePeriods = enabled.every((d) => JSON.stringify(d.periods) === firstPeriods)

  const periodsStr = enabled[0].periods
    .map((p) => `de ${formatTime(p.startTime)} a ${formatTime(p.endTime)}`)
    .join(" y ")

  if (allSamePeriods) {
    const daysStr = compressDays(enabled.map((d) => d.dayOfWeek))
    return `${daysStr} ${periodsStr}`
  }

  // Fallback: list each day separately
  return enabled
    .map((d) => {
      const dayName = DAYS_SHORT[d.dayOfWeek]
      const times = d.periods
        .map((p) => `de ${formatTime(p.startTime)} a ${formatTime(p.endTime)}`)
        .join(" y ")
      return `${dayName} ${times}`
    })
    .join(", ")
}

function formatTime(time: string): string {
  const [h, m] = time.split(":")
  const hour = parseInt(h, 10)
  const min = m === "00" ? "" : `:${m}`
  return `${hour}${min}h`
}

/**
 * Compresses consecutive day numbers into ranges.
 * [1,2,3,4,5] → "lunes a viernes"
 * [1,3,5]     → "lun, mié, vie"
 */
function compressDays(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b))

  const DAYS_FULL: Record<number, string> = {
    0: "domingo",
    1: "lunes",
    2: "martes",
    3: "miércoles",
    4: "jueves",
    5: "viernes",
    6: "sábado",
  }

  // Try to find a single consecutive range
  if (sorted.length >= 3) {
    let consecutive = true
    for (let i = 1; i < sorted.length; i++) {
      const prev = order.indexOf(sorted[i - 1])
      const curr = order.indexOf(sorted[i])
      if (curr !== prev + 1) {
        consecutive = false
        break
      }
    }
    if (consecutive) {
      const first = DAYS_FULL[sorted[0]]
      const last = DAYS_FULL[sorted[sorted.length - 1]]
      return `${first} a ${last}`
    }
  }

  if (sorted.length === 1) return DAYS_FULL[sorted[0]]
  if (sorted.length === 2) return `${DAYS_FULL[sorted[0]]} y ${DAYS_FULL[sorted[1]]}`

  return sorted.map((d) => DAYS_SHORT[d]).join(", ")
}
