/**
 * Extractor de selecciones numéricas inteligente
 * Detecta selecciones en base a:
 * - Números directos (1, 2, 3)
 * - Números en letras (uno, dos, tres)
 * - Ordinales (primero, segundo, tercero)
 * - Posicionales (primero, último, anterior)
 * - Coincidencia de texto con las opciones
 * - Coincidencia parcial/fuzzy
 */

export interface SelectionOption {
  index: number
  label: string
  details?: string
  metadata?: Record<string, any>
}

export interface SelectionResult {
  selected: boolean
  selectedIndex?: number
  selectedOption?: SelectionOption
  confidence: "high" | "medium" | "low"
  matchType: "direct_number" | "word_number" | "ordinal" | "positional" | "text_match" | "partial_match" | "fuzzy_match" | "none"
  reason?: string
}

// Mapeo de números en letras a dígitos
const WORD_NUMBERS: Record<string, number> = {
  cero: 0,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

// Mapeo de ordinales a índices
const ORDINALS: Record<string, number> = {
  primero: 0,
  primer: 0,
  primera: 0,
  segundo: 1,
  segunda: 1,
  tercero: 2,
  tercera: 2,
  cuarto: 3,
  cuarta: 3,
  quinto: 4,
  quinta: 4,
  sexto: 5,
  sexta: 5,
  séptimo: 6,
  séptima: 6,
  octavo: 7,
  octava: 7,
  noveno: 8,
  novena: 8,
  décimo: 9,
  décima: 9,
};

/**
 * Capa 1: Extrae número directo del mensaje (1, 2, 3, etc.)
 */
function extractDirectNumber(message: string): number | null {
  const match = message.match(/\b([0-9]{1,2})\b/);
  if (match) {
    const num = parseInt(match[1], 10);
    // Valida que el número esté en rango razonable para selecciones
    if (num >= 0 && num <= 99) {
      return num;
    }
  }
  return null;
}

/**
 * Capa 2: Extrae número escrito en letras (uno, dos, tres, etc.)
 */
function extractWordNumber(message: string): number | null {
  const normalized = message.toLowerCase();
  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    if (normalized.includes(word)) {
      return num;
    }
  }
  return null;
}

/**
 * Capa 3: Extrae ordinal (primero, segundo, etc.)
 */
function extractOrdinal(message: string): number | null {
  const normalized = message.toLowerCase();
  for (const [ordinal, index] of Object.entries(ORDINALS)) {
    if (normalized.includes(ordinal)) {
      return index;
    }
  }
  return null;
}

/**
 * Capa 4: Detecta posicionales (primero, último, anterior, siguiente)
 */
function extractPositional(
  message: string,
  totalOptions: number,
  currentIndex?: number
): number | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("último") || normalized.includes("ultima")) {
    return totalOptions - 1;
  }

  if (normalized.includes("primera") || normalized.includes("primero")) {
    return 0;
  }

  if (normalized.includes("siguiente") || normalized.includes("próximo")) {
    if (currentIndex !== undefined && currentIndex + 1 < totalOptions) {
      return currentIndex + 1;
    }
  }

  if (normalized.includes("anterior") || normalized.includes("previo")) {
    if (currentIndex !== undefined && currentIndex - 1 >= 0) {
      return currentIndex - 1;
    }
  }

  return null;
}

/**
 * Capa 5: Coincidencia exacta o casi exacta de texto
 */
function extractTextMatch(
  message: string,
  options: SelectionOption[]
): number | null {
  const normalized = message.toLowerCase().trim();

  // Búsqueda exacta
  for (const opt of options) {
    if (opt.label.toLowerCase() === normalized) {
      return opt.index;
    }
  }

  // Búsqueda que el mensaje contenga la opción completa
  for (const opt of options) {
    if (normalized.includes(opt.label.toLowerCase())) {
      return opt.index;
    }
  }

  // Búsqueda que la opción contenga palabras clave del mensaje
  const messageWords = normalized.split(/[\s,.-]+/).filter((w) => w.length > 2);
  for (const opt of options) {
    const optionLabel = opt.label.toLowerCase();
    const matchedWords = messageWords.filter(
      (w) => optionLabel.includes(w) && w.length > 2
    );
    if (matchedWords.length > 0 && matchedWords.length === messageWords.length) {
      return opt.index;
    }
  }

  return null;
}

/**
 * Capa 6: Coincidencia parcial/fuzzy
 * Valida similaridad entre strings
 */
function levenshteinDistance(a: string, b: string): number {
  const dp: number[][] = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }

  return dp[a.length][b.length];
}

