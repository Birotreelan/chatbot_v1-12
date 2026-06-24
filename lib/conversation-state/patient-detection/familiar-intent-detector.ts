/**
 * Familiar Intent Detector
 * Detecta si el primer mensaje indica que el usuario gestiona el turno de un familiar.
 */

export interface FamiliarIntentResult {
  detected: boolean
  relation?: string // "marido", "esposa", "hijo", etc. (original con tildes)
}

// Palabras relacionales, normalizadas sin tildes internamente para matching
const FAMILIAR_KEYWORDS: { normalized: string; original: string }[] = [
  { normalized: 'marido', original: 'marido' },
  { normalized: 'esposo', original: 'esposo' },
  { normalized: 'esposa', original: 'esposa' },
  { normalized: 'mujer', original: 'mujer' },
  { normalized: 'senora', original: 'señora' },
  { normalized: 'senor', original: 'señor' },
  { normalized: 'hijo', original: 'hijo' },
  { normalized: 'hija', original: 'hija' },
  { normalized: 'hijito', original: 'hijito' },
  { normalized: 'hijita', original: 'hijita' },
  { normalized: 'madre', original: 'madre' },
  { normalized: 'mama', original: 'mamá' },
  { normalized: 'mami', original: 'mami' },
  { normalized: 'padre', original: 'padre' },
  { normalized: 'papa', original: 'papá' },
  { normalized: 'papi', original: 'papi' },
  { normalized: 'hermano', original: 'hermano' },
  { normalized: 'hermana', original: 'hermana' },
  { normalized: 'abuelo', original: 'abuelo' },
  { normalized: 'abuela', original: 'abuela' },
  { normalized: 'suegro', original: 'suegro' },
  { normalized: 'suegra', original: 'suegra' },
  { normalized: 'cunado', original: 'cuñado' },
  { normalized: 'cunada', original: 'cuñada' },
  { normalized: 'tio', original: 'tío' },
  { normalized: 'tia', original: 'tía' },
  { normalized: 'novio', original: 'novio' },
  { normalized: 'novia', original: 'novia' },
  { normalized: 'pareja', original: 'pareja' },
  { normalized: 'familiar', original: 'familiar' },
  { normalized: 'pariente', original: 'pariente' },
]

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics
}

/**
 * Detecta si el mensaje del usuario sugiere que está gestionando
 * el turno de un familiar. Retorna la palabra relacional encontrada.
 */
export function detectFamiliarIntent(message: string): FamiliarIntentResult {
  const normalized = normalizeText(message)

  for (const { normalized: keyword, original } of FAMILIAR_KEYWORDS) {
    // Word boundary match — handles "marido" in "mi marido tiene turno"
    const regex = new RegExp(`\\b${keyword}\\b`)
    if (regex.test(normalized)) {
      return { detected: true, relation: original }
    }
  }

  return { detected: false }
}
