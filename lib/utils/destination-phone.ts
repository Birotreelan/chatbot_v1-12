/**
 * lib/utils/destination-phone.ts
 *
 * Resuelve a qué número enviar un template, tolerando que el sistema de la
 * clínica mande un campo `Phone` inutilizable.
 *
 * EL PROBLEMA (31/8/2026, detectado en los logs de Vercel)
 * `[WHATSAPP_API] Error enviando template: ... "The phone number is malformed"`
 * era el error más frecuente de todo el sistema: 1262 ocurrencias entre el
 * 16/6/2026 y el 31/8/2026, todas en /api/proxylistener. Cada una es un
 * recordatorio de turno que el paciente nunca recibió, sin que nadie se
 * enterara: la clínica daba el aviso por enviado.
 *
 * La causa es de datos, no de red. En la ficha del paciente el teléfono está
 * cargado como DOS números:
 *
 *     "telefono": "4629-1581 / 1144178909"     (fijo / celular)
 *
 * El sistema de la clínica le saca los separadores para armar el parámetro
 * `Phone` y termina mandando `462915811144178909` (18 dígitos). Nuestro código
 * veía que no empezaba con 54, le anteponía "549" y le pasaba a WhatsApp un
 * número de 21 dígitos. Ejemplos reales del mismo día:
 *
 *     462941741544996787  →  4629-4174 / 15-4499-6787
 *     448575981558624329  →  4485-7598 / 15-5862-4329
 *     156006266046924300  →  15-6006-2660 / 4692-4300   (celular primero)
 *
 * LA SOLUCIÓN
 * El valor ORIGINAL, con el separador intacto, viaja en
 * `Chatbot_Data.paciente.telefono`. Así que no hay que adivinar dónde cortar
 * un número de 18 dígitos (ambiguo y peligroso: mandar un recordatorio médico
 * al número equivocado es un incidente de privacidad): alcanza con separar por
 * el separador que ya está ahí y quedarse con el candidato que sea un celular
 * válido. El número sale de la ficha del propio paciente.
 *
 * Si no se puede recuperar, se devuelve null y el caller corta con un error
 * explícito en vez de mandarle basura a WhatsApp.
 */

/** Separadores con los que la clínica carga más de un teléfono en un campo. */
const SEPARADORES = /[\/|,;\n]+|\s{2,}|\s+[-–]\s+|\s+(?:y|o)\s+/i

/**
 * Normaliza un candidato a formato nacional argentino de 10 dígitos.
 * Devuelve null si no puede serlo.
 *
 *   "1144178909"      → "1144178909"
 *   "+54 9 11 4417-8909" → "1144178909"
 *   "4629-1581"       → null  (8 dígitos: fijo sin característica, no sirve para WhatsApp)
 *   "462915811144178909" → null  (18 dígitos: dos números pegados)
 */
export function normalizarCandidatoNacional(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return null

  // Con código de país: 549 + 10, o 54 + 10
  if (digits.startsWith('549') && digits.length === 13) return digits.slice(3)
  if (digits.startsWith('54') && digits.length === 12) return digits.slice(2)

  // Formato nacional directo
  if (digits.length === 10) return digits

  // Cualquier otra longitud no es un celular argentino utilizable.
  return null
}

/**
 * Entre varios candidatos válidos, prefiere el que más parece un celular.
 * En Argentina los celulares se cargan como 11XXXXXXXX (AMBA) o 15XXXXXXXX
 * (prefijo local heredado). Un 10 dígitos con otra característica (ej. 341
 * de Rosario) también puede ser celular, así que no se descarta: solo se
 * ordena después.
 */
function puntajeCelular(nacional: string): number {
  if (nacional.startsWith('11') || nacional.startsWith('15')) return 2
  return 1
}

export interface ResolucionTelefono {
  /** Número nacional de 10 dígitos listo para enviar, o null si no se pudo resolver. */
  telefono: string | null
  origen: 'parametro_phone' | 'recuperado_de_ficha' | 'no_resuelto'
  /** Para logs y para avisarle a la clínica qué llegó mal. */
  detalle?: string
}

/**
 * Decide el número de destino.
 *
 * @param phoneParam        el campo `Phone` que mandó la clínica
 * @param telefonoDeFicha   `Chatbot_Data.paciente.telefono` (crudo, con separadores)
 */
export function resolveDestinationPhone(
  phoneParam: string | number | undefined,
  telefonoDeFicha?: string | number,
): ResolucionTelefono {
  // 1) El parámetro Phone, que es lo que se usaba siempre.
  const desdeParam = normalizarCandidatoNacional(String(phoneParam ?? ''))
  if (desdeParam) {
    return { telefono: desdeParam, origen: 'parametro_phone' }
  }

  // 2) Phone inutilizable → recuperar desde la ficha, que conserva el separador.
  const crudo = String(telefonoDeFicha ?? '').trim()
  if (crudo) {
    const candidatos = crudo
      .split(SEPARADORES)
      .map((p) => normalizarCandidatoNacional(p))
      .filter((p): p is string => !!p)

    if (candidatos.length > 0) {
      const elegido = candidatos.sort((a, b) => puntajeCelular(b) - puntajeCelular(a))[0]
      return {
        telefono: elegido,
        origen: 'recuperado_de_ficha',
        detalle: `Phone inválido ("${String(phoneParam ?? '').slice(0, 30)}"); recuperado de la ficha ("${crudo.slice(0, 40)}")`,
      }
    }
  }

  return {
    telefono: null,
    origen: 'no_resuelto',
    detalle: `Phone inválido ("${String(phoneParam ?? '').slice(0, 30)}") y la ficha no tiene un celular utilizable ("${crudo.slice(0, 40)}")`,
  }
}
