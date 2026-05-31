/**
 * Templates para flujo de paciente nuevo
 */

export function buildNewPatientInitialMenuMessage(): string {
  return `Gracias, ya hemos validado tu DNI. Te agendaremos como nuevo paciente.\n\n¿En qué te podemos ayudar?\n\n1. Solicitar turno médico\n\nPor favor selecciona el número de opción para continuar.`
}

export function buildNameRequestMessage(): string {
  return 'Perfecto, para solicitar un nuevo turno primero te pediré que me indiques tu nombre y apellido.'
}

export function buildHealthInsuranceRequestMessage(firstName: string): string {
  return `Perfecto ${firstName}. Ahora necesito que me indiques tu obra social. Si no tenés obra social, escribí 'particular'.`
}

export function buildHealthInsuranceRetryMessage(firstName: string, invalidInput: string): string {
  return `${firstName}, no pude encontrar la obra social "${invalidInput}". Es posible que la hayas escrito mal o que no esté entre las obras sociales disponibles. ¿Querés volver a intentarlo con otro nombre o corregir el que ingresaste?`
}

export function buildVenueSelectionMessage(firstName: string, venues: any[]): string {
  let message = `Perfecto ${firstName}, la obra social está habilitada para obtener turnos por este medio.\n\nPara continuar, necesito que selecciones la sede donde querés atenderte. Por favor, indicame el número de la sede que preferís.\n\n`
  
  venues.forEach((venue, idx) => {
    message += `${idx + 1}. ${venue.name}, ubicada en ${venue.address}, ${venue.city}, ${venue.province}\n`
  })
  
  return message
}

export function buildSearchTypeMessage(venueName: string): string {
  return `Buscaremos turnos en ${venueName}.\n\nPara eso, necesito saber si querés un turno con un médico en particular, por especialidad, o con cualquier médico. Por favor, indicame si preferís:\n\n1. Solicitar turno con un médico en particular\n2. Solicitar turno por especialidad\n3. Solicitar turno con cualquier médico`
}

export function buildTurnsListMessage(firstName: string, turns: any[]): string {
  let message = `Encontre los siguientes turnos disponibles:\n\n`
  
  turns.forEach((turn, idx) => {
    message += `${idx + 1}. ${turn.time} con ${turn.professional}\n`
  })
  
  message += '\nPor favor, indicame el número del turno que preferís.'
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

Profesional: ${turnData.professional}

Sede: ${turnData.venue}

Id Turno: ${turnData.id}

¿Confirmás que los datos son correctos y deseás realizar la reserva del turno número ${turnNumber}?

Respondé con:
1. Sí, confirmar
2. No, modificar`
}

export function buildSuccessMessage(firstName: string): string {
  return `Tu solicitud de turno fue enviada exitosamente!\n\nImportante: Esta solicitud debe ser aprobada por la clínica para que el turno te sea otorgado. Te notificaremos cuando ello ocurra.`
}

export function buildErrorMessage(message: string): string {
  return `Disculpa, ${message}. Por favor, intentá de nuevo.`
}
