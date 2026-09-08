/**
 * Sprint 18: NLU Fallback Router Inteligente
 *
 * Cuando ningún handler específico (regex puro) detecta intención con alta confianza,
 * este handler NLU actúa como "fallback inteligente" para clasificar la intención real
 * del usuario y redirigirlo al flujo correcto.
 *
 * Casos de uso:
 * 1. "Si estaré ede dia" → Detectado como FECHA_QUERY (false positive) → NLU reclasifica como CONFIRMAR_ASISTENCIA
 * 2. "Buenas tardes estuve 3 dias tratando..." → Detectado como FECHA_QUERY → NLU reclasifica como QUEJA_FRUSTRACION
 * 3. "Sobre todo por si alguna persona..." → No matchea nada → NLU clasifica como EXPLICACION_CONTEXTUAL
 *
 * Orden de llamada en whatsapp.tsx:
 * Sprint 15 → Sprint 14 → Sprint 16 → Sprint 17 → Sprint 12 → Sprint 13 → ★ SPRINT 18 NLU FALLBACK ★ → Sprint 9a
 */

import { createConversationLogger } from "./logger"
import { openai } from "@/lib/openai"
import { getTurnoTemporalStatus } from "@/lib/utils/date-utils"
import { fraseDerivacion, contactoDerivacion, esContactoMultilinea } from "@/lib/utils/escalation-contact"
import { recordDiag, recordDiagSample, DIAG } from "@/lib/diagnostics"
import { getRedisClient } from "@/lib/redis"
import { isMarkedAsWrongPerson } from "./wrong-number-handler"

import { MODELO_CLASIFICACION } from "@/lib/ai-models"

const logger = createConversationLogger("nlu-fallback-handler")

// ============================================================================
// TIPOS
// ============================================================================

export type FallbackIntent =
  | "confirmar_asistencia"      // "Si estaré ese dia", "ahi voy", "la confirmo"
  | "cancelar_turno"            // "no puedo ir", "tengo que cancelar"
  | "reagendar_turno"           // "quiero cambiar el turno", "otra fecha"
  | "consulta_informativa"      // "¿donde queda?", "¿a que hora?"
  | "consulta_no_disponible"    // "¿cuánto cuesta?", "¿aceptan tarjeta?", consultas administrativas que no podemos responder
  | "consulta_medica_prohibida" // CRÍTICO: Consultas médicas que JAMÁS debemos responder (síntomas, diagnósticos, medicamentos, tratamientos)
  | "queja_frustracion"         // "estuve 3 dias llamando...", "nunca atienden"
  | "explicacion_contextual"    // "Esta con neumonia", "por motivos de salud"
  | "llego_tarde"               // "voy llegando", "ya salí", "estoy en camino"
  | "no_asisti"                 // "me olvidé", "no pude ir", "falté al turno"
  | "saludo_despedida"          // "gracias", "chau", "igualmente"
  | "numero_equivocado"         // "no soy esa persona", "se equivocaron"
  | "otro"                      // → Continuar al flujo normal

