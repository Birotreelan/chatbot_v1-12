/**
 * PRUEBAS Y EJEMPLOS DEL SELECTION EXTRACTOR
 * 
 * Este archivo contiene ejemplos de uso y pruebas para validar
 * que el extractor detecta correctamente todas las capas de selección.
 */

import {
  extractSelection,
  createOptionsFromLabels,
  SelectionOption,
} from "./selection-extractor"

// ============================================================================
// OPCIONES DE PRUEBA
// ============================================================================

const TURN_OPTIONS: SelectionOption[] = [
  {
    index: 0,
    label: "Lunes 15 de Abril - 14:00 - Dr. García",
    details: "Turno matutino - Consultorio 3",
  },
  {
    index: 1,
    label: "Martes 16 de Abril - 10:30 - Dra. López",
    details: "Turno matutino - Consultorio 1",
  },
  {
    index: 2,
    label: "Miércoles 17 de Abril - 16:45 - Dr. Martínez",
    details: "Turno vespertino - Consultorio 5",
  },
]

const OBRA_SOCIAL_OPTIONS: SelectionOption[] = [
  { index: 0, label: "OSDE" },
  { index: 1, label: "IOMA" },
  { index: 2, label: "Swiss Medical" },
  { index: 3, label: "Galeno" },
]

const SEDE_OPTIONS: SelectionOption[] = [
  { index: 0, label: "Sede Flores - Av. Donato Álvarez 1850" },
  { index: 1, label: "Sede Caballito - Av. Pedro Goyena 3200" },
  { index: 2, label: "Sede Centro - Corrientes 1234" },
]

// ============================================================================
// SUITE DE PRUEBAS
// ============================================================================

interface TestCase {
  description: string
  message: string
  options: SelectionOption[]
  expectedIndex: number | null
  minConfidence?: "high" | "medium" | "low"
}

const TEST_CASES: TestCase[] = [
  // CAPA 1: Números directos
  {
    description: "Número directo: '1'",
    message: "1",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Número directo: '2'",
    message: "2",
    options: TURN_OPTIONS,
    expectedIndex: 1,
  },
  {
    description: "Número con espacios: ' 3 '",
    message: " 3 ",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },

  // CAPA 2: Números en letras
  {
    description: "Número en letras: 'uno'",
    message: "uno",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Número en letras: 'dos'",
    message: "dos",
    options: TURN_OPTIONS,
    expectedIndex: 1,
  },
  {
    description: "Número en letras con prefijo: 'quiero dos'",
    message: "quiero dos",
    options: TURN_OPTIONS,
    expectedIndex: 1,
  },
  {
    description: "Número en letras con sufijo: 'el tres'",
    message: "el tres",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },

  // CAPA 3: Ordinales
  {
    description: "Ordinal: 'primero'",
    message: "primero",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Ordinal: 'segundo'",
    message: "segundo",
    options: TURN_OPTIONS,
    expectedIndex: 1,
  },
  {
    description: "Ordinal: 'tercero'",
    message: "tercero",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },
  {
    description: "Ordinal con prefijo: 'quiero el primer turno'",
    message: "quiero el primer turno",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },

  // CAPA 4: Posicionales
  {
    description: "Posicional: 'primero'",
    message: "primero",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Posicional: 'último'",
    message: "último",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },
  {
    description: "Posicional: 'la última opción'",
    message: "la última opción",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },

  // CAPA 5: Coincidencia de texto (OSDE)
  {
    description: "Coincidencia exacta: 'OSDE'",
    message: "OSDE",
    options: OBRA_SOCIAL_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Coincidencia parcial: 'osde'",
    message: "osde",
    options: OBRA_SOCIAL_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Coincidencia con contenedor: 'tengo OSDE'",
    message: "tengo OSDE",
    options: OBRA_SOCIAL_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Coincidencia de nombre: 'Swiss Medical'",
    message: "Swiss Medical",
    options: OBRA_SOCIAL_OPTIONS,
    expectedIndex: 2,
  },

  // CAPA 6: Fuzzy matching
  {
    description: "Fuzzy match: 'Clinica Flores' → Sede Flores",
    message: "Clinica Flores",
    options: SEDE_OPTIONS,
    expectedIndex: 0,
    minConfidence: "medium",
  },
  {
    description: "Fuzzy match: 'sede caballito'",
    message: "sede caballito",
    options: SEDE_OPTIONS,
    expectedIndex: 1,
  },

  // CASOS COMPLEJOS
  {
    description: "Número con prefijo habitual: 'opción 2'",
    message: "opción 2",
    options: TURN_OPTIONS,
    expectedIndex: 1,
  },
  {
    description: "Número con prefijo: 'el 1'",
    message: "el 1",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },
  {
    description: "Número con sufijo: '3.'",
    message: "3.",
    options: TURN_OPTIONS,
    expectedIndex: 2,
  },
  {
    description: "Mensaje natural: 'me gustaría el turno del lunes'",
    message: "me gustaría el turno del lunes",
    options: TURN_OPTIONS,
    expectedIndex: 0,
  },

  // CASOS DE ERROR
  {
    description: "Número fuera de rango: '10'",
    message: "10",
    options: TURN_OPTIONS,
    expectedIndex: null,
  },
  {
    description: "Texto sin número: 'Hola'",
    message: "Hola",
    options: TURN_OPTIONS,
    expectedIndex: null,
  },
]

