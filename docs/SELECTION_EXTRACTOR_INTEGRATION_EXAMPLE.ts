/**
 * EJEMPLO DE INTEGRACIÓN: Selection Extractor en whatsapp.tsx
 * 
 * Este archivo muestra exactamente dónde y cómo integrar el extractor
 * en los flujos existentes de selección.
 */

// ============================================================================
// 1. IMPORTACIONES (agregado a whatsapp.tsx)
// ============================================================================

import { 
  extractSelection, 
  createOptionsFromLabels,
  getEffectiveFeatureFlags 
} from '@/lib/conversation-state'

// ============================================================================
// 2. SELECCIÓN DE OBRA SOCIAL (Booking Flow)
// ============================================================================

/**
 * Cuando OpenAI retorna una lista de obras sociales:
 * "Aquí están las obras sociales disponibles:
 *  1. OSDE
 *  2. Swiss Medical
 *  3. Medicus"
 * 
 * El usuario responde: "la segunda" o "Swiss Medical" o "2"
 */
async function handleObraSocialSelection(
  userMessage: string,
  socialWorks: Array<{ id: string; name: string }>,
  configId: string
) {
  const flags = await getEffectiveFeatureFlags(configId)
  
  // Si el flag está habilitado, intentar extraer directamente
  if (flags.directSelectionExtraction && socialWorks.length > 0) {
    // Convertir a SelectionOption[] para el extractor
    const options = createOptionsFromLabels(socialWorks.map(sw => sw.name))
    
    const result = extractSelection(userMessage, options)
    
    if (result.selected && result.selectedIndex !== undefined) {
      const selectedWork = socialWorks[result.selectedIndex]
      
      console.log("[DIRECT-FLOW] Obra social seleccionada:", {
        userInput: userMessage,
        selectedWork: selectedWork.name,
        method: result.method, // "number" | "text" | "fuzzy" | etc
        confidence: result.confidence, // 0-1
      })
      
      // Retornar la obra social seleccionada para continuar el flujo
      return {
        success: true,
        selectedWork,
        cleanedMessage: String(result.selectedIndex + 1), // Pasar número a OpenAI
      }
    }
  }
  
  // Si no se detectó o flag deshabilitado, pasar a OpenAI normalmente
  return { success: false }
}

// ============================================================================
// 3. SELECCIÓN DE SEDE (Booking Flow)
// ============================================================================

/**
 * Cuando hay múltiples sedes disponibles:
 * "Elige una sede:
 *  1. Sede Centro - Av. 9 de Julio
 *  2. Sede Norte - Flores
 *  3. Sede Sur - Barracas"
 */
async function handleSedeSelection(
  userMessage: string,
  sedes: Array<{ id: string; name: string; location: string }>,
  configId: string
) {
  const flags = await getEffectiveFeatureFlags(configId)
  
  if (flags.directSelectionExtraction && sedes.length > 0) {
    // Crear etiquetas más descriptivas: "Centro - Av. 9 de Julio", etc
    const labels = sedes.map(s => `${s.name} - ${s.location}`)
    const options = createOptionsFromLabels(labels)
    
    const result = extractSelection(userMessage, options)
    
    if (result.selected && result.selectedIndex !== undefined) {
      const selectedSede = sedes[result.selectedIndex]
      
      console.log("[DIRECT-FLOW] Sede seleccionada:", {
        userInput: userMessage,
        selectedSede: selectedSede.name,
        method: result.method,
      })
      
      return {
        success: true,
        selectedSede,
        cleanedMessage: String(result.selectedIndex + 1),
      }
    }
  }
  
  return { success: false }
}

// ============================================================================
// 4. SELECCIÓN DE TURNO (Turn Selection Handler)
// ============================================================================

/**
 * Cuando hay múltiples turnos disponibles:
 * "Turnos disponibles:
 *  1. Lunes 10:00 AM
 *  2. Lunes 14:00 PM
 *  3. Martes 09:00 AM
 *  4. Martes 15:30 PM"
 * 
 * Usuario puede responder de muchas formas:
 * - "2" → número directo
 * - "lunes a las 2" → coincidencia de hora
 * - "martes" → búsqueda parcial
 * - "la tercera" → ordinal
 * - "el próximo martes" → posicional + texto
 */
