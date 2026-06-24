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
Tu único trabajo es seleccionar la acción correcta llamando al tool apropiado.

CONTEXTO DEL PACIENTE:
${contextBlock}

INSTRUCCIONES:
1. Analizá el mensaje del paciente considerando el contexto anterior.
2. Seleccioná UNO de los tools disponibles — siempre debés llamar a uno.
3. Si el paciente está en medio de un flujo activo y su mensaje es una respuesta válida → usá continuar_flujo_activo.
4. Si el paciente cambió de intención → usá el tool de la nueva intención, ignorando el flujo activo.
5. Para saludos o mensajes ambiguos sin turno activo → mostrar_menu_principal.
6. Para despedidas / agradecimientos → respuesta_empatica con respuesta cálida.
7. NUNCA inventes información médica ni respondas consultas médicas — usá derivar_consulta_externa.
8. Usá voseo rioplatense en todas las respuestas generadas.`
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
