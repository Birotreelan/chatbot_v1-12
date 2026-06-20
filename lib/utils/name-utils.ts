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

// ---------------------------------------------------------------------------
// Apellidos argentinos frecuentes usados como ancla de heuristica
// ---------------------------------------------------------------------------
const APELLIDOS_CONOCIDOS = new Set([
  'acosta','aguero','aguilar','aguirre','albornoz','alvarado','alvarez','andrade',
  'arce','arias','baez','barrios','benitez','blanco','borges','bustos','caballero',
  'cabrera','campos','cardozo','carrizo','castillo','castro','centurion','chavez',
  'colombo','contreras','cordoba','coronel','correa','cuevas','delgado','diaz',
  'dominguez','escalante','espinoza','esquivel','estrada','fernandez','ferreyra',
  'figueroa','flores','franco','fuentes','galvez','garcia','gomez','gonzalez',
  'guerra','guerrero','gutierrez','guzman','heredia','hernandez','herrera','hidalgo',
  'ibarra','iglesias','jimenez','juarez','laguna','leiva','leon','llanos','lopez',
  'lozano','luna','machado','maldonado','mansilla','medina','mendez','mendoza',
  'mercado','miranda','molina','montoya','morales','moreno','moyano','muñoz','navarro',
  'nieto','nuñez','ojeda','olivares','olivera','ortega','ortiz','osorio','oyola',
  'pacheco','padilla','palacios','paredes','paz','pena','peña','peralta','perez',
  'pinto','ponce','prieto','quiroga','ramirez','ramos','reinoso','reyes','rios',
  'rivas','rivera','rodriguez','rojas','roldan','romero','ruiz','salinas','sanchez',
  'sandoval','santillan','santos','silva','soria','sosa','suarez','toledo','torres',
  'varela','vargas','vasquez','vazquez','vera','vidal','villalba','villarreal',
  'villanueva','zapata','zarate',
])

/**
 * Resultado del parseo de nombre ingresado por el usuario.
 */
export interface ParsedName {
  nombre: string   // primer nombre(s)
  apellido: string // apellido(s)
}

/**
 * Detecta si el usuario escribio apellido primero o nombre primero y devuelve
 * siempre { nombre, apellido } en el orden correcto.
 *
 * Reglas (en orden de prioridad):
 * 1. Coma explicita  →  la parte antes de la coma es el apellido.
 *    "Martinez, Maria Clara"  →  apellido="Martinez"  nombre="Maria Clara"
 * 2. Primera palabra en lista de apellidos conocidos  →  orden invertido.
 *    "Martinez Maria Clara"   →  apellido="Martinez"  nombre="Maria Clara"
 * 3. Sin señal clara  →  asume NOMBRE APELLIDO (convencion internacional y ejemplo
 *    que el bot muestra en su mensaje).
 *    "Juan Perez"             →  nombre="Juan"        apellido="Perez"
 *
 * En todos los casos las palabras se normalizan a "Primera Letra Mayuscula".
 *
 * @param input - Texto crudo ingresado por el usuario
 * @returns { nombre, apellido } o null si el input tiene menos de 2 palabras
 */
export function parseNameInput(input: string): ParsedName | null {
  const capitalize = (s: string) =>
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

  // Normalizar espacios y eliminar la coma como separador si existe
  const cleaned = input.trim().replace(/\s*,\s*/g, ',')

  // Caso 1: coma explicita  →  "Apellido, Nombre(s)"
  if (cleaned.includes(',')) {
    const [apellidoPart, ...nombreParts] = cleaned.split(',')
    const apellido = apellidoPart.trim().split(/\s+/).map(capitalize).join(' ')
    const nombre   = nombreParts.join(' ').trim().split(/\s+/).map(capitalize).join(' ')
    if (!apellido || !nombre) return null
    return { nombre, apellido }
  }

  const parts = cleaned.split(/\s+/)
  if (parts.length < 2) return null

  // Caso 2: primera palabra matchea apellido conocido  →  orden invertido
  const firstLower = parts[0].toLowerCase()
  if (APELLIDOS_CONOCIDOS.has(firstLower)) {
    const apellido = capitalize(parts[0])
    const nombre   = parts.slice(1).map(capitalize).join(' ')
    return { nombre, apellido }
  }

  // Caso 3: fallback  →  primera(s) palabra(s) son el nombre, la ultima es el apellido
  // Para nombres compuestos con 3+ partes sin señal, tratamos la ultima palabra
  // como apellido y el resto como nombre.
  if (parts.length >= 3) {
    const apellido = capitalize(parts[parts.length - 1])
    const nombre   = parts.slice(0, parts.length - 1).map(capitalize).join(' ')
    return { nombre, apellido }
  }

  // Exactamente 2 palabras sin señal  →  NOMBRE APELLIDO
  return {
    nombre:   capitalize(parts[0]),
    apellido: capitalize(parts[1]),
  }
}
