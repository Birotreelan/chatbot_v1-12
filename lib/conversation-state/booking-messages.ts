/**
 * Sprint 6b: Templates de mensajes para flujo de reserva
 * Pasos 1-4: Datos personales + tipo de búsqueda
 */

/**
 * PASO 1 - Paciente Nuevo: Solicitar nombre y apellido
 */
export function buildRequestNameMessage(): string {
  return "Perfecto, para solicitar un nuevo turno primero te pediré que me indiques tu nombre y apellido."
}

/**
 * PASO 2 - Paciente Nuevo: Solicitar obra social (después de nombre)
 */
export function buildRequestObraSocialMessage(firstName: string): string {
  return `Perfecto ${firstName}. Ahora necesito que me indiques tu obra social. Si no tenés obra social, escribí 'particular'.`
}

/**
 * PASO 2 - Obra social no encontrada en sistema
 */
export function buildObraSocialNotFoundMessage(): string {
  return `No he encontrado la obra social que ingresaste. Es posible que la hayas escrito mal o que no esté entre las obras sociales disponibles. ¿Querés volver a intentarlo con otro nombre o corregir el que ingresaste?`
}

/**
 * PASO 2 - Obra social encontrada en sistema pero no permite turnos online
 */
export function buildObraSocialNoOnlineMessage(obraSocialName: string): string {
  return `La clínica sí trabaja con la obra social ${obraSocialName}, pero los turnos para esta cobertura no pueden gestionarse por este canal. Para coordinar tu turno con esta obra social, te pedimos que te comuniques telefónicamente con la clínica o te acerques de forma presencial. Desde aquí no podemos agendarlo, pero la atención con tu obra social está disponible con normalidad.`
}

/**
 * PASO 2 - Obra social no trabaja en clínica
 */
export function buildObraSocialNotWorkedMessage(obraSocialName: string): string {
  return `Lamentamos informarte que no trabajamos con la obra social ${obraSocialName}. Si deseas obtener un turno particular, podes escribir 'particular' y podremos agendar un turno pero sin la cobertura de la obra social. Si necesitas más información, te recomendamos comunicarte directamente con la clínica.`
}

/**
 * PASO 2 - Múltiples obras sociales encontradas - Pedir selección
 */
export function buildMultipleObraSocialMessage(opciones: Array<{ numero: number; nombre: string }>): string {
  const lista = opciones
    .map((opt) => `${opt.numero}. ${opt.nombre}`)
    .join("\n")

  return `Encontré varias obras sociales con nombres similares. Por favor, indicá cuál es la correcta:

${lista}

Responde con el número de la opción que prefieras.`
}

/**
 * PASO 2 - Error en selección de obra social
 */
export function buildInvalidObraSocialSelectionMessage(maxOptions: number): string {
  return `No entendí tu selección. Por favor, indicame el número de la obra social que preferís de la lista anterior (entre 1 y ${maxOptions}).`
}

/**
 * PASO 3 - Solicitar selección de sede
 */
export function buildSelectSedeMessage(opciones: Array<{ numero: number; nombre: string }>): string {
  const lista = opciones
    .map((opt) => `${opt.numero}. ${opt.nombre}`)
    .join("\n")

  return `Contamos con varias sedes. Por favor, indicá en cuál querés agendar:

${lista}

Responde con el número de la opción que prefieras.`
}

/**
 * PASO 3 - Error en selección de sede
 */
export function buildInvalidSedeSelectionMessage(maxOptions: number): string {
  return `No entendí tu selección. Por favor, indicame el número de la sede que preferís de la lista anterior (entre 1 y ${maxOptions}).`
}

/**
 * PASO 4 - Solicitar tipo de búsqueda
 */
export function buildSearchTypeMenuMessage(): string {
  return `Ahora necesito saber qué tipo de turno buscas:

1. Médico particular (indicá el nombre del médico)
2. Por especialidad (indicá la especialidad que necesitás)
3. Cualquier médico disponible

Responde con el número de la opción que prefieras.`
}

/**
 * PASO 4 - Error en selección de tipo de búsqueda
 */
export function buildInvalidSearchTypeSelectionMessage(): string {
  return `No entendí tu selección. Por favor, indicame un número entre 1 y 3 según el tipo de búsqueda que prefieras.`
}

/**
 * PASO 4 - Solicitar nombre del médico (opción 1)
 */
export function buildRequestDoctorNameMessage(): string {
  return `Perfecto. ¿Cuál es el nombre del médico que estás buscando?`
}

/**
 * PASO 4 - Solicitar especialidad (opción 2)
 */
export function buildRequestSpecialtyMessage(): string {
  return `Perfecto. ¿Cuál es la especialidad que necesitás?`
}

/**
 * PASO 4 - Confirmación para búsqueda de cualquier médico
 */
export function buildAnyDoctorConfirmationMessage(): string {
  return `Perfecto. Voy a buscar todos los turnos disponibles con cualquier médico.`
}
