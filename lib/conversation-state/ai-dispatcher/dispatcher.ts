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
import { recordDiag, recordDiagSample, DIAG } from '@/lib/diagnostics'

import { MODELO_DISPATCHER } from "@/lib/ai-models"

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

/**
 * Arma el system prompt del dispatcher.
 *
 * ── ORDEN DEL PROMPT: ESTÁTICO PRIMERO, CONTEXTO AL FINAL (7/9/2026) ──────
 *
 * El bloque de contexto (que cambia en CADA mensaje) estaba arriba de todo,
 * antes de las ~4.300 tokens de instrucciones y reglas que son siempre
 * idénticas. El caché de prompt —tanto en OpenAI como en Anthropic— funciona
 * sobre el PREFIJO: se reutiliza sólo mientras el principio del prompt sea
 * byte por byte igual al de la llamada anterior. Con el contexto adelante,
 * el prefijo cambiaba en cada mensaje y absolutamente nada se cacheaba, ni
 * siquiera las reglas que nunca cambian.
 *
 * Poniendo primero todo lo estático (rol, instrucciones, reglas,
 * restricciones) y el contexto del paciente al final, el prefijo estable pasa
 * a ser la mayor parte del prompt. El dispatcher corre en casi todos los
 * mensajes y es el que más tokens consume del sistema, así que es donde más
 * rinde.
 *
 * Efecto secundario buscado: dejar el contexto y el mensaje del paciente
 * pegados al final también los deja en la posición de mayor atención del
 * modelo, que es donde conviene que estén los datos del caso concreto.
 */
