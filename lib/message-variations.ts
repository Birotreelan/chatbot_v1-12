// Sistema de variaciones de mensajes para evitar robotización

interface MessageVariations {
  [key: string]: string[]
}

// Variaciones para diferentes tipos de mensajes automáticos
export const MESSAGE_VARIATIONS: MessageVariations = {
  validating_dni: [
    "Aguardá unos instantes mientras validamos tu DNI.",
    "Verificando tu DNI, dame un momento por favor.",
    "Consultando tu información en el sistema, aguardá...",
    "Buscando tus datos con el DNI proporcionado.",
    "Un momento mientras verifico tu DNI en nuestra base de datos.",
    "Procesando tu DNI, esto tomará solo unos segundos.",
    "Validando la información de tu documento...",
  ],

  searching_specialties: [
    "Consultando las especialidades disponibles, aguardá unos instantes.",
    "Verificando qué especialidades tenemos disponibles...",
    "Buscando las especialidades que ofrecemos, un momento.",
    "Consultando nuestro catálogo de especialidades médicas.",
    "Revisando las especialidades disponibles en este momento.",
    "Dame un segundo mientras consulto las especialidades.",
    "Verificando las opciones de especialidades para vos.",
  ],

  searching_appointments: [
    "Voy a buscar turnos disponibles, aguardá unos instantes.",
    "Consultando la agenda para encontrar turnos libres...",
    "Buscando turnos disponibles en las fechas solicitadas.",
    "Revisando la disponibilidad de turnos, un momento.",
    "Verificando qué turnos tenemos disponibles para vos.",
    "Consultando los horarios disponibles, aguardá...",
    "Buscando las mejores opciones de turnos disponibles.",
    "Dame un momento mientras reviso la agenda médica.",
  ],

  searching_doctors: [
    "Buscando profesionales disponibles, aguardá un momento.",
    "Consultando nuestro equipo médico disponible...",
    "Verificando qué doctores están disponibles.",
    "Buscando los profesionales que coinciden con tu búsqueda.",
    "Revisando nuestro staff médico, un momento por favor.",
    "Consultando la disponibilidad de nuestros profesionales.",
    "Dame un segundo mientras busco los doctores disponibles.",
  ],

  processing_reservation: [
    "Procesando tu reserva de turno, aguardá un momento.",
    "Confirmando tu turno en el sistema, esto tomará unos segundos.",
    "Registrando tu cita médica, aguardá por favor.",
    "Finalizando la reserva de tu turno...",
    "Guardando los datos de tu turno en el sistema.",
    "Procesando la confirmación de tu cita médica.",
    "Un momento mientras confirmo tu turno en la agenda.",
  ],

  general_processing: [
    "Procesando tu solicitud, aguardá un momento.",
    "Dame unos segundos mientras proceso tu pedido.",
    "Trabajando en tu consulta, un momento por favor.",
    "Verificando la información solicitada...",
    "Consultando el sistema, esto tomará solo unos instantes.",
    "Procesando tu consulta, aguardá por favor.",
  ],
}

// Función para obtener un mensaje aleatorio de una categoría
export function getRandomMessage(category: keyof typeof MESSAGE_VARIATIONS): string {
  const variations = MESSAGE_VARIATIONS[category]
  if (!variations || variations.length === 0) {
    return MESSAGE_VARIATIONS.general_processing[0] // Fallback
  }

  const randomIndex = Math.floor(Math.random() * variations.length)
  return variations[randomIndex]
}

// Función para obtener múltiples mensajes aleatorios sin repetir
export function getRandomMessages(category: keyof typeof MESSAGE_VARIATIONS, count = 1): string[] {
  const variations = MESSAGE_VARIATIONS[category] || MESSAGE_VARIATIONS.general_processing
  const shuffled = [...variations].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(count, shuffled.length))
}

// Función para agregar contexto temporal a los mensajes
export function getContextualMessage(category: keyof typeof MESSAGE_VARIATIONS, context?: string): string {
  let baseMessage = getRandomMessage(category)

  // Agregar contexto específico si se proporciona
  if (context) {
    switch (category) {
      case "searching_appointments":
        baseMessage = baseMessage.replace("turnos disponibles", `turnos disponibles ${context}`)
        break
      case "searching_doctors":
        baseMessage = baseMessage.replace("profesionales", `profesionales ${context}`)
        break
      case "validating_dni":
        baseMessage = baseMessage.replace("tu DNI", `el DNI ${context}`)
        break
    }
  }

  return baseMessage
}

// Sistema de cache para evitar repetir el mismo mensaje muy seguido
class MessageCache {
  private recentMessages: Map<string, string[]> = new Map()
  private maxCacheSize = 3

  getUniqueMessage(category: keyof typeof MESSAGE_VARIATIONS, context?: string): string {
    const recent = this.recentMessages.get(category) || []
    const variations = MESSAGE_VARIATIONS[category] || MESSAGE_VARIATIONS.general_processing

    // Filtrar mensajes que no se han usado recientemente
    const availableMessages = variations.filter((msg) => !recent.includes(msg))

    // Si todos los mensajes se usaron recientemente, usar cualquiera
    const messagePool = availableMessages.length > 0 ? availableMessages : variations

    const randomIndex = Math.floor(Math.random() * messagePool.length)
    const selectedMessage = messagePool[randomIndex]

    // Actualizar cache
    recent.push(selectedMessage)
    if (recent.length > this.maxCacheSize) {
      recent.shift() // Remover el más antiguo
    }
    this.recentMessages.set(category, recent)

    // Aplicar contexto si se proporciona
    return context ? getContextualMessage(category, context) : selectedMessage
  }
}

// Instancia global del cache de mensajes
export const messageCache = new MessageCache()

// Función principal para usar en el código
export function getVariedMessage(category: keyof typeof MESSAGE_VARIATIONS, context?: string): string {
  return messageCache.getUniqueMessage(category, context)
}
