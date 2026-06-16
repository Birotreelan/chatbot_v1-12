/**
 * Logger unificado para flujos de conversación
 * Todos los logs de respuestas directas tienen prefijo [DIRECT-FLOW] para fácil debugging
 */

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface LogEntry {
  level: LogLevel
  timestamp: string
  phone: string
  configId: string
  phase: string
  message: string
  metadata?: Record<string, any>
}

/**
 * Log formateado para consola con prefijo distintivo
 */
function formatLog(entry: LogEntry): string {
  const prefix = `[DIRECT-FLOW:${entry.phase}]`
  const timestamp = new Date(entry.timestamp).toISOString()
  const metadata = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : ""
  return `${prefix} (${timestamp}) ${entry.phone}@${entry.configId} → ${entry.message}${metadata}`
}

/**
 * Logger para conversaciones directas
 * Se puede extender para enviar a servicio de logging centralizado
 */
export class ConversationLogger {
  private phone: string
  private configId: string
  private phase: string

  constructor(phone: string, configId: string, phase: string) {
    this.phone = phone
    this.configId = configId
    this.phase = phase
  }

  debug(message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level: LogLevel.DEBUG,
      timestamp: new Date().toISOString(),
      phone: this.phone,
      configId: this.configId,
      phase: this.phase,
      message,
      metadata,
    }
    console.debug(formatLog(entry))
  }

  info(message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level: LogLevel.INFO,
      timestamp: new Date().toISOString(),
      phone: this.phone,
      configId: this.configId,
      phase: this.phase,
      message,
      metadata,
    }
    console.info(formatLog(entry))
  }

  warn(message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level: LogLevel.WARN,
      timestamp: new Date().toISOString(),
      phone: this.phone,
      configId: this.configId,
      phase: this.phase,
      message,
      metadata,
    }
    console.warn(formatLog(entry))
  }

  error(message: string, error?: Error, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level: LogLevel.ERROR,
      timestamp: new Date().toISOString(),
      phone: this.phone,
      configId: this.configId,
      phase: this.phase,
      message,
      metadata: {
        ...metadata,
        errorMessage: error?.message,
        errorStack: error?.stack,
      },
    }
    console.error(formatLog(entry))
  }

  /**
   * Cambiar de fase (útil cuando la fase progresa)
   */
  setPhase(newPhase: string) {
    this.phase = newPhase
  }
}

/**
 * Factory para crear loggers
 */
export function createConversationLogger(
  phone: string,
  configId: string,
  phase: string
): ConversationLogger {
  return new ConversationLogger(phone, configId, phase)
}
