/**
 * AI Dispatcher — Función principal (Sprint 60)
 *
 * GPT-4o-mini con function calling.
 * Recibe el contexto completo del paciente + el mensaje del usuario,
 * y selecciona el tool (acción) correcto del manifest.
 *
 * Garantías de producción:
 * - Timeout implícito vía max_tokens y temperatura 0
 * - Si GPT falla o no selecciona tool → retorna { handled: false }
 * - Nunca bloquea el flujo normal
 */

import { openai } from '@/lib/openai'
import { createConversationLogger } from '../logger'
import { DISPATCHER_TOOLS, TOOL_NAMES, type ToolName } from './tool-manifest'
import { type DispatcherContext, formatContextForLLM } from './context-builder'

// ============================================================================
// TIPOS
// ============================================================================

export interface DispatcherDecision {
  handled: true
  tool: ToolName
  args: Record<string, any>
  reasoning?: string  // solo para logs
}

export interface DispatcherPassthrough {
  handled: false
}

export type DispatcherResult = DispatcherDecision | DispatcherPassthrough

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(ctx: DispatcherContext): string {
  const contextBlock = formatContextForLLM(ctx)

  return `Sos el orquestador de un chatbot de WhatsApp para gestión de turnos médicos en Argentina.
Tu único trabajo es seleccionar el tool correcto. NO respondés al paciente directamente — solo elegís una acción.

CONTEXTO DEL PACIENTE:
${contextBlock}

INSTRUCCIONES DE CLASIFICACIÓN:
1. Analizá la intención principal del mensaje, ignorando detalles secundarios (horario preferido, día específico, etc.).
2. Siempre debés llamar a UNO de los tools — nunca quedes sin seleccionar uno.
3. Si el paciente está en medio de un flujo activo y su mensaje es una respuesta válida al paso actual → continuar_flujo_activo.
4. Si el paciente cambió de intención → usá el tool de la nueva intención.

REGLAS DE CLASIFICACIÓN (en orden de prioridad):
- "cambiar turno", "reagendar", "cambiar la fecha", "otro horario", "otro día" → cancelar_y_solicitar_nuevo_turno
- "quiero/necesito/sacar/pedir un turno" (nuevo, adicional) → iniciar_reserva_turno
- Afirmación de asistencia al turno actual ("sí voy", "confirmo", "dale") → confirmar_asistencia_turno
  EXCEPCIÓN: si el turno ya está confirmado (Estado=Confirmado), NO usar confirmar_asistencia_turno → usar respuesta_empatica
- "cancelar", "no puedo ir", "no voy" → cancelar_turno
- "¿a qué hora?", "¿con quién?", "¿dónde?" sobre el turno → responder_consulta_informativa
- Saludo, primer mensaje, mensaje ambiguo sin intención clara → mostrar_menu_principal
- Despedida, agradecimiento ("gracias", "chau") → respuesta_empatica con respuesta cálida y breve
- Consulta médica, síntomas, costos, coberturas → derivar_consulta_externa
- TODO LO DEMÁS que no encaja → mostrar_menu_principal (NUNCA inventar información)

RESTRICCIONES CRÍTICAS:
- NUNCA consultes ni menciones disponibilidad de turnos — no tenés acceso a ese dato.
- NUNCA inventes horarios, fechas disponibles, ni estados de la clínica.
- NUNCA respondas consultas médicas o administrativas.
- Ante cualquier duda, preferí mostrar_menu_principal antes que inventar información.
- Usá voseo rioplatense solo en respuestas generadas por respuesta_empatica.`
}

// ============================================================================
// DISPATCHER PRINCIPAL
// ============================================================================

/**
 * Ejecuta el AI dispatcher.
 *
 * @returns DispatcherDecision si el LLM seleccionó un tool con éxito.
 *          DispatcherPassthrough si falló o no hubo decisión (el mensaje cae al flujo normal).
 */
export async function runAIDispatcher(
  phoneNumber: string,
  configId: string,
  userMessage: string,
  ctx: DispatcherContext,
): Promise<DispatcherResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'ai-dispatcher')

  try {
    logger.info('[Dispatcher] Iniciando clasificación', {
      messagePreview: userMessage.substring(0, 60),
      hasActiveFlow: ctx.hasActiveFlow,
      activeFlowType: ctx.activeFlow.type,
      turnosCount: ctx.turnos.length,
    })

    const systemPrompt = buildSystemPrompt(ctx)

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools: DISPATCHER_TOOLS,
      tool_choice: 'required',   // el LLM SIEMPRE debe llamar a un tool
      temperature: 0,
      max_tokens: 300,
    })

    const choice = response.choices[0]
    const toolCall = choice?.message?.tool_calls?.[0]

    if (!toolCall) {
      logger.warn('[Dispatcher] GPT no seleccionó ningún tool — pasando al flujo normal')
      return { handled: false }
    }

    const toolName = toolCall.function.name as ToolName
    let args: Record<string, any> = {}

    try {
      args = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      logger.warn('[Dispatcher] Error parseando args del tool', { raw: toolCall.function.arguments })
    }

    logger.info('[Dispatcher] Tool seleccionado', {
      tool: toolName,
      args,
      finishReason: choice.finish_reason,
    })

    return {
      handled: true,
      tool: toolName,
      args,
    }

  } catch (error) {
    logger.error('[Dispatcher] Error en GPT — pasando al flujo normal', error as Error)
    return { handled: false }
  }
}
