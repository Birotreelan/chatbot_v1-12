/**
 * Contextual Intent Handler para flujos pendientes
 * 
 * Analiza el mensaje del usuario cuando está en medio de un flujo (ej: confirmación de cancelación)
 * y responde con texto libre en lugar de las opciones esperadas.
 * 
 * El NLU entiende AMBAS cosas:
 * 1. La intención del usuario (qué quiere hacer)
 * 2. El contexto del flujo actual (qué acción está pendiente)
 * 
 * Y genera respuestas que reconocen la intención pero guían al usuario a completar el flujo actual.
 */

import Anthropic from "@anthropic-ai/sdk"
import { createConversationLogger } from "../logger"
import type { ChatbotData, ChatbotDataTurno } from "../../appointment-flow-state"
import type { FlowState } from "../../appointment-flow-state"
import { buildContextualResponseTemplates, type PendingFlowType } from "./response-templates"

const client = new Anthropic()

// ============================================================================
// TIPOS
// ============================================================================

export type DetectedIntent = 
  | "solicitar_turno"      // Usuario quiere agendar un nuevo turno
  | "cancelar_turno"       // Usuario quiere cancelar (puede ser confirmación implícita)
  | "confirmar_turno"      // Usuario quiere confirmar asistencia
  | "reagendar"            // Usuario quiere cambiar fecha/hora
  | "consulta_info"        // Pregunta sobre horarios, ubicación, etc
  | "confirmar_accion"     // Acepta la acción pendiente (sí, dale, ok)
  | "rechazar_accion"      // Rechaza la acción pendiente (no, mejor no)
  | "saludo"               // Saludo genérico
  | "despedida"            // Despedida
  | "queja_frustracion"    // Usuario frustrado o quejándose
  | "otro"                 // No se pudo clasificar

export interface ContextualIntentResult {
  detectedIntent: DetectedIntent
  confidence: number
  reasoning: string
  
  // La acción que debe tomar el sistema
  action: 
    | "maintain_flow_with_response"  // Mantener flujo actual, enviar respuesta contextual
    | "process_as_confirmation"      // Tratar como confirmación (1)
    | "process_as_rejection"         // Tratar como rechazo (2)
    | "abandon_flow"                 // Abandonar flujo (baja confianza, error, etc)
  
  // Respuesta contextual generada (solo si action = "maintain_flow_with_response")
  contextualResponse?: string
}

interface FlowContext {
  flowType: PendingFlowType
  turno: ChatbotDataTurno | null
  turnoIndex: number
  patientName: string
  options: string[]  // ["1- Sí, cancelar", "2- No, mantener"]
}

// ============================================================================
// PROMPT NLU CONTEXTUAL
// ============================================================================

function buildSystemPrompt(): string {
  return `# Intérprete de Intención Contextual

## Rol
Eres un intérprete de lenguaje natural que analiza mensajes de usuarios en un chatbot médico.
El usuario está en MEDIO de un flujo (ej: confirmando una cancelación) pero responde con algo diferente a las opciones dadas.

Tu tarea es:
1. Identificar la INTENCIÓN REAL del usuario
2. Determinar si es una confirmación/rechazo implícito o un cambio de intención
3. Responder SOLO con JSON válido

## Intenciones posibles

### Relacionadas al flujo actual:
- **confirmar_accion**: Usuario acepta la acción pendiente (ej: "sí", "dale", "ok", "hacelo", "confirmo")
- **rechazar_accion**: Usuario rechaza la acción pendiente (ej: "no", "mejor no", "dejalo", "no quiero")

### Cambio de intención:
- **solicitar_turno**: Usuario quiere agendar un NUEVO turno
- **cancelar_turno**: Usuario menciona cancelar (puede ser confirmación implícita si el flujo es de cancelación)
- **confirmar_turno**: Usuario quiere confirmar asistencia a un turno
- **reagendar**: Usuario quiere cambiar fecha/hora de un turno existente
- **consulta_info**: Pregunta sobre horarios, ubicación, profesionales, etc

### Genéricas:
- **saludo**: Saludo genérico ("hola", "buenos días")
- **despedida**: Despedida ("gracias", "chau", "hasta luego")
- **queja_frustracion**: Usuario frustrado, quejándose del servicio
- **otro**: No se puede clasificar con confianza

## Reglas de clasificación

1. Si el mensaje contiene una solicitud de turno nuevo ("quiero turno", "necesito turno", "agendar", "reservar"), es **solicitar_turno**
2. Si el mensaje es afirmativo corto ("sí", "dale", "ok", "bueno", "1"), es **confirmar_accion**
3. Si el mensaje es negativo corto ("no", "mejor no", "2", "dejalo"), es **rechazar_accion**
4. Si menciona explícitamente cancelar Y el flujo actual es de cancelación, considerar **confirmar_accion**
5. Si pregunta algo sin decidir, es **consulta_info** o **otro**

## Formato de respuesta (JSON puro)
{
  "intent": "solicitar_turno",
  "confidence": 0.85,
  "reasoning": "El usuario dice 'solicito un turno nuevo', indicando que quiere agendar otro turno"
}

Responde SOLO JSON, sin markdown, sin explicaciones adicionales.`
}

