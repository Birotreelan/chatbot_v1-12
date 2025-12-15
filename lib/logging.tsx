// Sistema de logging para errores y eventos importantes

export async function logError(source: string, error: Error): Promise<void> {
  const errorLog = {
    source,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  }

  console.error(`[ERROR-LOG] ${source}:`, errorLog)

  // Aquí podrías agregar integración con servicios de logging como Sentry
  // Por ahora solo logueamos en consola
}

export async function logEvent(event: string, data?: any): Promise<void> {
  const eventLog = {
    event,
    data,
    timestamp: new Date().toISOString(),
  }

  console.log(`[EVENT-LOG] ${event}:`, eventLog)
}
