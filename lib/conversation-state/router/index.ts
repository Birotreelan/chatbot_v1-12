/**
 * Router de intención — Registry + resolveState (punto de entrada)
 *
 * Pipeline por mensaje:
 *   1. Detectar qué estado aplica (loadContext de cada contrato).
 *   2. Fast-path determinístico (números / botones).
 *   3. Clasificación LLM restringida a las acciones del estado.
 *   4. Fallback determinístico si no hay confianza suficiente.
 *   5. Ejecutar la acción → RouterEffect.
 *   6. Log estructurado (ROUTER_DECISION).
 *
 * Devuelve null si ningún estado router-izado aplica (el pipeline actual sigue igual).
 */

import { createConversationLogger } from '../logger'
import {
  ROUTER_CONFIDENCE_THRESHOLD,
  type StateContract,
  type StateContext,
  type StateContextBase,
  type RouterDecision,
} from './contract'
import { classifyIntent } from './classify'
import { clinicaPostCancelOffer, clinicaPostConfirmFollowup } from './states/clinica-offer'

/** Registro de estados router-izados. Crece a medida que migramos. */
const REGISTRY: StateContract[] = [clinicaPostCancelOffer, clinicaPostConfirmFollowup]

export async function resolveState(
  message: string,
  base: StateContextBase,
): Promise<RouterDecision | null> {
  const logger = createConversationLogger(base.phone, base.configId, 'router')

  // 1. ¿Qué estado aplica?
  let contract: StateContract | null = null
  let ctx: StateContext | null = null
  for (const candidate of REGISTRY) {
    const loaded = await candidate.loadContext(base)
    if (loaded) {
      contract = candidate
      ctx = loaded
      break
    }
  }
  if (!contract || !ctx) return null

  const allowedIds = new Set(contract.allowedActions.map((a) => a.id))

  // 2. Fast-path determinístico
  let actionId: string | null = contract.fastPath?.(message, ctx) ?? null
  let confidence = actionId ? 1 : 0
  let source: RouterDecision['source'] = actionId ? 'fast_path' : 'llm'
  let slots: Record<string, any> = {}

  // 3. Clasificación LLM (si no hubo fast-path)
  if (!actionId) {
    const result = await classifyIntent(contract, message, ctx)
    if (result.actionId && allowedIds.has(result.actionId) && result.confidence >= ROUTER_CONFIDENCE_THRESHOLD) {
      actionId = result.actionId
      confidence = result.confidence
      slots = result.slots
      source = 'llm'
    } else {
      // 4. Fallback determinístico
      actionId = contract.fallbackActionId
      confidence = result.confidence
      source = 'fallback'
    }
  }

  // 5. Ejecutar
  const effect = await contract.execute(actionId, slots, ctx)

  // 6. Log estructurado
  const decision: RouterDecision = { stateId: contract.id, actionId, slots, confidence, source, effect }
  console.log(
    'ROUTER_DECISION ' +
      JSON.stringify({
        tag: 'ROUTER_DECISION',
        stateId: contract.id,
        message: message.slice(0, 200),
        actionId,
        confidence,
        source,
        effect: effect.type,
        phone: base.phone,
        configId: base.configId,
      }),
  )
  logger.info('[Router] Decisión', { stateId: contract.id, actionId, source, confidence, effect: effect.type })

  return decision
}

export type { RouterDecision } from './contract'