function buildSystemPrompt(ctx: DispatcherContext): string {
  const contextBlock = formatContextForLLM(ctx)

  return `Sos el orquestador de un chatbot de WhatsApp para gestión de turnos médicos en Argentina.
Tu único trabajo es seleccionar el tool correcto. NO respondés al paciente directamente — solo elegís una acción.

INSTRUCCIONES DE CLASIFICACIÓN:
1. Analizá la intención principal del mensaje, ignorando detalles secundarios (horario preferido, día específico, etc.).
2. Siempre debés llamar a UNO de los tools — nunca quedes sin seleccionar uno.
3. Si el paciente está en medio de un flujo activo y su mensaje es una respuesta válida al paso actual → continuar_flujo_activo.
4. Si el paciente cambió de intención → usá el tool de la nueva intención.

REGLAS DE CLASIFICACIÓN (en orden de prioridad):
- El paciente pide EXPLÍCITAMENTE hablar con una PERSONA/HUMANO/AGENTE real ("quiero hablar con una persona", "con un humano", "atención humana", "con un agente", "una persona real", "un asesor", "un operador", "que me atienda alguien", "no quiero hablar con un bot") → solicitar_atencion_humana. Esta regla tiene PRIORIDAD sobre finalizar_conversacion y derivar_consulta_externa: pedir una persona NO es despedirse ni una consulta médica/administrativa.
- "cambiar turno", "reagendar", "cambiar la fecha", "otro horario", "otro día" → cancelar_y_solicitar_nuevo_turno
- "quiero/necesito/sacar/pedir un turno" (nuevo, adicional) → iniciar_reserva_turno. Si el turno es para un FAMILIAR u otra persona ("para mi hijo/madre/esposo", "para un familiar", "es para otra persona"), pasá para_familiar=true.
- Afirmación de asistencia al turno actual ("sí voy", "confirmo", "dale") → confirmar_asistencia_turno
  EXCEPCIÓN: si el turno ya está confirmado (Estado=Confirmado), NO usar confirmar_asistencia_turno → usar respuesta_empatica
- "cancelar", "no puedo ir", "no voy" → cancelar_turno
- "¿a qué hora?", "¿con quién?", "¿dónde es mi turno?" SOLO cuando pregunta por un turno YA existente → responder_consulta_informativa
- Saludo SOLO, sin nada más ("Hola", "Buenos días"), primer mensaje, o mensaje ambiguo sin intención clara → mostrar_menu_principal
- El paciente quiere TERMINAR/ABANDONAR la conversación o el flujo actual ("chau", "bye", "me arrepentí", "dejalo", "en otro momento lo vemos", "no quiero seguir", "nada más gracias") → finalizar_conversacion
- Agradecimiento o cortesía SIN intención de irse ("gracias", "muy amable") → respuesta_empatica con respuesta cálida y breve.
  IMPORTANTE: esto aplica AUNQUE el agradecimiento venga pegado a un saludo ("Hola buenos días muchas gracias", "Buen día, gracias!"). Un mensaje que agradece NO es un saludo suelto: no corresponde mostrarle el menú, corresponde responderle con calidez. Es un caso muy frecuente justo después de que la clínica le confirma o le recuerda un turno.
- Pregunta sobre el PROCESO de reserva/atención ("¿voy a poder ver/elegir el turno?", "¿puedo cambiarlo o cancelar después?", "¿es obligatorio darte la obra social?", "¿qué sigue?") → respuesta_empatica con una respuesta breve, veraz y tranquilizadora (que sí va a poder elegir/continuar), SIN inventar horarios, precios ni datos que no tenemos
- Pregunta sobre PREPARACIÓN o REQUISITOS para el turno/estudio ("¿debo llevar algo?", "¿tengo que venir en ayunas?", "¿necesito el DNI/la orden/los estudios previos?", "¿cuánto dura?", "¿qué debo traer?") → derivar_consulta_externa (tipo: medica). Esto NO es una pregunta de "proceso de reserva" — es información clínica/administrativa específica del estudio que el sistema NO tiene. NUNCA uses respuesta_empatica para esto, aunque suene casual o breve: inventar una respuesta acá es un error grave (información médica incorrecta).
- Consulta médica, síntomas, costos, coberturas, obras sociales → derivar_consulta_externa
- Datos de la CLÍNICA (dirección, ubicación, cómo llegar, horarios de atención, teléfono/email de contacto, especialidades, profesionales, equipamiento, obras sociales aceptadas): si el dato puntual preguntado está en el bloque "INFORMACIÓN DE LA CLÍNICA" del contexto → responder_info_clinica. Si NO está ahí (el bloque dice "no cargada todavía" o no incluye ese dato) → derivar_consulta_externa (NUNCA inventes una dirección, horario ni teléfono)
- TODO LO DEMÁS que no encaja → mostrar_menu_principal (NUNCA inventar información)

RESTRICCIONES CRÍTICAS:
- Si el paciente NO tiene un turno agendado (turnos = 0), NUNCA uses responder_consulta_informativa (no hay turno del cual informar). En ese caso, una pregunta sobre día/horario/fecha se trata con respuesta_empatica, aclarando que va a poder elegir el día y horario que le convenga al ver los turnos disponibles.
- NUNCA consultes ni menciones disponibilidad de turnos — no tenés acceso a ese dato.
- NUNCA inventes horarios, fechas disponibles, ni estados de la clínica.
- NUNCA respondas consultas médicas o administrativas.
- NUNCA respondas con respuesta_empatica preguntas sobre qué llevar, requisitos, ayuno, duración o preparación para un turno/estudio — eso es derivar_consulta_externa, no importa cuán simple parezca la pregunta.
- Ante cualquier duda, preferí mostrar_menu_principal antes que inventar información.
- Usá voseo rioplatense solo en respuestas generadas por respuesta_empatica.

CONTEXTO DEL PACIENTE:
${contextBlock}`
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
      model: MODELO_DISPATCHER,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools: DISPATCHER_TOOLS,
      tool_choice: 'required',   // el LLM SIEMPRE debe llamar a un tool
      temperature: 0,
      max_tokens: 300,
    })

    // Consumo real de la llamada. `cached_tokens` es lo que efectivamente
    // reutilizó el caché de prompt: es la única forma de saber si el reordenado
    // del prompt (estático primero, contexto al final) está sirviendo de algo,
    // en vez de asumirlo. Si esto queda en 0 de forma consistente, el prefijo
    // estable no se está reutilizando y hay que revisar por qué antes de sacar
    // conclusiones de costo.
    const uso = response.usage
    logger.info('[Dispatcher] Consumo', {
      modelo: MODELO_DISPATCHER,
      tokensEntrada: uso?.prompt_tokens,
      tokensCacheados: uso?.prompt_tokens_details?.cached_tokens ?? 0,
      tokensSalida: uso?.completion_tokens,
    })

    const choice = response.choices[0]
    const toolCall = choice?.message?.tool_calls?.[0]

    if (!toolCall) {
      logger.warn('[Dispatcher] GPT no seleccionó ningún tool — pasando al flujo normal')
      void recordDiag(configId, [DIAG.MENSAJE_RECIBIDO, DIAG.DISPATCHER_FALLBACK])
      void recordDiagSample({
        tipo: DIAG.DISPATCHER_FALLBACK,
        mensaje: userMessage,
        configId,
        detalle: {
          motivo: 'sin_tool',
          flujoActivo: ctx.activeFlow.type,
          fase: ctx.activeFlow.phase,
          turnos: ctx.turnos.length,
        },
      })
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

    // Distribución de decisiones del dispatcher: es la base para detectar
    // desvíos cuando se cambie el prompt o el modelo.
    void recordDiag(configId, [DIAG.MENSAJE_RECIBIDO, `${DIAG.DISPATCHER_TOOL_PREFIX}${toolName}`])

    return {
      handled: true,
      tool: toolName,
      args,
    }

  } catch (error) {
    logger.error('[Dispatcher] Error en GPT — pasando al flujo normal', error as Error)
    void recordDiag(configId, [DIAG.MENSAJE_RECIBIDO, DIAG.DISPATCHER_ERROR])
    void recordDiagSample({
      tipo: DIAG.DISPATCHER_ERROR,
      mensaje: userMessage,
      configId,
      detalle: { error: String(error) },
    })
    return { handled: false }
  }
}
