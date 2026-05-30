/**
 * Templates para flujo de paciente nuevo
 */

export function buildNameRequestMessage(): string {
  return 'Perfecto, para solicitar un nuevo turno primero te pediré que me indiques tu nombre y apellido.'
}

export function buildHealthInsuranceRequestMessage(firstName: string): string {
  return `Perfecto ${firstName}. Ahora necesito que me indiques tu obra social. Si no tenés obra social, escribí 'particular'.`
}

export function buildHealthInsuranceRetryMessage(firstName: string, invalidInput: string): string {
  return `${firstName}, no pude encontrar la obra social "${invalidInput}". Por favor, verificá el nombre e intentá de nuevo. Podés escribir el nombre completo (ej: "OSDE 210", "Swiss Medical", "Galeno") o "particular" si no tenés obra social.`
}

export function buildVenueSelectionMessage(firstName: string, venues: any[]): string {
  let message = `Perfecto ${firstName}, la obra social está habilitada.\n\nPara continuar, necesito que selecciones la sede donde querés atenderte:\n\n`
  
  venues.forEach((venue, idx) => {
    message += `${idx + 1}. ${venue.name}, ubicada en ${venue.address}, ${venue.city}, ${venue.province}\n`
  })
  
  return message
}

export function buildSearchTypeMessage(venueName: string): string {
  return `Buscaremos turnos en ${venueName}.\n\nPara eso, necesito saber si querés un turno con un médico en particular, por especialidad, o con cualquier médico:\n\n1. Solicitar turno con un médico en particular\n2. Solicitar turno por especialidad\n3. Solicitar turno con cualquier médico`
}

export function buildTurnsListMessage(firstName: string, turns: any[]): string {
  let message = `${firstName}, estos son los próximos turnos disponibles:\n\n`
  
  turns.forEach((turn, idx) => {
    message += `${idx + 1}. ${turn.time} con Dr. ${turn.professional}\n`
  })
  
  message += '\nPor favor, indicame el número del turno que prefieras reservar.'
  return message
}

export function buildEmailRequestMessage(firstName: string): string {
  return `Perfecto ${firstName}. Para continuar con la reserva, necesito que me indiques tu email.`
}

export function buildConfirmationMessage(
  firstName: string,
  lastName: string,
  dni: string,
  phone: string,
  email: string,
  healthInsurance: string,
  turnData: any,
  turnNumber: number
): string {
  return `${firstName}, para confirmar tu reserva necesito verificar los datos:

**DATOS DEL PACIENTE:**

Apellido: ${lastName}

Nombre: ${firstName}

DNI: ${dni}

Celular: ${phone}

Mail: ${email}

Obra Social: ${healthInsurance}

**DATOS DEL TURNO:**

Fecha: ${turnData.date}

Hora: ${turnData.time}

Profesional: Dr. ${turnData.professional}

Sede: ${turnData.venue}

¿Confirmás que los datos son correctos y deseás realizar la reserva del turno número ${turnNumber}?

Respondé con:
1. Sí, confirmar
2. No, modificar`
}

export function buildSuccessMessage(firstName: string): string {
  return `¡Excelente ${firstName}! Tu turno ha sido confirmado exitosamente. Recibirás un correo de confirmación en tu email con todos los detalles de tu cita. ¡Gracias por agendar con nosotros!`
}

export function buildErrorMessage(message: string): string {
  return `Disculpa, ${message}. Por favor, intentá de nuevo.`
}
