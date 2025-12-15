import type { WhatsAppConfig, AdditionalAssistant } from "./types"

/**
 * Obtiene el Assistant ID correspondiente a un nombre de función
 * @param config - Configuración de WhatsApp que contiene los asistentes
 * @param functionName - Nombre de la función llamada (ej: "route_to_reagendamiento")
 * @returns El Assistant ID correspondiente o null si no se encuentra
 */
export function getAssistantIdByFunction(config: WhatsAppConfig, functionName: string): string | null {
  console.log(`[AssistantUtils] 🔍 Buscando asistente para función: "${functionName}"`)
  console.log(`[AssistantUtils] 🔍 Config recibido:`, {
    displayName: config.displayName,
    hasAdditionalAssistants: !!config.additionalAssistants,
    additionalAssistantsType: typeof config.additionalAssistants,
    additionalAssistantsLength: config.additionalAssistants?.length,
    additionalAssistants: config.additionalAssistants,
  })

  if (!config.additionalAssistants || config.additionalAssistants.length === 0) {
    console.log(`[AssistantUtils] ⚠️ No hay asistentes adicionales configurados`)
    console.log(`[AssistantUtils] ⚠️ additionalAssistants value:`, config.additionalAssistants)
    return null
  }

  console.log(`[AssistantUtils] 📋 Asistentes adicionales disponibles:`)
  config.additionalAssistants.forEach((a, idx) => {
    console.log(`[AssistantUtils]   ${idx + 1}. functionName: "${a.functionName}", assistantId: "${a.assistantId}"`)
  })

  const assistant = config.additionalAssistants.find((a) => a.functionName === functionName)

  if (assistant) {
    console.log(`[AssistantUtils] ✅ Encontrado asistente para función "${functionName}": ${assistant.assistantId}`)
    return assistant.assistantId
  }

  console.log(`[AssistantUtils] ❌ No se encontró asistente para función "${functionName}"`)
  console.log(
    `[AssistantUtils] ❌ Nombres de función disponibles:`,
    config.additionalAssistants.map((a) => a.functionName),
  )
  return null
}

/**
 * Lista todos los asistentes adicionales configurados
 * @param config - Configuración de WhatsApp
 * @returns Array de asistentes adicionales
 */
export function listAdditionalAssistants(config: WhatsAppConfig): AdditionalAssistant[] {
  return config.additionalAssistants || []
}

/**
 * Valida que un Assistant ID tenga el formato correcto
 * @param assistantId - ID del asistente a validar
 * @returns true si el formato es válido
 */
export function validateAssistantId(assistantId: string): boolean {
  // Los Assistant IDs de OpenAI tienen el formato: asst_XXXXXXXXXXXXXXXXXXXX
  const assistantIdRegex = /^asst_[a-zA-Z0-9]{24}$/
  return assistantIdRegex.test(assistantId)
}

/**
 * Valida que un nombre de función tenga un formato válido
 * @param functionName - Nombre de la función a validar
 * @returns true si el formato es válido
 */
export function validateFunctionName(functionName: string): boolean {
  // Los nombres de función deben ser snake_case y no vacíos
  const functionNameRegex = /^[a-z][a-z0-9_]*$/
  return functionNameRegex.test(functionName) && functionName.length > 0
}