export interface FallbackIntentResult {
  intent: FallbackIntent
  confidence: number
  reasoning: string
  response?: string  // Respuesta empática generada por GPT
  action?: {
    type: "direct_confirmation" | "direct_cancellation" | "show_menu" | "continue_flow"
    data?: Record<string, any>
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Main fallback handler: cuando ningún regex matchea con alta confianza,
 * usa NLU para clasificar la intención real del usuario
 *
 * Retorna:
 * - { shouldHandle: true, ...result } → Handler debe procesar el mensaje
 * - { shouldHandle: false } → No aplica, continuar con flujo normal
 */
export async function detectNLUFallbackPreFlow(
  userPhoneNumber: string,
  userMessage: string,
  configId: string,
  appointmentContext?: any,
  conversationHistory?: string,
  escalationPhoneNumber?: string,
  alreadyConfirmed?: boolean,
  /**
   * true si hay un recordatorio reciente (ventana de 24h) pidiéndole al paciente
   * que confirme o cancele, y todavía no lo hizo. Con esta señal las reglas se
   * abstienen sobre mensajes cortos y deja decidir a la IA — ver
   * ContextoParaReglas (7/9/2026).
   */
  confirmacionPendiente?: boolean,
): Promise<{
  shouldHandle: boolean
  result?: FallbackIntentResult
  response?: string
  /**
   * Estado de flujo que el consumer (whatsapp.tsx) debe establecer tras enviar la
   * respuesta. Permite, por ejemplo, saltar el menú "Confirmar asistencia" cuando el
   * turno ya fue confirmado y enviar directamente la doble confirmación de cancelación.
   */
  flowStateDirective?:
    | { type: "awaiting_cancel_and_reschedule_confirm" }
    | { type: "awaiting_cancel_confirmation"; postCancelAction?: "book_new" | "reschedule" }
}> {
  try {
    // ¡IMPORTANTE! Solo procesar si:
    // 1. Hay appointmentContext activo (hay un turno reciente)
    // 2. El mensaje es texto libre (no un número o patrón muy simple)
    if (!appointmentContext) {
      return { shouldHandle: false }
    }

    if (userMessage.length < 5 || /^\d+$/.test(userMessage.trim())) {
      return { shouldHandle: false }
    }

    // 26/8/2026: si el usuario ya fue marcado como "persona equivocada" (ver
    // wrong-number-handler.ts), el appointmentContext sigue siendo el turno de
    // OTRA persona — Redis no lo limpia al marcarlo. No debemos (re)clasificar
    // sus mensajes siguientes contra ese turno ajeno: eso producía respuestas
    // como "Parece que te has confundido de número..." generadas por GPT sin
    // relación con lo que el usuario realmente escribió. Dejamos pasar al flujo
    // normal, que no depende de ese turno.
    const wrongPersonMarked = await isMarkedAsWrongPerson(userPhoneNumber, configId)
    if (wrongPersonMarked) {
      logger.info(`[Sprint 18] Usuario marcado como persona equivocada — no interceptar con turno ajeno`)
      return { shouldHandle: false }
    }

    // Antes de clasificar, detectar casos que NUNCA deben interceptarse aquí:
    // 1. Saludos puros ("Hola", "buenas") → mostrar menú de detección de paciente
    // 2. Solicitudes de nuevo turno ("Necesito turno", "Quiero sacarme un turno") → idem
    const msgNorm = userMessage.trim().toLowerCase()
    if (isPureGreeting(msgNorm)) {
      logger.info(`[Sprint 18] Saludo puro detectado — no interceptar, dejar al flujo de detección`, { userMessage })
      return { shouldHandle: false }
    }
    if (isNewBookingRequest(msgNorm)) {
      logger.info(`[Sprint 18] Solicitud de nuevo turno detectada — no interceptar, dejar al flujo de detección`, { userMessage })
      return { shouldHandle: false }
    }

    // El turno ya fue cancelado: el contexto persiste en Redis (con turno_cancelado)
    // pero no hay un turno ACTIVO. Si lo tratáramos como activo, intents como
    // "reagendar_turno"/"confirmar_asistencia" generarían menús con datos vacíos
    // ("fecha no disponible", "hora no disponible"). En ese caso dejamos pasar al
    // flujo normal para que inicie una nueva reserva.
    const turnosActivos =
      Array.isArray(appointmentContext?.turnos) && appointmentContext.turnos.length > 0
    const tieneFechaDirecta = !!(appointmentContext?.fecha || appointmentContext?.appointment_date)
    const fueCancelado = appointmentContext?.tipo_mensaje === "turno_cancelado"

    if (fueCancelado || (!turnosActivos && !tieneFechaDirecta)) {
      logger.info(`[Sprint 18] Sin turno activo (cancelado o turnos vacíos), no interceptar`, {
        tipoMensaje: appointmentContext?.tipo_mensaje,
        turnosActivos,
      })
      return { shouldHandle: false }
    }

    // Si el turno fue cancelado recientemente vía OpenAI (flag con TTL 30 min),
    // no mostrar el menú de cancelación con datos viejos — dejar pasar a OpenAI
    // que tiene el contexto completo de la conversación.
    try {
      const redis = getRedisClient()
      if (redis) {
        const recentlyCancelled = await redis.get(`turno_recently_cancelled:${configId}:${userPhoneNumber}`)
        if (recentlyCancelled) {
          logger.info(`[Sprint 18] Turno recientemente cancelado vía OpenAI — no interceptar, dejar al asistente`)
          return { shouldHandle: false }
        }
      }
    } catch {
      // Si falla el check de Redis, continuar normalmente
    }

    logger.info(`[Sprint 18] Clasificando mensaje con NLU fallback`, {
      userMessage,
      hasAppointmentContext: !!appointmentContext,
    })

    const classificationResult = await classifyIntent(
      userMessage,
      appointmentContext,
      // Si el turno ya fue confirmado no hay nada pendiente, por más que la
      // ventana de 24h siga abierta.
      { confirmacionPendiente: confirmacionPendiente && !alreadyConfirmed },
    )

    logger.info(`[Sprint 18] Clasificación NLU completada`, classificationResult)

    // Si confidence es baja tras ambas capas, no procesamos
    if (classificationResult.confidence < 0.6) {
      logger.info(`[Sprint 18] Confidence bajo (${classificationResult.confidence}), continuar con flujo normal`)
      return { shouldHandle: false }
    }

    // Si es "otro" tras reglas + GPT → mensaje de derivación (fuera del scope del bot)
    if (classificationResult.intent === "otro") {
      const response = buildOutOfScopeResponse(escalationPhoneNumber)
      return { shouldHandle: true, result: classificationResult, response }
    }

    // Si es confirmación → activar acción directa de confirmación
    if (classificationResult.intent === "confirmar_asistencia") {
      // Si el turno YA estaba confirmado, no repetir "confirmación recibida":
      // simplemente recordar que el turno sigue confirmado.
      const response = alreadyConfirmed
        ? buildAlreadyConfirmedResponse(appointmentContext)
        : buildConfirmationResponse(appointmentContext)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es cancelación → mostrar menú para confirmar cancelación
    if (classificationResult.intent === "cancelar_turno") {
      const response = buildMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es reagendar → mostrar menú (con turno activo, debe cancelar primero)
    if (classificationResult.intent === "reagendar_turno") {
      // Si el turno YA fue confirmado, NO ofrecer de nuevo "Confirmar asistencia".
      // Vamos directo a la doble confirmación de cancelación (1- Sí, cancelar / 2- No,
      // mantener) y, al cancelar, redirigimos al flujo de reagendamiento.
      if (alreadyConfirmed) {
        const response = buildRescheduleAfterConfirmedResponse(appointmentContext, classificationResult.response)
        return {
          shouldHandle: true,
          result: classificationResult,
          response,
          flowStateDirective: { type: "awaiting_cancel_confirmation", postCancelAction: "reschedule" },
        }
      }

      const response = buildCancelAndRescheduleMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
        flowStateDirective: { type: "awaiting_cancel_and_reschedule_confirm" },
      }
    }

    // Si es queja/frustración → solo respuesta empática, sin menú
    // Adjuntar el menú encima de una queja produce efecto de "ignorar al paciente"
    if (classificationResult.intent === "queja_frustracion") {
      const response = classificationResult.response || "Lamentamos los inconvenientes. Estamos trabajando para mejorar. Si necesitás ayuda con tu turno, escribinos cuando quieras."
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es explicación contextual → empathía + menú de opciones.
    // El paciente informa un motivo (imprevisto, personal, salud) que implica que
    // puede no asistir. Mostramos las opciones para que pueda actuar directamente.
    if (classificationResult.intent === "explicacion_contextual") {
      const response = buildCancelAndRescheduleMenuResponse(appointmentContext, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
        flowStateDirective: { type: "awaiting_cancel_and_reschedule_confirm" },
      }
    }

    // Si es consulta informativa → responder con info del turno si disponible
    if (classificationResult.intent === "consulta_informativa") {
      const response = buildInformationalQueryResponse(appointmentContext, classificationResult)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Si es consulta que no podemos responder → derivar a la clínica
    if (classificationResult.intent === "consulta_no_disponible") {
      const response = buildDerivationResponse(appointmentContext, classificationResult.response, escalationPhoneNumber)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // CRÍTICO: Consultas médicas que JAMÁS debemos responder → derivar a profesional médico
    if (classificationResult.intent === "consulta_medica_prohibida") {
      const response = buildMedicalDerivationResponse(appointmentContext, escalationPhoneNumber)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Turno pasado: "voy llegando tarde" → respuesta empática + contacto clínica
    if (classificationResult.intent === "llego_tarde") {
      const { fecha, hora } = extractTurnoData(appointmentContext)
      const turnoStatus = getTurnoTemporalStatus(fecha, hora)
      const response = buildLlegoTardeResponse(appointmentContext, turnoStatus, classificationResult.response, escalationPhoneNumber)
      return { shouldHandle: true, result: classificationResult, response }
    }

    // Turno pasado: "no asistí / me olvidé" → respuesta empática + ofrecer reagendar
    if (classificationResult.intent === "no_asisti") {
      const { fecha, hora } = extractTurnoData(appointmentContext)
      const turnoStatus = getTurnoTemporalStatus(fecha, hora)
      // Si el turno es futuro o próximo, re-clasificar como cancelación
      if (turnoStatus === 'futuro' || turnoStatus === 'proximo') {
        const response = buildMenuResponse(appointmentContext, classificationResult.response)
        return {
          shouldHandle: true,
          result: { ...classificationResult, intent: "cancelar_turno" },
          response,
        }
      }
      const response = buildNoAsistiResponse(appointmentContext, turnoStatus, classificationResult.response)
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
        flowStateDirective: { type: "awaiting_cancel_and_reschedule_confirm" },
      }
    }

    // Saludo/despedida → distinguir entre saludo de apertura y cierre de conversación.
    // Los saludos de apertura ("hola", "buenos días") deben pasar al flujo normal
    // para que el chatbot muestre el menú de bienvenida.
    // Solo los cierres/agradecimientos ("chau", "gracias", "igualmente") se responden directamente.
    if (classificationResult.intent === "saludo_despedida") {
      const normalized = userMessage.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
      const isOpeningGreeting = /^(hola|buenos?\s*(dias?|tardes?|noches?)|buenas?|buen\s*dia|hey\b|hi\b|hello\b)/.test(normalized)
      if (isOpeningGreeting) {
        logger.info("[Sprint 18] Saludo de apertura — cediendo al flujo normal (no interceptar)")
        return { shouldHandle: false }
      }
      const response = classificationResult.response || "¡Un placer! Si necesitás algo más, estoy acá para ayudarte."
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Número equivocado → cortar flujo sin iniciar detección de paciente
    if (classificationResult.intent === "numero_equivocado") {
      const response = classificationResult.response || "¡Disculpá la confusión! Si tenés alguna duda podés escribirnos nuevamente."
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
      }
    }

    // Otros casos: devolver que se debe manejar pero sin respuesta (para que continue normal)
    return { shouldHandle: false }
  } catch (error) {
    logger.error(`[Sprint 18] Error en NLU fallback:`, { error })
    return { shouldHandle: false }
  }
}

// ============================================================================
// NLU CLASSIFICATION — híbrido: reglas (gratis) → GPT-4o-mini (edge cases)
// ============================================================================

/**
 * Orquestador híbrido:
 * 1. Clasificador de reglas (instantáneo, sin costo)
 * 2. Si confianza < 0.7 → GPT-4o-mini Chat Completions como fallback inteligente
 *
 * Solo se llama a la API cuando las reglas no tienen confianza suficiente.
 * Elimina completamente los OpenAI Assistants — no requiere crear assistants.
 */
async function classifyIntent(
  userMessage: string,
  appointmentContext: any,
  contexto: ContextoParaReglas = {},
): Promise<FallbackIntentResult> {
  const rulesResult = classifyIntentWithRules(userMessage, contexto)

  if (rulesResult.confidence >= 0.7) {
    logger.info(`[Sprint 18] Clasificado por reglas: ${rulesResult.intent} (conf: ${rulesResult.confidence})`)
    return rulesResult
  }

  logger.info(`[Sprint 18] Reglas: baja confianza (${rulesResult.confidence}), escalando a GPT-4o-mini`)

  try {
    const gptResult = await classifyIntentWithGPT(userMessage, appointmentContext)
    logger.info(`[Sprint 18] GPT-4o-mini: ${gptResult.intent} (conf: ${gptResult.confidence})`)
    return gptResult
  } catch (error) {
    logger.warn(`[Sprint 18] GPT fallback falló, usando resultado de reglas`, { error })
    return rulesResult
  }
}

/**
 * Fallback inteligente: GPT-4o-mini via Chat Completions (NO Assistants).
 * Solo se llama cuando las reglas tienen confianza < 0.7.
 * Prompt compacto y temperatura 0 para clasificación determinística.
 */
async function classifyIntentWithGPT(
  userMessage: string,
  appointmentContext: any,
): Promise<FallbackIntentResult> {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)

  const systemPrompt = `Sos un clasificador de intenciones para un chatbot de turnos médicos de WhatsApp.
Clasificá el mensaje en UNA de estas categorías:

- confirmar_asistencia: el paciente confirma que va a ir al turno ("si estaré", "ahi voy", "dale", typos incluidos)
- cancelar_turno: quiere cancelar ("no puedo ir", "cancelo", "tengo que cancelar")
- reagendar_turno: quiere cambiar fecha/hora ("quiero otro horario", "cambiar la fecha")
- consulta_informativa: pregunta por datos del turno que tenemos (dirección, hora, profesional)
- consulta_no_disponible: pregunta administrativa que NO podemos responder (costo, cobertura, documentación)
- consulta_medica_prohibida: CRÍTICO — cualquier consulta médica (síntomas, medicamentos, diagnósticos, tratamientos, recetas, estudios). NUNCA responder. PRIORIDAD MÁXIMA.
- llego_tarde: paciente indica que está en camino o llega tarde ("ya salí", "voy llegando", "unos minutos más")
- no_asisti: paciente indica que ya no asistió al turno ("me olvidé", "no pude ir", "falté")
- queja_frustracion: expresa frustración o queja por el servicio
- explicacion_contextual: explica un motivo o situación personal (enfermedad, viaje, trabajo)
- saludo_despedida: saludo, despedida, agradecimiento
- numero_equivocado: no es la persona buscada
- otro: no encaja en ninguna categoría anterior

Turno activo del paciente:
- Fecha: ${fecha || 'no disponible'}
- Hora: ${hora || 'no disponible'}
- Profesional: ${profesional || 'no disponible'}
- Sede: ${sede || 'no disponible'}

Respondé SOLO con JSON:
{"intent": "...", "confidence": 0.0-1.0, "reasoning": "...", "response": "respuesta empática breve en español rioplatense (1-2 oraciones), omitir para consulta_medica_prohibida"}`

  const response = await openai.chat.completions.create({
    model: MODELO_CLASIFICACION,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Mensaje del paciente: "${userMessage}"` },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 200,
  })

  const responseText = response.choices[0]?.message?.content
  if (!responseText) throw new Error("No response from GPT-4o-mini")

  return JSON.parse(responseText) as FallbackIntentResult
}



/**
 * Normaliza texto: minúsculas + quitar tildes para matching robusto.
 * Preserva también el mensaje original para patterns de mayúsculas/contexto.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// Detectores por categoría (orden = prioridad de evaluación)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PRIORIDAD MÁXIMA: consultas médicas que JAMÁS debemos responder.
 *
 * ── Reforma del 1/9/2026 (caso Guemes, tel. 2214001402) ────────────────────
 *
 * Un paciente escribió "voy a tener que cambiar los turnos con Guemes *que
 * tengo* para mañana" y el sistema le respondió que no podemos dar información
 * médica. El culpable era el patrón `que tengo`, puesto acá para cazar
 * "¿qué tengo?" (el paciente preguntando su diagnóstico) — pero esa misma
 * secuencia aparece en cualquier frase normal: "el turno que tengo", "los
 * turnos que tengo para mañana".
 *
 * La prueba está en los logs de ese día: el mensaje siguiente decía casi lo
 * mismo SIN esa expresión, las reglas no matchearon, escaló a la IA y se
 * clasificó bien como reagendamiento. La única diferencia entre acertar y
 * fallar eran dos palabras.
 *
 * El problema de fondo no es este patrón puntual: es que una expresión
 * ambigua producía una decisión TERMINAL con confianza 0.95, y la IA nunca
 * llegaba a ver el mensaje. Una regex mira palabras sueltas; distinguir
 * "los turnos que tengo" de "¿qué tengo, doctor?" requiere leer la oración
 * entera, y eso no se cubre con listas de palabras.
 *
 * Por eso ahora hay dos niveles:
 *
 *   - INEQUÍVOCO: vocabulario que no puede significar otra cosa dentro de una
 *     conversación de turnos ("ibuprofeno", "hemograma", "vision borrosa").
 *     Sigue decidiendo por regla: es instantáneo, gratis y no se equivoca.
 *
 *   - AMBIGUO: expresiones frecuentes en el habla común ("que tengo",
 *     "puedo hacer", "me recomienda"). Ya NO deciden. Bajan la confianza para
 *     que el mensaje escale al clasificador con IA, que lee la frase completa.
 *
 * Esto NO debilita la protección: la IA también trata la consulta médica como
 * prioridad máxima en su prompt. Lo que cambia es quién decide en los casos
 * dudosos — pasa de una lista de palabras a un modelo que entiende contexto.
 */
function esConsultaMedicaInequivoca(msg: string): boolean {
  // Medicamentos, dosis, administración
  if (/\b(medicamento|medicina|pastilla|comprimido|capsula|ibuprofeno|paracetamol|aspirina|antibiotico|antibioticos|vacuna|dosis|gotas (oculares|para|del)|pomada|crema|jarabe|inyeccion|suero|prescripcion|receta medica|me den una receta|necesito receta)\b/.test(msg)) return true

  // Síntomas físicos.
  // 1/9/2026 — el corpus destapó un falso NEGATIVO: estaba "dolor" (sustantivo)
  // pero no las formas verbales, que son como la gente realmente escribe.
  // "me duele mucho el ojo desde ayer" no matcheaba nada. En una barrera de
  // seguridad, dejar pasar es el error más caro de los dos.
  if (/\b(dolor|duele|duelen|dolia|dolian|me arde|arde|ardor|picazon|pica|hinchazon|hinchado|inflamacion|inflamado|fiebre|temperatura (alta|elevada)|mareo|mareos|nausea|nauseas|vomito|diarrea|constipacion|sangrado|sangra|herida|golpe|fractura|quemadura|alergia|sarpullido|erupcion|tos|gripe|covid|infeccion|bacteria|virus|hongo|vision borrosa|veo (borroso|mal|nublado)|ojo (rojo|lastimado|hinchado)|oido|escucho mal|sordera|perdida de vision|perdida de audicion|sangre)\b/.test(msg)) return true

  // Diagnóstico y consulta clínica — sólo términos clínicos explícitos.
  // 8/9/2026 — "cirugia" salió de esta lista (caso María García, tel. 1133550488).
  // Es la misma clase de error que "que tengo" y el signo de interrogación: una
  // palabra que aparece tanto en una consulta médica ("¿la cirugía es riesgosa?")
  // como en un dato perfectamente administrativo sobre un turno ya agendado
  // ("Tengo cirugía el nueve de septiembre"). María estaba avisando que tenía una
  // cirugía el día ANTERIOR a su turno — probablemente para saber si le afectaba —
  // y recibió el bloque de "no puedo brindarte información médica". Ahora la
  // palabra sola no decide: escala a la IA, que lee la oración entera (ver
  // tieneSenalMedicaAmbigua).
  if (/\b(diagnostico|que me pasa|que le pasa|enfermedad|condicion medica|es grave|tengo que tomar|curable|cronico|agudo|benigno|maligno|cancer|tumor|quiste|tratamiento|terapia|rehabilitacion|curar|sanar|puedo tomar|debo tomar|deberia tomar|hay que tomar)\b/.test(msg)) return true

  // Estudios y resultados clínicos
  if (/\b(analisis (de sangre|clinico|de orina)|estudio medico|resultado (del analisis|del estudio)|laboratorio|radiografia|ecografia|tomografia|resonancia|biopsia|cultivo|plaqueta|hemograma|colesterol|glucosa|glucemia|hormona|examen medico|informe medico)\b/.test(msg)) return true

  // Preguntas de dosificación / uso / efectos
  if (/\b(cuantas (gotas|pastillas|veces al dia)|cuanto (tomar|tiempo tomar|tiempo usar)|cuando (tomar|empezar|terminar)|como (tomar|aplicar|usar)|para que sirve (este|ese|el)|efecto secundario|contraindicacion|interaccion (medicamentosa)?)\b/.test(msg)) return true

  // Emergencias
  if (/\b(emergencia|guardia medica|sala de guardia|ambulancia|llamen al|urgencia medica)\b/.test(msg)) return true

  return false
}

/**
 * Expresiones que PUEDEN ser una consulta médica pero también aparecen en
 * frases perfectamente normales sobre un turno. No deciden: sólo mandan el
 * mensaje a la IA para que lo lea completo.
 *
 * Cada una con el falso positivo real o plausible que la volvió sospechosa:
 *   que tengo      → "los turnos que tengo para mañana"  (caso Guemes, 1/9/2026)
 *   puedo hacer    → "¿puedo hacer el cambio de fecha?"
 *   es normal que  → "¿es normal que tarden tanto en atender?"
 *   me recomienda  → "¿qué sede me recomienda?"
 *   que hago si    → "¿qué hago si no puedo ir?"  (en realidad: cancelación)
 *   opera / calcul → palabras cortas que aparecen dentro de otras ideas
 *   cirugia        → "Tengo cirugía el nueve de septiembre" (caso María García,
 *                    8/9/2026): un turno quirúrgico agendado es un DATO, no una
 *                    consulta clínica. "¿la cirugía duele?" sí lo es, y para
 *                    distinguirlas hay que leer la oración completa.
 */
function tieneSenalMedicaAmbigua(msg: string): boolean {
  return /\b(que tengo|puedo hacer|es normal que|me recomienda|que hago (si|con|para)|opera|calcul|cirugia|cirugias)\b/.test(msg)
}

/** Consultas administrativas que no podemos responder (derivar a clínica) */
function isAdministrativeQuery(msg: string): boolean {
  return /\b(cuanto cuesta|costo|precio|arancel|honorarios|cuanto sale|pagar|pago|abono|abona|efectivo|tarjeta|mercado pago|transferencia|factura|facturacion|cobertura|cubre|obra social|prepaga|pami|ioma|osde|swiss medical|plan medico|documentacion|que traer|que llevar|que necesito traer|como llegar|estacionamiento|parking|ascensor|acceso (sin escaleras|para discapacitados))\b/.test(msg)
}

/** Número equivocado */
function isWrongNumber(msg: string): boolean {
  return /\b(se equivocaron|numero equivocado|no soy (esa persona|esa|el|ella|quien buscan)|no tengo turno|no es mi numero|no conozco (a esa|a ese)|creo que se equivocaron|equivocacion|numero incorrecto|no es para mi)\b/.test(msg)
}

/** Confirmación de asistencia al turno */
function isConfirmation(msg: string): boolean {
  // Frase completa de confirmación
  const strong = /\b(confirmo|confirmado|confirmar( mi)? (asistencia|turno)|si (estare|voy|asistire|ire)|ahi estare|ahi voy|voy a ir|asistiré|asistire|estare ahi|alla estare|la confirmo|mi asistencia esta confirmada|cuento con el turno)\b/
  if (strong.test(msg)) return true

  // Afirmación corta sin negación — acepta typos comunes
  const simple = /^(si|ok|dale|listo|claro|bueno|de acuerdo|por supuesto|obvio|correcto|exacto|afirmo|acepto|entendido|genial|perfecto|sip|sep|va|va bien|ahi estaré)[\s!.]*$/
  if (simple.test(msg)) return true

  // Afirmación con refuerzo
  const contextual = /\b(si (claro|por supuesto|dale|listo|confirmo|asisto|voy)|claro que (si|voy)|por supuesto que (si|voy)|confirmo que (si|voy|asisto|estare))\b/
  if (contextual.test(msg)) return true

  return false
}

/** Cancelación del turno */
function isCancellation(msg: string): boolean {
  // Bug encontrado 18/8/2026 (caso tel. 1164160904): "Por favor cancele mi turno"
  // (imperativo formal "usted") no matcheaba ninguna variante — solo estaban
  // cubiertas "cancelo"/"cancelar". El mensaje traía además "estoy muy mal del
  // estomago", que sí matcheaba isComplaint() (regla #8, evaluada DESPUÉS de
  // cancelación #5 pero alcanzada porque esta regla no matcheaba primero), así
  // que el pedido de cancelación real terminaba respondido como si fuera una
  // queja genérica, sin buscar el turno ni ofrecer cancelarlo. Se agregan las
  // conjugaciones de imperativo más comunes en español rioplatense (formal
  // "cancele", informal "cancela"/"cancelame"/"cancelalo").
  // 1/9/2026: "no voy" se acotó a "no voy a (ir|poder|asistir)". Suelto matcheaba
  // también "no voy a cancelar" — es decir, la frase que significa exactamente lo
  // contrario terminaba clasificada como cancelación.
  return /\b(cancelo|cancela|cancele|cancelame|cancelalo|cancelar( el turno)?|tengo que cancelar|quiero cancelar|no puedo (ir|asistir|concurrir)|no (ire|asistire)|no voy a (ir|poder|asistir)|no podre ir|no podré ir|baja el turno|bajar el turno|dar de baja el turno)\b/.test(msg)
}

/**
 * Reagendamiento.
 *
 * 1/9/2026 — hueco encontrado revisando el caso Guemes: el patrón sólo aceptaba
 * "cambiar la fecha/turno/horario". La forma más natural de decirlo en
 * castellano — "cambiar *el* turno", "cambiar *mis* turnos" — no matcheaba, así
 * que la frase más común de todas caía a la IA en vez de resolverse por regla.
 * Acá ampliar SÍ es seguro: son determinantes, no cambian el significado.
 */
/**
 * ¿El mensaje NIEGA la cancelación en vez de pedirla?
 *
 * "no voy a cancelar, quiero confirmar" contiene la palabra "cancelar", así que
 * isCancellation la reconoce — y terminaba clasificando como cancelación justo
 * la frase que significa lo contrario. Es el límite estructural de una regex:
 * ve la palabra, no la negación que la gobierna.
 *
 * Se busca un "no" seguido de hasta tres palabras y después la raíz "cancel".
 * La coma corta el patrón a propósito: en "no puedo ir, cancelame el turno" la
 * negación pertenece a otra oración y la cancelación sí es real.
 */
function tieneNegacionDeCancelacion(msg: string): boolean {
  return /\bno\s+(\w+\s+){0,3}cancel/.test(msg)
}

function isReschedule(msg: string): boolean {
  // 1/9/2026 — el corpus destapó DOS fallas acá, las dos por la misma causa:
  // el `\b` de cierre del grupo exige límite de palabra justo después del
  // patrón, y eso rompía los casos más naturales.
  //
  //   `reagend`      → nunca matcheó NADA. Estaba pensado como prefijo, pero
  //                    después de "reagend" viene "a" en "reagendar", que es
  //                    carácter de palabra: no hay límite, no hay match. La
  //                    palabra más explícita de esta intención no funcionaba.
  //   `cambiar los`  → no cubría el enclítico "cambiarLOS", que es como se
  //                    escribe de verdad ("tendría que cambiarlos"). Era el
  //                    segundo mensaje del caso Guemes.
  // Ojo: los enclíticos van listados uno por uno y NO como "cambiar(lo|los)?".
  // Con el grupo opcional, un "cambiar" pelado matchearía cualquier cosa
  // ("cambiar de obra social") y volveríamos a tener una regla decidiendo de más.
  return /\b(reagend[a-z]*|cambiarlo|cambiarla|cambiarlos|cambiarlas|cambiar (el |la |los |las |mi |mis )?(fecha|fechas|turno|turnos|horario|horarios)|otra fecha|otro horario|distinto horario|moverlo|moverlos|mover (el |mi )?turno|postergarlo|postergarlos|postergar( el turno)?|adelantar( el turno)?|cambio de (fecha|horario)|diferente fecha|nuevo horario|otro dia para|otro momento para)\b/.test(msg)
}

/** Consulta informativa sobre datos del turno (dirección, hora, profesional) */
function isInformationalQuery(msg: string): boolean {
  return /\b(donde (queda|es|esta) (la sede|el consultorio|el lugar)?|a que hora (es|tengo)|con quien (es|tengo)|cual es la (direccion|sede|lugar)|como llego (a la sede|al consultorio)?|la direccion( exacta)?|la hora (del turno|es)?|fecha (del turno|exacta)?|quien es (el|la) (medico|profesional|doctor)|en que (sede|consultorio|lugar))\b/.test(msg)
}

/**
 * Queja o frustración.
 *
 * 1/9/2026 — se sacaron dos patrones por la misma razón que `que tengo` en las
 * consultas médicas (ver esConsultaMedicaInequivoca):
 *   "muy mal"    → "ese horario me viene muy mal" es un REAGENDAMIENTO, no una queja.
 *   "paciencia"  → "gracias por la paciencia" es lo contrario de una queja.
 * Sin ellos, esos mensajes bajan de confianza y los clasifica la IA leyendo la
 * frase entera.
 */
function isComplaint(msg: string): boolean {
  return /\b(estuve (llamando|intentando|tratando)|nunca (atienden|funcionan|me atendieron|me respondieron)|siempre igual|imposible (comunicarse|contactarlos|hablar)|nadie (atiende|responde|contesta)|dias (llamando|esperando|tratando)|horas (esperando|llamando)|pesimo|nefasto|terrible|horrible|un desastre|no funciona(n)?|mal servicio|no es posible que|increible que)\b/.test(msg)
}

/** Explicación contextual — el paciente informa un motivo */
function isContextualExplanation(msg: string): boolean {
  return /\b(esta (enferm|internado|internada|convalec)|estuv(e|o) (enferm|internado|internada)|me (opero|opere|lastim|cai|accidente)|se (mudo|fallecio|murio|accidento|lastimo)|fallecio|por (motivos de salud|salud|enfermedad|problemas de salud|trabajo|viaje|mudanza)|viaje (de trabajo|imprevisto|urgente)|surgio algo|se complico|no me dan (el dia|permiso)|me cancelaron (el vuelo|el trabajo)|situacion (familiar|personal|laboral|medica))\b/.test(msg)
}

/**
 * Saludo PURO ("Hola", "buenas tardes") — sin contenido adicional.
 * Estos mensajes deben ir al flujo de detección de paciente para mostrar el menú,
 * NO ser capturados por el NLU fallback con una respuesta de despedida.
 */
function isPureGreeting(msg: string): boolean {
  return /^(hola|buenas?|buenos?\s*d[ií]as?|buenas?\s*tardes?|buenas?\s*noches?|saludos|hi|hey)[.!\s]*$/.test(msg)
}

/**
 * Solicitud de nuevo turno — el paciente quiere agendar, no gestionar el turno existente.
 * Deben pasar al flujo de detección de paciente, no recibir el mensaje de "fuera de scope".
 */
function isNewBookingRequest(msg: string): boolean {
  return /\b(necesito (un |sacar |pedir |solicitar )?turno|quiero (un |sacar |pedir |solicitar )?turno|sacar( un)? turno|pedir( un)? turno|solicitar( un)? turno|agenda(r)?( un)?( nuevo)? turno|reservar( un)?( nuevo)? turno|turno (para|con|de)\b|nuevo turno|otro turno|gestionar (un )?turno|turno m[eé]dico)\b/.test(msg)
}

/** Llego tarde / estoy en camino */
function isLlegoTarde(msg: string): boolean {
  return /\b(voy (llegando|en camino|tarde|para alla|yendo|saliendo)|ya (sali|salgo|voy|estoy llegando|me fui)|estoy (llegando|en camino|yendo|saliendo)|unos (minutos?|momentos?) (mas|de retraso)|me (retrase|tarde|demoré|demoro)|llegaré? (en|dentro de)? (unos|pocos) (minutos?|momentos?)|ya llego|llego enseguida|llego en)\b/.test(msg)
}

/** No asistí / me olvidé del turno (evento ya ocurrido) */
function isNoAsisti(msg: string): boolean {
  return /\b(me (olvide|olvidé|olvido) (del? )?turno?|no (pude|fui|asisti|asistí|llegue|llegué|concurri) (al turno)?|falte|falté (al turno)?|no (me) (presente|presento)|no asisti|no fui al turno|no llegue al turno|se me paso|se me olvidó?|no pude ir|no puedo haber ido)\b/.test(msg)
}

/** Saludo o despedida */
function isSalutationOrFarewell(msg: string): boolean {
  // Solo despedidas y agradecimientos — los saludos puros se manejan antes con isPureGreeting
  const bye = /\b(gracias|muchas gracias|chau|chao|adios|hasta luego|bye|hasta pronto|nos vemos|fue todo|era todo|nada mas|eso era todo|igualmente|de nada|un placer)\b/
  return bye.test(msg)
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificador principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clasifica la intención del usuario de forma determinística.
 * Sin llamadas externas — resultado instantáneo y predecible.
 */
/**
 * Contexto mínimo que necesitan las reglas para saber cuándo NO deben decidir.
 *
 * 7/9/2026 — Hasta acá esta función sólo recibía el texto del mensaje, y esa era
 * su limitación de fondo: hay mensajes cuyo significado depende enteramente de
 * qué se le preguntó al paciente. "Si mucha gracias" es una despedida si nadie
 * le preguntó nada, y es una confirmación si acaba de recibir un recordatorio
 * pidiéndole que confirme. Sin esta señal, la regla de despedida decidía con
 * 0.8 y la IA nunca llegaba a ver el mensaje (caso Vicente, tel. 1139200357).
 */
export interface ContextoParaReglas {
  /** true si hay un recordatorio reciente esperando que confirme o cancele. */
  confirmacionPendiente?: boolean
}

export function classifyIntentWithRules(
  userMessage: string,
  contexto: ContextoParaReglas = {},
): FallbackIntentResult {
  const msg = normalizeText(userMessage)

  // Con una confirmación pendiente, un mensaje corto de cortesía o afirmación
  // NO puede resolverse mirando palabras: "gracias" puede ser el cierre de un
  // "sí, gracias". Se cede a la IA, que sí ve la pregunta y el contexto.
  //
  // Se acota a mensajes CORTOS a propósito: un texto largo que menciona un
  // agradecimiento suele traer además una intención propia, y para esos las
  // reglas siguen sirviendo.
  if (contexto.confirmacionPendiente && userMessage.trim().split(/\s+/).length <= 6) {
    void recordDiag(undefined, DIAG.REGLA_AMBIGUA_ESCALADA_A_IA)
    void recordDiagSample({
      tipo: DIAG.REGLA_AMBIGUA_ESCALADA_A_IA,
      mensaje: userMessage,
      detalle: { detector: "confirmacion_pendiente" },
    })
    return {
      intent: "otro",
      confidence: 0.3,
      reasoning: "Hay una confirmación pendiente y el mensaje es corto — la decide la IA",
    }
  }

  // 1. PRIORIDAD MÁXIMA: consulta médica prohibida.
  //    Sólo el vocabulario inequívoco decide acá (ver esConsultaMedicaInequivoca).
  if (esConsultaMedicaInequivoca(msg)) {
    return {
      intent: "consulta_medica_prohibida",
      confidence: 0.95,
      reasoning: "Consulta médica detectada — derivar a profesional de salud",
    }
  }


  // 2. Número equivocado
  if (isWrongNumber(msg)) {
    return {
      intent: "numero_equivocado",
      confidence: 0.85,
      reasoning: "Usuario indica que el número es incorrecto",
      response: "¡Disculpá la confusión! Debe ser un error.",
    }
  }

  // 3. Consulta administrativa (costos, pagos, cobertura, etc.)
  if (isAdministrativeQuery(msg)) {
    return {
      intent: "consulta_no_disponible",
      confidence: 0.8,
      reasoning: "Consulta administrativa que no podemos responder",
      response: "Esa información no la tengo disponible en este momento.",
    }
  }

  // 4a. "Llego tarde / ya voy" — verificado antes de confirmación para evitar falsos positivos
  if (isLlegoTarde(msg)) {
    return {
      intent: "llego_tarde",
      confidence: 0.85,
      reasoning: "Paciente indica que está en camino o llega tarde",
      response: "Entendemos que estás en camino.",
    }
  }

  // 4b. "No asistí / me olvidé" — verificado antes de cancelación (distinto semántica)
  if (isNoAsisti(msg)) {
    return {
      intent: "no_asisti",
      confidence: 0.85,
      reasoning: "Paciente indica que no asistió o no pudo ir al turno",
      response: "Entendemos que no pudiste asistir.",
    }
  }

  // 4. Confirmación de asistencia
  if (isConfirmation(msg)) {
    return {
      intent: "confirmar_asistencia",
      confidence: 0.85,
      reasoning: "Señales de confirmación de asistencia detectadas",
    }
  }

  // 5. Cancelación del turno.
  //    Si la palabra "cancelar" viene NEGADA ("no voy a cancelar", "no quiero
  //    cancelar"), la regla no puede resolverlo: mira palabras, no la negación
  //    que las gobierna. Se cede a la IA (1/9/2026, detectado por el corpus).
  if (isCancellation(msg)) {
    if (tieneNegacionDeCancelacion(msg)) {
      void recordDiag(undefined, DIAG.REGLA_AMBIGUA_ESCALADA_A_IA)
      void recordDiagSample({
        tipo: DIAG.REGLA_AMBIGUA_ESCALADA_A_IA,
        mensaje: userMessage,
        detalle: { detector: "cancelacion_negada" },
      })
      return {
        intent: "otro",
        confidence: 0.3,
        reasoning: "Menciona cancelar pero negado — la decide la IA",
      }
    }
    return {
      intent: "cancelar_turno",
      confidence: 0.85,
      reasoning: "Señales de cancelación detectadas",
      response: "Entendemos que necesitás cancelar el turno.",
    }
  }

  // 6. Reagendamiento
  if (isReschedule(msg)) {
    return {
      intent: "reagendar_turno",
      confidence: 0.85,
      reasoning: "Señales de reagendamiento detectadas",
      response: "Entendemos que necesitás cambiar la fecha del turno.",
    }
  }

  // 7. Consulta informativa sobre el turno (dirección, hora, etc.)
  if (isInformationalQuery(msg)) {
    return {
      intent: "consulta_informativa",
      confidence: 0.8,
      reasoning: "Consulta sobre datos del turno detectada",
    }
  }

  // 8. Queja / frustración
  if (isComplaint(msg)) {
    return {
      intent: "queja_frustracion",
      confidence: 0.75,
      reasoning: "Señales de queja o frustración detectadas",
      response: "Lamentamos los inconvenientes que hayas tenido. Estamos para ayudarte.",
    }
  }

  // 9. Explicación contextual (motivo, situación personal)
  if (isContextualExplanation(msg)) {
    return {
      intent: "explicacion_contextual",
      confidence: 0.7,
      reasoning: "El paciente explica una situación o motivo",
      response: "Gracias por avisarnos. Esperamos que todo se resuelva pronto.",
    }
  }

  // 10. Saludo o despedida
  if (isSalutationOrFarewell(msg)) {
    return {
      intent: "saludo_despedida",
      confidence: 0.8,
      reasoning: "Saludo o despedida detectado",
      response: "¡Un placer! Si necesitás algo más, estoy acá para ayudarte.",
    }
  }

  // Señal médica ambigua, evaluada AL FINAL a propósito.
  //
  // Al principio esta comprobación estaba arriba de todo, junto a la consulta
  // médica inequívoca — y era un error: cortocircuitaba mensajes que las reglas
  // de abajo resuelven perfectamente. "voy a tener que cambiar los turnos con
  // Guemes que tengo para mañana" contiene "que tengo", pero también contiene
  // "cambiar los turnos", que isReschedule reconoce sin ninguna duda. Poniéndola
  // acá, ese mensaje se resuelve por regla (gratis, instantáneo) y sólo escalan
  // a la IA los que de verdad quedaron sin clasificar.
  if (tieneSenalMedicaAmbigua(msg)) {
    void recordDiag(undefined, DIAG.REGLA_AMBIGUA_ESCALADA_A_IA)
    void recordDiagSample({
      tipo: DIAG.REGLA_AMBIGUA_ESCALADA_A_IA,
      mensaje: userMessage,
      detalle: { detector: "consulta_medica" },
    })
    return {
      intent: "otro",
      confidence: 0.3,
      reasoning: "Señal médica ambigua y ninguna otra regla aplicó — la decide la IA",
    }
  }

  // Sin clasificación clara
  return {
    intent: "otro",
    confidence: 0.3,
    reasoning: "No se pudo clasificar el mensaje con claridad",
  }
}

// ============================================================================
// RESPONSE BUILDERS
// ============================================================================

/**
 * Helper para extraer datos del turno del ChatbotData
 * La estructura real es: { paciente, turnos: [{ fecha, hora, profesional, sede }] }
 * IMPORTANTE: Usamos siempre fecha/hora RAW (formato ISO) en lugar de fecha_formateada/hora_formateada
 * porque la API externa puede formatear incorrectamente (confundiendo mes/día)
 */
function extractTurnoData(appointmentContext: any): {
  fecha: string
  hora: string
  profesional: string
  sede: string
} {
  // Si tiene array de turnos (estructura ChatbotData), usar el primero
  if (appointmentContext?.turnos && Array.isArray(appointmentContext.turnos) && appointmentContext.turnos.length > 0) {
    const turno = appointmentContext.turnos[0]
    return {
      // SIEMPRE usar fecha raw (YYYY-MM-DD) - formatDate() lo convertirá correctamente
      fecha: turno.fecha || turno.fecha_formateada || '',
      // Para hora, preferir formato raw si existe, sino usar formateada
      hora: turno.hora || turno.hora_formateada || '',
      profesional: turno.profesional || '',
      sede: turno.sede || ''
    }
  }
  
  // Fallback a propiedades directas (por compatibilidad)
  return {
    fecha: appointmentContext?.fecha || appointmentContext?.appointment_date || '',
    hora: appointmentContext?.hora || appointmentContext?.appointment_time || '',
    profesional: appointmentContext?.profesional || appointmentContext?.professional_name || '',
    sede: appointmentContext?.sede || appointmentContext?.sede_name || ''
  }
}

/**
 * Menú estándar de opciones para cancelación (confirmar cancelación)
 */
const MENU_OPCIONES = `¿En qué te podemos ayudar?

1- Confirmar asistencia al turno médico
2- Cancelar el turno médico
3- Solicitar otro turno médico

Respondé con el número de opción que prefieras.`

/**
 * Menú de 2 opciones para cuando el paciente quiere reagendar con turno activo.
 * La opción 2 incluye explícitamente que primero se cancela y luego se agenda el nuevo.
 * Esto evita que el paciente tenga dos turnos activos simultáneamente.
 */
const MENU_REAGENDAR_CON_TURNO_ACTIVO = `¿Qué preferís hacer?

1- Confirmar asistencia al turno médico
2- Cancelar el turno médico y solicitar uno nuevo

Respondé con el número de opción que prefieras.`

/**
 * Respuesta para confirmación directa (sin menú)
 */
function buildConfirmationResponse(appointmentContext: any): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  return `Perfecto, tu confirmación de asistencia fue recibida. Te esperamos el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en la sede ${sede || 'indicada'}.

Si necesitás algo más, no dudes en escribirme.`
}

/**
 * Respuesta empática (de GPT) + menú estándar
 * Usada para: queja_frustracion, explicacion_contextual, cancelar_turno, reagendar_turno
 */
function buildMenuResponse(appointmentContext: any, gptResponse?: string): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  // Usar respuesta de GPT si existe, sino usar fallback
  const empaticResponse = gptResponse || "Entendemos tu situación."

  return `${empaticResponse}

Veo que tenés un turno programado para el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

${MENU_OPCIONES}`
}

/**
 * Respuesta cuando el turno YA fue confirmado y el paciente pregunta para confirmar otra vez.
 * No repetimos "tu confirmación fue recibida"; recordamos que el turno sigue confirmado.
 */
function buildAlreadyConfirmedResponse(appointmentContext: any): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  return `Tu turno ya se encuentra confirmado. Te esperamos el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en la sede ${sede || 'indicada'}.

Si necesitás algo más, no dudes en escribirme.`
}

/**
 * Respuesta cuando el turno YA fue confirmado y el paciente quiere reagendar / obtener otro turno.
 * Como ya confirmó, NO ofrecemos "Confirmar asistencia": vamos directo a pedir la doble
 * confirmación de cancelación (1- Sí, cancelar / 2- No, mantener). Al confirmar, el flujo
 * de 'awaiting_cancel_confirmation' (postCancelAction='reschedule') redirige al reagendamiento.
 */
function buildRescheduleAfterConfirmedResponse(appointmentContext: any, gptResponse?: string): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  const empaticResponse = gptResponse || "Entiendo que querés gestionar un nuevo turno."

  return `${empaticResponse}

Tu turno del *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'} ya está confirmado. Para darte uno nuevo, primero necesito cancelar el actual.

¿Confirmás la cancelación del turno?

1- Sí, cancelar el turno
2- No, mantener el turno y confirmar asistencia.`
}

/**
 * Respuesta empática (de GPT) + menú de 2 opciones para reagendar con turno activo.
 * El turno activo no puede omitirse: primero se cancela, luego se agenda el nuevo.
 */
function buildCancelAndRescheduleMenuResponse(appointmentContext: any, gptResponse?: string): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  const empaticResponse = gptResponse || "Entendemos que necesitás cambiar la fecha del turno."

  return `${empaticResponse}

Veo que tenés un turno programado para el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

${MENU_REAGENDAR_CON_TURNO_ACTIVO}`
}

/**
 * Respuesta para consultas que no podemos responder → derivar a la clínica
 * Usada para: consulta_no_disponible (costos, pagos, cobertura, etc.)
 */
function buildDerivationResponse(appointmentContext: any, gptResponse?: string, escalationPhoneNumber?: string): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  const empaticResponse = gptResponse || "Esa información no la tengo disponible en este momento."
  const derivacionMsg = escalationPhoneNumber
    ? fraseDerivacion('Para esa consulta te recomiendo comunicarte directamente con la clínica', escalationPhoneNumber)
    : `Para esa consulta te recomiendo comunicarte directamente con la clínica.`

  // No mencionar el turno si ya pasó — no es relevante para la consulta
  const turnoStatus = getTurnoTemporalStatus(fecha, hora)
  const turnoEsPasado = turnoStatus === 'pasado' || turnoStatus === 'pasado_hoy'

  if (turnoEsPasado) {
    return `${empaticResponse}\n\n${derivacionMsg}`
  }

  return `${empaticResponse}

${derivacionMsg}

Tu turno sigue confirmado para el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

Si necesitás algo más respecto al turno, no dudes en escribirme.`
}

/**
 * 🚨 CRÍTICO: Respuesta para consultas médicas que JAMÁS debemos responder
 * NO usa respuesta de GPT - respuesta fija para evitar cualquier riesgo
 */
function buildMedicalDerivationResponse(appointmentContext: any, escalationPhoneNumber?: string): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'

  const derivacionMsg = escalationPhoneNumber
    ? (esContactoMultilinea(escalationPhoneNumber)
        ? `Para consultas médicas, consultalo con tu médico en tu próxima visita o comunicate directamente con la clínica:\n\n${contactoDerivacion(escalationPhoneNumber)}`
        : `Para consultas médicas, por favor comunicate directamente con la clínica al *${escalationPhoneNumber}* o consultalo con tu médico en tu próxima visita.`)
    : `Para consultas médicas, por favor consultalo directamente con tu médico en tu próxima visita o comunicate con la clínica.`

  // No mencionar el turno si ya pasó — no es relevante para la consulta médica
  const turnoStatus = getTurnoTemporalStatus(fecha, hora)
  const turnoEsPasado = turnoStatus === 'pasado' || turnoStatus === 'pasado_hoy'

  if (turnoEsPasado) {
    return `No podemos brindar información médica, ya que ese tipo de consultas deben ser respondidas por un profesional de la salud.\n\n${derivacionMsg}`
  }

  return `No puedo brindarte información médica, ya que ese tipo de consultas deben ser respondidas por un profesional de la salud.

${derivacionMsg}

Tu turno sigue confirmado para el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

Si necesitás ayuda con tu turno (confirmar, cancelar o reagendar), con gusto te ayudo.`
}

/**
 * Respuesta cuando el paciente indica que está llegando tarde o en camino.
 */
function buildLlegoTardeResponse(
  appointmentContext: any,
  turnoStatus: import("@/lib/utils/date-utils").TurnoTemporalStatus,
  gptResponse?: string,
  escalationPhoneNumber?: string
): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'la fecha indicada'

  // 7/9/2026 (caso Jose Ibarra, tel. 1158352441): acá se usaba el texto libre
  // que generaba GPT ("Entiendo, gracias por avisar. Te esperamos a las
  // 12:50.") y el bot se lo repetía al paciente tal cual, rematado con
  // "¡Te esperamos!". Eso es prometer en nombre de la clínica algo que el
  // sistema no puede saber: si el profesional puede atender con esa demora
  // depende de la agenda real (otros pacientes, horario de cierre, etc.), no
  // de nuestros datos. Se deja de usar gptResponse para esta parte — el
  // mensaje ahora es neutral (avisamos que tomamos nota, no confirmamos ni
  // descartamos el horario nuevo) y siempre remite a la clínica, que es quien
  // puede decidirlo.
  const gracias = "Gracias por avisar."

  // Si el turno ya pasó hace rato, es posible que no puedan atenderlo
  if (turnoStatus === 'pasado_hoy' || turnoStatus === 'pasado') {
    const contactMsg = escalationPhoneNumber
      ? (esContactoMultilinea(escalationPhoneNumber)
          ? `Te recomendamos llamar a la clínica para consultar si aún pueden atenderte o coordinar un nuevo turno:\n\n${contactoDerivacion(escalationPhoneNumber)}`
          : `Te recomendamos llamar a la clínica al *${escalationPhoneNumber}* para consultar si aún pueden atenderte o coordinar un nuevo turno.`)
      : `Te recomendamos comunicarte con la clínica para consultar si aún pueden atenderte.`
    return `${gracias}\n\nEl turno era el ${fechaFormateada} a las ${hora || 'hora indicada'} con ${profesional || 'el profesional'} en ${sede || 'la sede'}.\n\n${contactMsg}`
  }

  // Turno todavía no pasó (futuro, próximo o en curso): no podemos confirmar
  // si la demora que menciona es aceptable — eso lo define la clínica.
  const contactMsg = escalationPhoneNumber
    ? fraseDerivacion('Avisale directamente a la clínica para que te confirmen si pueden esperarte', escalationPhoneNumber)
    : `Avisale directamente a la clínica para que te confirmen si pueden esperarte.`

  return `${gracias} No te puedo confirmar desde acá si van a poder esperarte con esa demora.\n\nTu turno sigue agendado para el ${fechaFormateada} a las *${hora || 'hora indicada'}* con ${profesional || 'el profesional'} en ${sede || 'la sede'}.\n\n${contactMsg}`
}

/**
 * Respuesta cuando el paciente indica que no asistió o no pudo ir al turno.
 * Ofrece la posibilidad de reagendar.
 */
function buildNoAsistiResponse(
  appointmentContext: any,
  turnoStatus: import("@/lib/utils/date-utils").TurnoTemporalStatus,
  gptResponse?: string
): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)

  const empaticResponse = gptResponse || "Entendemos que no pudiste asistir."

  // Determinar referencia temporal natural: "hoy", "ayer", o el día de la semana
  let referenciaFecha: string
  if (turnoStatus === 'pasado_hoy' || turnoStatus === 'en_curso') {
    referenciaFecha = `hoy a las ${hora || 'la hora indicada'}`
  } else {
    // turno 'pasado' — calcular si fue ayer o antes
    const hoy = new Date()
    const ayer = new Date(hoy)
    ayer.setDate(hoy.getDate() - 1)
    const ayerStr = ayer.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }) // YYYY-MM-DD

    if (fecha === ayerStr) {
      referenciaFecha = `ayer a las ${hora || 'la hora indicada'}`
    } else {
      const diaSemana = fecha ? formatDate(fecha) : 'la fecha indicada'
      referenciaFecha = `el ${diaSemana} a las ${hora || 'la hora indicada'}`
    }
  }

  return `${empaticResponse}

Veo que tenías un turno agendado para ${referenciaFecha} con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

Si querés solicitar un nuevo turno, puedo ayudarte a gestionarlo:

1- Sí, quiero un nuevo turno
2- No, por ahora no`
}

/**
 * Respuesta para mensajes completamente fuera del scope del bot (intent = "otro").
 * Este canal es exclusivo para gestión de turnos — cualquier otra consulta se deriva.
 */
function buildOutOfScopeResponse(escalationPhoneNumber?: string): string {
  const phoneMsg = escalationPhoneNumber
    ? fraseDerivacion('Para otro tipo de consultas, por favor contactanos', escalationPhoneNumber)
    : `Para otro tipo de consultas, por favor contactate directamente con la clínica.`

  return `Este canal de WhatsApp es exclusivo para la gestión de turnos médicos.\n\n${phoneMsg}\n\nSi en algún momento necesitás gestionar un turno, escribime y con gusto te ayudo.`
}

/**
 * Respuesta para consultas informativas del turno
 * Basada en el reasoning del NLU para determinar qué información dar
 */
function buildInformationalQueryResponse(appointmentContext: any, classificationResult: FallbackIntentResult): string {
  const { fecha, hora, profesional, sede } = extractTurnoData(appointmentContext)
  const fechaFormateada = fecha ? formatDate(fecha) : 'fecha no disponible'
  
  // Obtener direccion del primer turno o del contexto
  let direccion = ''
  if (appointmentContext?.turnos && Array.isArray(appointmentContext.turnos) && appointmentContext.turnos.length > 0) {
    direccion = appointmentContext.turnos[0].direccion || ''
  } else {
    direccion = appointmentContext?.direccion || appointmentContext?.address || ''
  }

  // Analizar el reasoning para determinar qué tipo de información se pidió
  const reasoning = (classificationResult.reasoning || "").toLowerCase()
  const response = (classificationResult.response || "").toLowerCase()

  // Si pregunta por dirección/ubicación
  if (reasoning.includes("direcci") || reasoning.includes("ubicaci") || reasoning.includes("donde") ||
      response.includes("direcci") || response.includes("ubicaci") || response.includes("donde")) {
    if (direccion) {
      return `Tu turno es en *${sede || 'la sede indicada'}*.\n\n📍 Dirección: ${direccion}\n\n¿Hay algo más en lo que pueda ayudarte?`
    }
    return `Tu turno es en *${sede || 'la sede indicada'}*. Para la dirección exacta, te recomiendo contactar directamente a la clínica.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }

  // Si pregunta por hora
  if (reasoning.includes("hora") || reasoning.includes("horario") || response.includes("hora")) {
    return `Tu turno es a las *${hora || 'hora no disponible'}* el ${fechaFormateada}.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }

  // Si pregunta por profesional
  if (reasoning.includes("profes") || reasoning.includes("doctor") || reasoning.includes("medico") ||
      reasoning.includes("médico") || reasoning.includes("quien") || reasoning.includes("quién")) {
    return `Tu turno es con *${profesional || 'el profesional asignado'}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }

  // Si pregunta por fecha
  if (reasoning.includes("fecha") || reasoning.includes("día") || reasoning.includes("dia") || reasoning.includes("cuando") || reasoning.includes("cuándo")) {
    return `Tu turno es el *${fechaFormateada}* a las ${hora || 'hora no disponible'}.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }

  // Si pregunta por sede
  if (reasoning.includes("sede") || reasoning.includes("sucursal") || reasoning.includes("lugar")) {
    if (direccion) {
      return `Tu turno es en *${sede || 'la sede indicada'}*.\n\n📍 Dirección: ${direccion}\n\n¿Hay algo más en lo que pueda ayudarte?`
    }
    return `Tu turno es en *${sede || 'la sede indicada'}*.\n\n¿Hay algo más en lo que pueda ayudarte?`
  }

  // Default: dar todos los datos del turno
  let responseText = `Acá están los datos de tu turno:\n\n`
  responseText += `📅 *Fecha:* ${fechaFormateada}\n`
  responseText += `🕐 *Hora:* ${hora || 'no disponible'}\n`
  responseText += `👨‍⚕️ *Profesional:* ${profesional || 'no disponible'}\n`
  responseText += `🏥 *Sede:* ${sede || 'no disponible'}\n`
  
  if (direccion) {
    responseText += `📍 *Dirección:* ${direccion}\n`
  }
  
  responseText += `\n¿Hay algo más en lo que pueda ayudarte?`
  
  return responseText
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateStr: string): string {
  try {
    if (!dateStr) return 'fecha no disponible'
    
    // Para fechas en formato YYYY-MM-DD, parsear manualmente para evitar problemas de timezone
    // new Date("2026-06-02") se interpreta como UTC medianoche, causando errores de día
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    let date: Date
    
    if (isoMatch) {
      // Parsear manualmente: año, mes (0-indexed), día
      const year = parseInt(isoMatch[1], 10)
      const month = parseInt(isoMatch[2], 10) - 1 // Meses son 0-indexed en JS
      const day = parseInt(isoMatch[3], 10)
      date = new Date(year, month, day)
    } else {
      // Fallback para otros formatos
      date = new Date(dateStr)
    }
    
    // Verificar que la fecha sea válida
    if (isNaN(date.getTime())) {
      return dateStr
    }
    
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }
    return date.toLocaleDateString("es-ES", options)
  } catch {
    return dateStr
  }
}
