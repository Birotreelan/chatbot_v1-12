/**
 * Validadores para flujo de paciente nuevo
 */

export function validateName(input: string): { valid: boolean; name?: string; lastName?: string } {
  const parts = input.trim().split(/\s+/)
  
  if (parts.length < 2) {
    return { valid: false }
  }

  const name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
  const lastName = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')

  return { valid: true, name, lastName }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email.trim())
}

export function validateNumericSelection(input: string, max: number): { valid: boolean; number?: number } {
  const num = parseInt(input.trim(), 10)
  
  if (isNaN(num) || num < 1 || num > max) {
    return { valid: false }
  }

  return { valid: true, number: num }
}

export function extractNumber(input: string): number | null {
  const match = input.match(/\d+/)
  return match ? parseInt(match[0], 10) : null
}

export function validateYesNoResponse(input: string): { valid: boolean; isYes?: boolean } {
  const normalized = input.trim().toLowerCase()
  
  if (['1', 'si', 'sí', 'yes', 'confirmar', 'ok', 'dale'].includes(normalized)) {
    return { valid: true, isYes: true }
  }
  
  if (['2', 'no', 'nope', 'no confirmar', 'modificar'].includes(normalized)) {
    return { valid: true, isYes: false }
  }

  return { valid: false }
}
