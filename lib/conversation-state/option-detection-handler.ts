/**
 * Sprint 32: Detección de Opciones de Menú usando Selection Extractor
 * 
 * Reutiliza el SelectionExtractor para detectar cuando el usuario selecciona
 * una opción del menú escribiendo:
 * - Número directo: "2", "3"
 * - Ordinal: "segundo", "tercero"
 * - Texto parcial: "cancelar", "reagendar", "familiar"
 * - Fuzzy matching: "canselr" → "cancelar"
 * 
 * Esto funciona para CUALQUIER contexto que tenga opciones (paciente, turnos, etc)
 */

import { extractSelection, createOptionsFromLabels, SelectionOption, SelectionResult } from "./selection-extractor"
import { createConversationLogger } from "./logger"

// ============================================================================
// TIPOS
// ============================================================================

export interface MenuOption {
  index: number
  label: string
  action: string
  details?: string
}

export interface OptionDetectionResult {
  detected: boolean
  selectedOption?: MenuOption
  confidence: "high" | "medium" | "low"
  matchType?: string
  reason?: string
}

// ============================================================================
// MAPEADOR DE OPCIONES DE MENÚ A ACCIONES
// ============================================================================

/**
 * Mapea las opciones de menú actuales a sus acciones correspondientes
 * Este objeto se actualiza según el contexto de la conversación
 */
const MENU_ACTION_MAP: Record<string, string> = {
  // Paciente existente - Sin turnos
  "solicitar turno": "book_appointment",
  "turnos confirmados": "show_confirmed_appointments",
  "solicitar turno para un familiar": "book_family_appointment",
  
  // Paciente existente - Con 1 turno
  "confirmar turno": "confirm_appointment",
  "cambiar/reagendar": "reschedule_appointment",
  "cancelar turno": "cancel_appointment",
  
  // Paciente existente - Con múltiples turnos
  "ver mis turnos": "show_appointments",
  "reagendar": "reschedule_appointment",
  "cancelar": "cancel_appointment",
  
  // Paciente nuevo
  "crear perfil": "create_profile",
  "agendar": "book_appointment",
  
  // Confirmación de cancelación
  "si, cancelar el turno": "confirm_cancellation",
  "no, mantener el turno": "cancel_cancellation",
  
  // Búsqueda de turnos
  "buscar por turno": "search_by_appointment_type",
  "buscar por sede": "search_by_location",
  "buscar disponibilidad": "search_availability",
}

// ============================================================================
// FUNCIONES DE DETECCIÓN
// ============================================================================

/**
 * Detecta si el usuario seleccionó una opción del menú
 * 
 * @param message Mensaje del usuario
 * @param menuOptions Opciones disponibles en el contexto actual
 * @param userPhone Para logging
 * @param configId Para logging
 * @returns Resultado de detección con opción seleccionada y acción
 */
export function detectMenuOptionSelection(
  message: string,
  menuOptions: MenuOption[],
  userPhone?: string,
  configId?: string
): OptionDetectionResult {
  const logger = userPhone && configId 
    ? createConversationLogger(userPhone, configId, "option-detection")
    : null

  if (!message || message.trim().length === 0) {
    return {
      detected: false,
      confidence: "low",
      reason: "Mensaje vacío",
    }
  }

  if (!menuOptions || menuOptions.length === 0) {
    return {
      detected: false,
      confidence: "low",
      reason: "No hay opciones de menú disponibles",
    }
  }

  // Convertir MenuOption[] a SelectionOption[] para usar el extractor
  const selectionOptions: SelectionOption[] = menuOptions.map(opt => ({
    index: opt.index,
    label: opt.label,
    details: opt.details,
    metadata: { action: opt.action },
  }))

  // Usar el SelectionExtractor existente
  const selectionResult: SelectionResult = extractSelection(message, selectionOptions)

  if (!selectionResult.selected) {
    logger?.info("No se detectó selección de opción", {
      message,
      matchType: selectionResult.matchType,
      reason: selectionResult.reason,
    })
    
    return {
      detected: false,
      confidence: "low",
      reason: selectionResult.reason,
    }
  }

  // Construir respuesta con la opción detectada
  const selectedMenuOption: MenuOption | undefined = menuOptions.find(
    opt => opt.index === selectionResult.selectedIndex
  )

  if (!selectedMenuOption) {
    return {
      detected: false,
      confidence: "low",
      reason: "Opción seleccionada no encontrada en menú",
    }
  }

  logger?.info("Opción de menú detectada", {
    message,
    selectedOption: selectedMenuOption.label,
    action: selectedMenuOption.action,
    matchType: selectionResult.matchType,
    confidence: selectionResult.confidence,
  })

  return {
    detected: true,
    selectedOption: selectedMenuOption,
    confidence: selectionResult.confidence,
    matchType: selectionResult.matchType,
    reason: selectionResult.reason,
  }
}

/**
 * Crea un array de MenuOption a partir de labels y acciones
 * Helper para construir menús fácilmente
 */
export function createMenuOptions(
  labels: string[],
  actions: string[]
): MenuOption[] {
  return labels.map((label, index) => ({
    index,
    label,
    action: actions[index] || "unknown",
  }))
}

/**
 * Obtiene la acción correspondiente a una opción de menú
 */
export function getActionForOption(optionLabel: string): string {
  const normalized = optionLabel.toLowerCase().trim()
  
  // Búsqueda exacta
  if (MENU_ACTION_MAP[normalized]) {
    return MENU_ACTION_MAP[normalized]
  }
  
  // Búsqueda parcial (si el label contiene parte del mapeo)
  for (const [key, action] of Object.entries(MENU_ACTION_MAP)) {
    if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) {
      return action
    }
  }
  
  return "unknown_option"
}

/**
 * Mapea una opción de menú detectada a su intención/acción
 */
export function mapOptionToAction(option: MenuOption): string {
  return option.action || getActionForOption(option.label)
}

// ============================================================================
// INTEGRACIÓN CON DIRECT CONFIRMATION
// ============================================================================

/**
 * Detecta selecciones en el contexto de confirmación/cancelación de turno
 * Usado como CAPA MEJORADA en el flujo de confirmación directa
 */
export function detectConfirmationOrCancellationOptionSelection(
  message: string,
  userPhone?: string,
  configId?: string
): { action?: "confirm" | "cancel"; reason?: string } {
  const doubleConfirmationOptions: MenuOption[] = [
    {
      index: 0,
      label: "Sí, cancelar el turno",
      action: "confirm_cancellation",
    },
    {
      index: 1,
      label: "No, mantener el turno",
      action: "cancel_cancellation",
    },
  ]

  const result = detectMenuOptionSelection(
    message,
    doubleConfirmationOptions,
    userPhone,
    configId
  )

  if (!result.detected || !result.selectedOption) {
    return {}
  }

  // Mapear acción a confirm/cancel
  if (
    result.selectedOption.action === "confirm_cancellation" ||
    result.selectedOption.label.toLowerCase().includes("sí")
  ) {
    return { action: "cancel", reason: `Opción detectada: "${result.selectedOption.label}"` }
  }

  if (
    result.selectedOption.action === "cancel_cancellation" ||
    result.selectedOption.label.toLowerCase().includes("no")
  ) {
    return { action: "confirm", reason: `Opción detectada: "${result.selectedOption.label}"` }
  }

  return {}
}

/**
 * Construye un menú de opciones para mostrar al usuario
 */
export function buildMenuString(options: MenuOption[]): string {
  return options
    .map((opt) => `${opt.index + 1}. ${opt.label}`)
    .join("\n")
}
