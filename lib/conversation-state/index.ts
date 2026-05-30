/**
 * Índice principal del sistema de estado de conversación
 * Exporta todas las funcionalidades de forma centralizada
 */

export * from "./types"
export * from "./logger"
export * from "./feature-flags"
export * from "./selection-extractor"
export * from "./reschedule-flow-handler"
export * from "./reschedule-templates"
export * from "./reschedule-flow-integration"
export * from "./patient-detection/patient-flow-handler"
export * from "./patient-detection/patient-templates"
export * from "./patient-detection/patient-flow-integration"
export * from "./patient-detection/intent-extractor"
export * from "./existing-patient/existing-patient-flow-handler"
export * from "./existing-patient/existing-patient-templates"
export * from "./existing-patient/existing-patient-flow-integration"
export * from "./existing-patient/existing-patient-validators"
export * from "./new-patient/new-patient-flow-handler"
export * from "./new-patient/new-patient-templates"
export * from "./new-patient/new-patient-flow-integration"
export * from "./new-patient/new-patient-validators"
export * from "./pending-flow-nlu/contextual-intent-handler"
export * from "./pending-flow-nlu/response-templates"
export { getConversationContext, setConversationContext, clearConversationContext } from "./redis"
export type { ConversationStateRedis } from "./redis"
