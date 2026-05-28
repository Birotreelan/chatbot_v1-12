/**
 * Validadores para el flujo de paciente existente
 */

/**
 * Valida formato de email
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Valida que sea una selección numérica válida
 */
export function validateNumericSelection(
  input: string,
  minValue: number = 1,
  maxValue: number
): boolean {
  const num = parseInt(input.trim(), 10)
  return !isNaN(num) && num >= minValue && num <= maxValue
}

/**
 * Extrae número de selección
 */
export function extractNumericSelection(input: string): number | null {
  const match = input.trim().match(/^\d+$/)
  if (!match) return null
  return parseInt(match[0], 10)
}

/**
 * Valida que la obra social sea válida (básico)
 */
export function validateObraSocial(obraSocial: string): boolean {
  return obraSocial && obraSocial.trim().length > 0 && obraSocial.trim().length < 100
}

/**
 * Valida respuesta sí/no
 */
export function validateYesNoResponse(input: string): 'yes' | 'no' | null {
  const patterns = {
    yes: /^(1|si|sí|yes|confirmo|ok|bueno|d'acuerdo|dale)/i,
    no: /^(2|no|cancelo|volver|atras|atrás|rechazar)/i,
  }

  if (patterns.yes.test(input.trim())) return 'yes'
  if (patterns.no.test(input.trim())) return 'no'

  return null
}
