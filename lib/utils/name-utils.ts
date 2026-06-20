/**
 * Utilidades para formateo de nombres de pacientes
 * 
 * Convierte nombres de cualquier formato (MAYUSCULAS, minusculas, MiXtO)
 * al formato correcto: "Primera Letra Mayuscula"
 * 
 * Ejemplos:
 * - "MARIA LUISA" -> "Maria Luisa"
 * - "juan carlos" -> "Juan Carlos"
 * - "PEREZ" -> "Perez"
 */

/**
 * Normaliza un nombre completo: Primera letra mayuscula, resto minuscula para cada palabra
 * @param name - Nombre a normalizar (puede estar en cualquier formato)
 * @returns Nombre normalizado con formato "Nombre Apellido"
 * 
 * Ejemplos:
 * - "MARIA LUISA" -> "Maria Luisa"
 * - "juan carlos" -> "Juan Carlos"
 * - "PEREZ, MARTIN" -> "Perez, Martin"
 */
export function formatName(name: string): string {
  if (!name) return ''
  
  return name
    .trim()
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (word.length === 0) return ''
      // Manejar palabras con comas (ej: "PEREZ," -> "Perez,")
      if (word.includes(',')) {
        return word
          .split(',')
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(',')
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * Extrae y formatea el primer nombre de un nombre completo
 * @param fullName - Nombre completo (puede incluir apellido)
 * @returns Primer nombre formateado
 * 
 * Ejemplos:
 * - "MARIA LUISA GONZALEZ" -> "Maria"
 * - "juan" -> "Juan"
 */
export function getFirstName(fullName: string): string {
  if (!fullName) return 'Paciente'
  
  const formatted = formatName(fullName)
  return formatted.split(' ')[0] || 'Paciente'
}

/**
 * Formatea nombre de profesional medico
 * @param nombre - Nombre del profesional
 * @returns Nombre formateado sin prefijo Dr/Dra (para agregar manualmente si es necesario)
 * 
 * Ejemplos:
 * - "LOPEZ, Martin Alejandro" -> "Lopez, Martin Alejandro"
 * - "ANDREA PAUCAR" -> "Andrea Paucar"
 */
export function formatProfessionalName(nombre: string): string {
  if (!nombre) return 'el profesional'
  return formatName(nombre)
}
