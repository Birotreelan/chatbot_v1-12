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
/**
 * Las partículas que van en minúscula cuando están en el medio (24/11/2026).
 *
 * "GARCIA DE LA TORRE" en Title Case puro queda "Garcia De La Torre", que no
 * es como se escribe un apellido en castellano. Al principio sí van en
 * mayúscula —"De la Torre, Juan"— porque ahí abren el nombre.
 */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "da", "do", "dos", "van", "von"])

/** Los tratamientos, que llevan punto y mayúscula. */
const TRATAMIENTOS: Record<string, string> = {
  dr: "Dr.",
  "dr.": "Dr.",
  dra: "Dra.",
  "dra.": "Dra.",
  lic: "Lic.",
  "lic.": "Lic.",
}

export function formatName(name: string): string {
  if (!name) return ''

  /**
   * ── Los espacios se colapsan (24/11/2026) ────────────────────────────────
   *
   * La agenda devuelve los campos rellenados con espacios —en un payload real
   * se ve `"obra_social_nombre": "OSDE          "`— y un nombre llega como
   * "LIMONES PAINII,   ROSALINDA". Con `split(' ')` esos huecos quedaban como
   * palabras vacías y el nombre salía con los espacios de la base adentro.
   */
  const palabras = name.trim().toLowerCase().split(/\s+/).filter(Boolean)

  return palabras
    .map((word, indice) => {
      const tratamiento = TRATAMIENTOS[word]
      if (tratamiento) return tratamiento

      // Una partícula en el medio queda en minúscula; abriendo el nombre, no.
      if (indice > 0 && PARTICULAS.has(word)) return word

      // Palabras con comas (ej: "PEREZ," -> "Perez,") y con guion
      // ("LOPEZ-MARTINEZ" -> "Lopez-Martinez"), que es lo mismo: hay que
      // capitalizar las dos partes, no sólo la primera.
      if (word.includes(',') || word.includes('-')) {
        return word
          .split(/([,-])/)
          .map(parte =>
            parte === ',' || parte === '-' ? parte : parte.charAt(0).toUpperCase() + parte.slice(1),
          )
          .join('')
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
