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
  /**
   * El prefijo de la línea (26/10/2026).
   *
   * Era siempre "DIRECT-FLOW". El portal web no tenía ningún registro de lo
   * que hacía —dos console.warn en todo el archivo— y el rastro de una
   * conversación se cortaba justo cuando el paciente saltaba de WhatsApp al
   * navegador. Con esto el portal escribe con la misma forma, así que filtrar
   * por el teléfono sigue mostrando el recorrido entero, de punta a punta.
   */
  origen?: string
}

/**
 * Log formateado para consola con prefijo distintivo
 */
function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.origen || "DIRECT-FLOW"}:${entry.phase}]`
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
  private origen: string

  constructor(phone: string, configId: string, phase: string, origen = "DIRECT-FLOW") {
    this.phone = phone
    this.configId = configId
    this.phase = phase
    this.origen = origen
  }

  debug(message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level: LogLevel.DEBUG,
      timestamp: new Date().toISOString(),
      phone: this.phone,
      configId: this.configId,
      phase: this.phase,
      origen: this.origen,
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
      origen: this.origen,
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
      origen: this.origen,
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
      origen: this.origen,
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
  phase: string,
  origen?: string,
): ConversationLogger {
  return new ConversationLogger(phone, configId, phase, origen)
}