// ============================================================================
// EJECUTOR DE PRUEBAS
// ============================================================================

export function runSelectionExtractorTests(): void {
  console.log("\n🧪 INICIANDO SUITE DE PRUEBAS - Selection Extractor\n")

  let passed = 0
  let failed = 0
  const failures: string[] = []

  for (const testCase of TEST_CASES) {
    const result = extractSelection(testCase.message, testCase.options)

    const isPass =
      result.selectedIndex === testCase.expectedIndex &&
      (testCase.minConfidence
        ? ["high", "medium", "low"].indexOf(result.confidence) >=
          ["high", "medium", "low"].indexOf(testCase.minConfidence)
        : true)

    if (isPass) {
      console.log(`✅ ${testCase.description}`)
      passed++
    } else {
      console.log(
        `❌ ${testCase.description} (esperado: ${testCase.expectedIndex}, obtuvo: ${result.selectedIndex})`
      )
      failed++
      failures.push(
        `${testCase.description} - Esperado ${testCase.expectedIndex}, obtuvo ${result.selectedIndex}`
      )
    }
  }

  console.log(`\n📊 Resultados: ${passed} pasadas, ${failed} fallidas`)

  if (failures.length > 0) {
    console.log("\n❌ Fallos:")
    failures.forEach((f) => console.log(`   - ${f}`))
  } else {
    console.log("✅ ¡Todas las pruebas pasaron!")
  }
}

// ============================================================================
// EJEMPLO DE USO EN PRODUCCIÓN
// ============================================================================

export async function exampleProductionUsage(): Promise<void> {
  console.log("\n💼 EJEMPLO DE USO EN PRODUCCIÓN\n")

  // 1. El backend toma las opciones mostradas al usuario
  const turnosDisponibles: SelectionOption[] = [
    {
      index: 0,
      label: "Lunes 15 - 14:00 - Dr. García",
      metadata: { turnoId: "T001", agendaId: "A123" },
    },
    {
      index: 1,
      label: "Martes 16 - 10:30 - Dra. López",
      metadata: { turnoId: "T002", agendaId: "A124" },
    },
  ]

  // 2. El usuario responde
  const userMessages = [
    "1",
    "segundo",
    "el de las 10:30",
    "martes",
    "con la dra lopez",
    "opción 2",
  ]

  console.log("Turnos disponibles:")
  turnosDisponibles.forEach((t) => console.log(`  ${t.index + 1}. ${t.label}`))

  console.log("\nRespuestas del usuario:")
  for (const msg of userMessages) {
    const result = extractSelection(msg, turnosDisponibles)
    if (result.selected) {
      console.log(
        `✅ "${msg}" → Turno seleccionado: ${result.selectedOption?.label} (Confianza: ${result.confidence})`
      )
    } else {
      console.log(`❌ "${msg}" → No se detectó selección`)
    }
  }
}

// Ejecuta las pruebas si se llama directamente
if (require.main === module) {
  runSelectionExtractorTests()
  console.log("\n" + "=".repeat(80))
  exampleProductionUsage()
}
