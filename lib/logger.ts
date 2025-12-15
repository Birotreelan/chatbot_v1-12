// Sistema de logging centralizado y simplificado

type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.VERCEL_ENV === "production" ? "info" : "debug")

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL as LogLevel]
}

export const logger = {
  debug: (prefix: string, message: string, data?: any) => {
    if (shouldLog("debug")) {
      console.debug(`[${prefix}] ${message}`, data !== undefined ? data : "")
    }
  },

  info: (prefix: string, message: string, data?: any) => {
    if (shouldLog("info")) {
      console.log(`[${prefix}] ${message}`, data !== undefined ? data : "")
    }
  },

  warn: (prefix: string, message: string, data?: any) => {
    if (shouldLog("warn")) {
      console.warn(`[${prefix}] ${message}`, data !== undefined ? data : "")
    }
  },

  error: (prefix: string, message: string, error?: any) => {
    if (shouldLog("error")) {
      console.error(`[${prefix}] ${message}`, error !== undefined ? error : "")
    }
  },

  // Helpers para operaciones comunes
  apiStart: (endpoint: string, method: string) => {
    logger.debug("API", `${method} ${endpoint}`)
  },

  apiSuccess: (endpoint: string, method: string) => {
    logger.info("API", `${method} ${endpoint} ✓`)
  },

  apiError: (endpoint: string, method: string, error: any) => {
    logger.error("API", `${method} ${endpoint} ✗`, error)
  },
}