async function handleTurnSelection(
  userMessage: string,
  turns: Array<{ id: string; dateTime: string }>,
  configId: string
) {
  const flags = await getEffectiveFeatureFlags(configId)
  
  if (flags.directSelectionExtraction && turns.length > 0) {
    // Los turnos tienen timestamps, convertir a labels legibles
    const labels = turns.map(t => t.dateTime) // "Lunes 10:00 AM", etc
    const options = createOptionsFromLabels(labels)
    
    const result = extractSelection(userMessage, options)
    
    if (result.selected && result.selectedIndex !== undefined) {
      const selectedTurn = turns[result.selectedIndex]
      
      console.log("[DIRECT-FLOW] Turno seleccionado:", {
        userInput: userMessage,
        selectedTurn: selectedTurn.dateTime,
        method: result.method,
        confidence: result.confidence,
      })
      
      return {
        success: true,
        selectedTurn,
        cleanedMessage: String(result.selectedIndex + 1),
      }
    }
  }
  
  return { success: false }
}

// ============================================================================
// 5. INTEGRACIÓN EN handleMessage() - Flujo Completo
// ============================================================================

/**
 * Ubicación en whatsapp.tsx - handleMessage() function
 * 
 * El flujo sería:
 * 1. Recibir mensaje del usuario
 * 2. Obtener estado de conversación (qué está esperando el bot)
 * 3. Si está esperando selección → intentar extractSelection()
 * 4. Si se detecta → responder directamente sin OpenAI
 * 5. Si no se detecta → pasar a OpenAI normalmente
 */

async function handleMessageWithSelectionExtraction(
  userMessage: string,
  conversationState: any,
  configId: string
) {
  const flags = await getEffectiveFeatureFlags(configId)
  
  // Determinar si estamos esperando una selección
  if (conversationState.phase === "awaiting_obra_social_selection") {
    const result = await handleObraSocialSelection(
      userMessage,
      conversationState.availableSocialWorks,
      configId
    )
    if (result.success) {
      // Guardar selección y continuar
      conversationState.selectedWork = result.selectedWork
      // Si queremos saltarnos OpenAI completamente:
      // return buildDirectResponse(...)
      // O pasamos el número limpio a OpenAI:
      userMessage = result.cleanedMessage
    }
  }
  
  if (conversationState.phase === "awaiting_sede_selection") {
    const result = await handleSedeSelection(
      userMessage,
      conversationState.availableSedes,
      configId
    )
    if (result.success) {
      conversationState.selectedSede = result.selectedSede
      userMessage = result.cleanedMessage
    }
  }
  
  if (conversationState.phase === "awaiting_turn_selection") {
    const result = await handleTurnSelection(
      userMessage,
      conversationState.availableTurns,
      configId
    )
    if (result.success) {
      conversationState.selectedTurn = result.selectedTurn
      userMessage = result.cleanedMessage
    }
  }
  
  // Continuar al flujo normal de OpenAI con el userMessage limpio
  return await processWithOpenAI(userMessage, conversationState)
}

// ============================================================================
// 6. ESTRUCTURA DE RESPUESTA DEL EXTRACTOR
// ============================================================================

/**
 * SelectionResult retornado por extractSelection():
 * 
 * {
 *   selected: boolean,              // ¿Se detectó una selección?
 *   selectedIndex: number | null,   // Índice 0-based de la opción
 *   selectedOption: SelectionOption | null, // Opción completa
 *   method: string,                 // Qué capa detectó: "number" | "text" | "fuzzy" | etc
 *   confidence: number,             // 0-1, confianza en la detección
 *   reason: string,                 // Explicación de por qué no detectó (si applicable)
 * }
 * 
 * Ejemplo real:
 * {
 *   selected: true,
 *   selectedIndex: 1,
 *   selectedOption: { index: 1, label: "Swiss Medical" },
 *   method: "text_match",
 *   confidence: 0.95,
 * }
 */

// ============================================================================
// 7. LOGGING Y MONITOREO
// ============================================================================

/**
 * Los logs incluyen:
 * - [DIRECT-FLOW] Obra social seleccionada
 * - [DIRECT-FLOW] Sede seleccionada
 * - [DIRECT-FLOW] Turno seleccionado
 * 
 * Incluyen:
 * - userInput: lo que escribió el usuario
 * - selectedOption: qué se detectó
 * - method: qué capa lo detectó
 * - confidence: qué tan seguro está
 * 
 * Para monitorear:
 * 1. Buscar por "[DIRECT-FLOW]" en logs
 * 2. Medir success rate (selected === true)
 * 3. Analizar confidence scores
 * 4. Comparar cost: OpenAI calls antes/después
 */

export { 
  handleObraSocialSelection,
  handleSedeSelection,
  handleTurnSelection,
  handleMessageWithSelectionExtraction,
}