function buildUserPrompt(userMessage: string, context: FlowContext): string {
  const flowDescriptions: Record<PendingFlowType, string> = {
    awaiting_cancel_confirmation: "CONFIRMACIÓN DE CANCELACIÓN - esperando que confirme (1) o rechace (2) cancelar su turno",
    awaiting_reschedule_choice: "OPCIÓN DE REAGENDAMIENTO - esperando que elija (1) reagendar o (2) no reagendar",
  }
  
  let prompt = `## Contexto del flujo actual
- Flujo: ${flowDescriptions[context.flowType]}
- Paciente: ${context.patientName}`

  if (context.turno) {
    prompt += `
- Turno pendiente: ${context.turno.fecha} a las ${context.turno.hora} con ${context.turno.profesional} en ${context.turno.sede}`
  }

  prompt += `
- Opciones mostradas: ${context.options.join(" / ")}

## Mensaje del usuario
"${userMessage}"

Analiza la intención del usuario considerando el contexto del flujo.`

  return prompt
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Analiza un mensaje de texto libre cuando el usuario está en un flujo pendiente
 * y genera una respuesta contextual que reconoce la intención pero mantiene el flujo.
 */
export async function handleContextualIntent(
  userMessage: string,
  flowState: FlowState,
  chatbotData: ChatbotData,
  phoneNumber: string,
  configId: string
): Promise<ContextualIntentResult> {
  const logger = createConversationLogger(phoneNumber, configId, "contextual_nlu")
  
  try {
    logger.info("Analizando intención contextual", {
      userMessage: userMessage.substring(0, 50),
      flowType: flowState.type,
    })

    // Construir contexto del flujo
    const turnoIndex = flowState.turnoIndex || 0
    const turno = chatbotData.turnos?.[turnoIndex] || null
    const flowType = flowState.type as PendingFlowType
    
    const context: FlowContext = {
      flowType,
      turno,
      turnoIndex,
      patientName: formatPatientName(chatbotData),
      options: getFlowOptions(flowType),
    }

    // Llamar a Claude para extraer intención
    const intentResult = await extractIntentWithClaude(userMessage, context, logger)
    
    if (!intentResult) {
      logger.warn("No se pudo extraer intención, abandonando flujo")
      return {
        detectedIntent: "otro",
        confidence: 0,
        reasoning: "Error al procesar con NLU",
        action: "abandon_flow",
      }
    }

    logger.info("Intención extraída", {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
    })

    // Determinar acción basada en la intención
    const result = determineAction(intentResult, context, chatbotData)
    
    logger.info("Acción determinada", {
      action: result.action,
      hasResponse: !!result.contextualResponse,
    })

    return result

  } catch (error) {
    logger.error("Error en handleContextualIntent", error as Error)
    return {
      detectedIntent: "otro",
      confidence: 0,
      reasoning: "Error interno",
      action: "abandon_flow",
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function extractIntentWithClaude(
  userMessage: string,
  context: FlowContext,
  logger: ReturnType<typeof createConversationLogger>
): Promise<{ intent: DetectedIntent; confidence: number; reasoning: string } | null> {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(userMessage, context),
        },
      ],
    })

    const responseText = response.content[0].type === "text" ? response.content[0].text : ""
    
    logger.debug("Respuesta de Claude", {
      response: responseText.substring(0, 100),
    })

    // Parsear JSON - intentar limpiar si viene con markdown
    let cleanJson = responseText.trim()
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/```json?\n?/g, "").replace(/```/g, "").trim()
    }

    const parsed = JSON.parse(cleanJson)
    
    return {
      intent: parsed.intent as DetectedIntent,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    }
  } catch (error) {
    logger.error("Error llamando a Claude", error as Error)
    return null
  }
}

