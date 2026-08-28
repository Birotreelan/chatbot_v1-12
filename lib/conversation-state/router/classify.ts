/**
 * Router de intención — Clasificador LLM
 *
 * Toma el contrato de un estado (con su conjunto CERRADO de acciones) y el mensaje
 * del paciente, y devuelve qué acción elegir + slots + confianza.
 *
 * El LLM SOLO clasifica: elige un `actionId` de la lista permitida. Nunca redacta
 * la respuesta al paciente. Si falla o excede el timeout, devuelve confianza 0
 * para que el router aplique su fallback determinístico.
 */

import { openai } from '@/lib/openai'
import { createConversationLogger } from '../logger'
import type { StateContract, StateContext } from './contract'
import { recordDiag, recordDiagSample, DIAG } from '@/lib/diagnostics'

export interface ClassifyResult {
  actionId: string | null
  slots: Record<string, any>
  confidence: number
  reasoning?: string
}

const CLASSIFY_TIMEOUT_MS = 2500

function buildSystemPrompt(contract: StateContract, ctx: StateContext): string {
  const acciones = contract.allowedActions
    .map((a) => {
      const slotsDesc = a.slots?.length
        ? `\n   Datos a extraer: ${a.slots.map((s) => `${s.name} (${s.type}${s.enum ? `: ${s.enum.join('|')}` : ''}) — ${s.description}`).join('; ')}`
        : ''
      return `- ${a.id}: ${a.description}${slotsDesc}`
    })
    .join('\n')

  // Contexto de verdad relevante (solo datos reales; nada que el modelo pueda inventar).
  const contextoData = Object.entries(ctx.data || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n')

  return `Sos el clasificador de intención de un chatbot de WhatsApp para gestión de turnos médicos en Argentina.
Tu ÚNICA tarea es leer el mensaje del paciente y elegir UNA acción de la lista de acciones permitidas.
NO redactás la respuesta al paciente. NO inventás información. Solo clasificás.

SITUACIÓN ACTUAL (lo que el bot le acaba de decir/preguntar al paciente):
${contract.askedPrompt}

${contextoData ? `DATOS REALES DISPONIBLES:\n${contextoData}\n` : ''}
ACCIONES PERMITIDAS (elegí EXACTAMENTE una por su id):
${acciones}

REGLAS:
- Elegí siempre una acción de la lista, por su id textual.
- Interpretá la INTENCIÓN del mensaje, no palabras sueltas (ej: "quiero saber por qué" es una pregunta, no una solicitud de turno).
- Si el mensaje no encaja claramente en ninguna, elegí la que mejor aproxime y bajá la confianza.
- "confianza" es un número entre 0 y 1 que refleja qué tan seguro estás.

Respondé SOLO con JSON válido (sin markdown):
{
  "accion": "<id exacto de la acción elegida>",
  "slots": { },
  "confianza": <número 0..1>,
  "motivo": "<explicación breve>"
}`
}

export async function classifyIntent(
  contract: StateContract,
  message: string,
  ctx: StateContext,
): Promise<ClassifyResult> {
  const logger = createConversationLogger(ctx.phone, ctx.configId, 'router-classify')
  const allowedIds = new Set(contract.allowedActions.map((a) => a.id))

  try {
    const systemPrompt = buildSystemPrompt(contract, ctx)

    const completionPromise = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    })

    // Timeout duro: si el modelo tarda, aplicamos fallback determinístico.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('classify_timeout')), CLASSIFY_TIMEOUT_MS),
    )

    const response = (await Promise.race([completionPromise, timeoutPromise])) as Awaited<typeof completionPromise>

    const raw = response.choices[0]?.message?.content
    if (!raw) return { actionId: null, slots: {}, confidence: 0, reasoning: 'respuesta vacía' }

    const parsed = JSON.parse(raw)
    const actionId = typeof parsed.accion === 'string' ? parsed.accion : null
    const confidence = typeof parsed.confianza === 'number' ? parsed.confianza : 0
    const slots = parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : {}

    // Validar que la acción pertenezca al conjunto cerrado del estado.
    if (!actionId || !allowedIds.has(actionId)) {
      logger.warn('[Router] Acción fuera del conjunto permitido', { actionId, allowed: [...allowedIds] })
      void recordDiag(ctx.configId, DIAG.CLASSIFY_FUERA_DE_SET)
      void recordDiagSample({
        tipo: DIAG.CLASSIFY_FUERA_DE_SET,
        mensaje: message,
        configId: ctx.configId,
        detalle: { actionId, permitidas: [...allowedIds], askedPrompt: contract.askedPrompt?.slice(0, 120) },
      })
      return { actionId: null, slots: {}, confidence: 0, reasoning: 'acción no permitida' }
    }

    // La confianza baja es la señal más útil para saber DÓNDE el bot está
    // adivinando: son los estados donde conviene repreguntar en vez de asumir.
    const bajaConfianza = confidence < 0.6
    void recordDiag(ctx.configId, bajaConfianza ? [DIAG.CLASSIFY_OK, DIAG.CLASSIFY_BAJA_CONFIANZA] : DIAG.CLASSIFY_OK)
    if (bajaConfianza) {
      void recordDiagSample({
        tipo: DIAG.CLASSIFY_BAJA_CONFIANZA,
        mensaje: message,
        configId: ctx.configId,
        detalle: { actionId, confidence, motivo: parsed.motivo, askedPrompt: contract.askedPrompt?.slice(0, 120) },
      })
    }

    return { actionId, slots, confidence, reasoning: parsed.motivo }
  } catch (error) {
    logger.warn('[Router] Error/timeout en clasificación — se usará fallback', { error: String(error) })
    const esTimeout = String(error).includes('classify_timeout')
    void recordDiag(ctx.configId, esTimeout ? DIAG.CLASSIFY_TIMEOUT : DIAG.CLASSIFY_FUERA_DE_SET)
    void recordDiagSample({
      tipo: esTimeout ? DIAG.CLASSIFY_TIMEOUT : 'classify_error',
      mensaje: message,
      configId: ctx.configId,
      detalle: { error: String(error), askedPrompt: contract.askedPrompt?.slice(0, 120) },
    })
    return { actionId: null, slots: {}, confidence: 0, reasoning: `error: ${String(error)}` }
  }
}