function extractFuzzyMatch(
  message: string,
  options: SelectionOption[],
  threshold: number = 0.7
): number | null {
  const normalized = message.toLowerCase().trim();
  let bestMatch: { index: number; similarity: number } | null = null;

  for (const opt of options) {
    const optLabel = opt.label.toLowerCase();
    const distance = levenshteinDistance(normalized, optLabel);
    const maxLen = Math.max(normalized.length, optLabel.length);
    const similarity = 1 - distance / maxLen;

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { index: opt.index, similarity };
      }
    }
  }

  return bestMatch ? bestMatch.index : null;
}

/**
 * Función principal: Intenta extraer selección con todas las capas
 * Retorna resultado con índice y nivel de confianza
 */
export function extractSelection(
  message: string,
  options: SelectionOption[],
  currentIndex?: number
): SelectionResult {
  if (!message || message.trim().length === 0) {
    return {
      selected: false,
      confidence: "low",
      matchType: "none",
      reason: "Mensaje vacío",
    };
  }

  if (options.length === 0) {
    return {
      selected: false,
      confidence: "low",
      matchType: "none",
      reason: "No hay opciones disponibles",
    };
  }

  // Capa 1: Número directo
  const directNum = extractDirectNumber(message);
  if (directNum !== null) {
    // Convierte a índice (0-based)
    const selectedIndex =
      directNum === 0 ? options.length - 1 : directNum - 1;
    if (selectedIndex >= 0 && selectedIndex < options.length) {
      return {
        selected: true,
        selectedIndex,
        selectedOption: options[selectedIndex],
        confidence: "high",
        matchType: "direct_number",
        reason: `Número directo detectado: ${directNum}`,
      };
    }
  }

  // Capa 2: Número en letras
  const wordNum = extractWordNumber(message);
  if (wordNum !== null) {
    const selectedIndex = wordNum === 0 ? options.length - 1 : wordNum - 1;
    if (selectedIndex >= 0 && selectedIndex < options.length) {
      return {
        selected: true,
        selectedIndex,
        selectedOption: options[selectedIndex],
        confidence: "high",
        matchType: "word_number",
        reason: `Número en letras detectado: ${wordNum}`,
      };
    }
  }

  // Capa 3: Ordinal
  const ordinalIndex = extractOrdinal(message);
  if (ordinalIndex !== null && ordinalIndex < options.length) {
    return {
      selected: true,
      selectedIndex: ordinalIndex,
      selectedOption: options[ordinalIndex],
      confidence: "high",
      matchType: "ordinal",
      reason: `Ordinal detectado: ${ordinalIndex + 1}º`,
    };
  }

  // Capa 4: Posicional
  const positionalIndex = extractPositional(message, options.length, currentIndex);
  if (positionalIndex !== null) {
    return {
      selected: true,
      selectedIndex: positionalIndex,
      selectedOption: options[positionalIndex],
      confidence: "high",
      matchType: "positional",
      reason: `Posicional detectado: índice ${positionalIndex}`,
    };
  }

  // Capa 5: Coincidencia de texto
  const textMatchIndex = extractTextMatch(message, options);
  if (textMatchIndex !== null) {
    return {
      selected: true,
      selectedIndex: textMatchIndex,
      selectedOption: options[textMatchIndex],
      confidence: "high",
      matchType: "text_match",
      reason: `Coincidencia de texto detectada`,
    };
  }

  // Capa 6: Coincidencia parcial (fuzzy)
  const fuzzyMatchIndex = extractFuzzyMatch(message, options, 0.65);
  if (fuzzyMatchIndex !== null) {
    return {
      selected: true,
      selectedIndex: fuzzyMatchIndex,
      selectedOption: options[fuzzyMatchIndex],
      confidence: "medium",
      matchType: "fuzzy_match",
      reason: `Coincidencia fuzzy detectada`,
    };
  }

  // Sin coincidencia
  return {
    selected: false,
    confidence: "low",
    matchType: "none",
    reason: "No se detectó selección en el mensaje",
  };
}

/**
 * Helper: Convierte un array de strings en SelectionOption[]
 */
export function createOptionsFromLabels(labels: string[]): SelectionOption[] {
  return labels.map((label, index) => ({
    index,
    label,
  }));
}

/**
 * Helper: Valida si un número de selección es válido para las opciones disponibles
 */
export function isValidSelection(
  index: number,
  options: SelectionOption[]
): boolean {
  return index >= 0 && index < options.length;
}