function determineAction(
  intentResult: { intent: DetectedIntent; confidence: number; reasoning: string },
  context: FlowContext,
  chatbotData: ChatbotData
): ContextualIntentResult {
  const { intent, confidence, reasoning } = intentResult
  
  // Si es confirmación/rechazo explícito con alta confianza, procesarlo
  if (intent === "confirmar_accion" && confidence >= 0.7) {
    return {
      detectedIntent: intent,
      confidence,
      reasoning,
      action: "process_as_confirmation",
    }
  }
  
  if (intent === "rechazar_accion" && confidence >= 0.7) {
    return {
      detectedIntent: intent,
      confidence,
      reasoning,
      action: "process_as_rejection",
    }
  }
  
  // Si es cancelar_turno y estamos en flujo de cancelación, tratar como confirmación
  if (intent === "cancelar_turno" && context.flowType === "awaiting_cancel_confirmation" && confidence >= 0.6) {
    return {
      detectedIntent: intent,
      confidence,
      reasoning: "Usuario menciona cancelar mientras está en flujo de cancelación",
      action: "process_as_confirmation",
    }
  }
  
  // Si es despedida, abandonar flujo
  if (intent === "despedida" && confidence >= 0.7) {
    return {
      detectedIntent: intent,
      confidence,
      reasoning,
      action: "abandon_flow",
    }
  }
  
  // Para cambios de intención (solicitar turno, reagendar, etc), mantener flujo con respuesta contextual
  if (["solicitar_turno", "reagendar", "confirmar_turno", "consulta_info", "saludo", "queja_frustracion"].includes(intent)) {
    const templates = buildContextualResponseTemplates(context.flowType)
    const contextualResponse = templates.buildResponse(
      intent,
      chatbotData,
      context.turnoIndex
    )
    
    return {
      detectedIntent: intent,
      confidence,
      reasoning,
      action: "maintain_flow_with_response",
      contextualResponse,
    }
  }
  
  // Confianza muy baja o intención no clasificable: abandonar flujo
  if (confidence < 0.5 || intent === "otro") {
    return {
      detectedIntent: intent,
      confidence,
      reasoning,
      action: "abandon_flow",
    }
  }
  
  // Default: mantener flujo con respuesta genérica
  const templates = buildContextualResponseTemplates(context.flowType)
  return {
    detectedIntent: intent,
    confidence,
    reasoning,
    action: "maintain_flow_with_response",
    contextualResponse: templates.buildResponse("otro", chatbotData, context.turnoIndex),
  }
}

function getFlowOptions(flowType: PendingFlowType): string[] {
  const options: Record<PendingFlowType, string[]> = {
    awaiting_cancel_confirmation: ["1- Sí, cancelar el turno", "2- No, mantener el turno"],
    awaiting_reschedule_choice: ["1- Reagendar el turno", "2- No quiero reagendar"],
  }
  return options[flowType] || []
}

function formatPatientName(chatbotData: ChatbotData): string {
  const nombres = chatbotData.paciente?.nombres || ""
  const primerNombre = nombres.split(" ")[0]
  return primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase()
}
