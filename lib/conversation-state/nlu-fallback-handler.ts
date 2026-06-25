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

    logger.info(`[Sprint 18] Clasificando mensaje con NLU fallback`, {
      userMessage,
      hasAppointmentContext: !!appointmentContext,
    })

    const classificationResult = await classifyIntent(
      userMessage,
      appointmentContext,
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

    // Si es explicación contextual → solo respuesta empática, sin menú
    // El paciente está informando un motivo, no tomando una acción sobre el turno
    if (classificationResult.intent === "explicacion_contextual") {
      const response = classificationResult.response || "Entendemos la situación, gracias por avisarnos. Si necesitás hacer algún cambio en tu turno, podés indicarnos qué preferís."
      return {
        shouldHandle: true,
        result: classificationResult,
        response,
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

    // Saludo/despedida → distinguir entre saludo de apertura y cierre de conversación.
    // Los saludos de apertura ("hola", "buenos días") deben pasar al flujo normal
    // para que el chatbot muestre el menú de bienvenida.
    // Solo los cierres/agradecimientos ("chau", "gracias", "igualmente") se responden directamente.
    if (classificationResult.intent === "saludo_despedida") {
      const normalized = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
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
): Promise<FallbackIntentResult> {
  const rulesResult = classifyIntentWithRules(userMessage)

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
    model: "gpt-4o-mini",
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
 * Amplio vocabulario para minimizar falsos negativos.
 */
function isMedicalQuery(msg: string): boolean {
  // Medicamentos, dosis, administración
  if (/\b(medicamento|medicina|pastilla|comprimido|capsula|ibuprofeno|paracetamol|aspirina|antibiotico|antibioticos|vacuna|dosis|gotas (oculares|para|del)|pomada|crema|jarabe|inyeccion|suero|prescripcion|receta medica|me den una receta|necesito receta)\b/.test(msg)) return true

  // Síntomas físicos
  if (/\b(dolor|ardor|picazon|hinchazon|inflamacion|fiebre|temperatura (alta|elevada)|mareo|nausea|vomito|diarrea|constipacion|sangrado|herida|golpe|fractura|quemadura|alergia|sarpullido|erupcion|tos|gripe|covid|infeccion|bacteria|virus|hongo|vision borrosa|ojo (rojo|lastimado|hinchado)|oido|escucho mal|sordera|perdida de vision|perdida de audicion|sangre)\b/.test(msg)) return true

  // Diagnóstico y consulta clínica
  if (/\b(diagnostico|que tengo|que me pasa|que le pasa|enfermedad|condicion medica|es grave|es normal que|tengo que tomar|curable|cronico|agudo|benigno|maligno|cancer|tumor|quiste|calcul|opera|cirugia|tratamiento|terapia|rehabilitacion|curar|sanar|puedo tomar|debo tomar|deberia tomar|hay que tomar|puedo hacer|que hago (si|con|para)|que hago si me|me recomienda)\b/.test(msg)) return true

  // Estudios y resultados clínicos
  if (/\b(analisis (de sangre|clinico|de orina)|estudio medico|resultado (del analisis|del estudio)|laboratorio|radiografia|ecografia|tomografia|resonancia|biopsia|cultivo|plaqueta|hemograma|colesterol|glucosa|glucemia|hormona|examen medico|informe medico)\b/.test(msg)) return true

  // Preguntas de dosificación / uso / efectos
  if (/\b(cuantas (gotas|pastillas|veces al dia)|cuanto (tomar|tiempo tomar|tiempo usar)|cuando (tomar|empezar|terminar)|como (tomar|aplicar|usar)|para que sirve (este|ese|el)|efecto secundario|contraindicacion|interaccion (medicamentosa)?)\b/.test(msg)) return true

  // Emergencias
  if (/\b(emergencia|guardia medica|sala de guardia|ambulancia|llamen al|urgencia medica)\b/.test(msg)) return true

  return false
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
  return /\b(cancelo|cancelar( el turno)?|tengo que cancelar|quiero cancelar|no puedo (ir|asistir|concurrir)|no (voy|ire|asistire)|no voy a poder|no podre ir|no podré ir|baja el turno|bajar el turno|dar de baja el turno)\b/.test(msg)
}

/** Reagendamiento */
function isReschedule(msg: string): boolean {
  return /\b(reagend|cambiar (la )?(fecha|turno|horario)|otra fecha|otro horario|distinto horario|mover (el )?turno|postergar( el turno)?|adelantar( el turno)?|cambio de (fecha|horario)|diferente fecha|nuevo horario|otro dia para|otro momento para)\b/.test(msg)
}

/** Consulta informativa sobre datos del turno (dirección, hora, profesional) */
function isInformationalQuery(msg: string): boolean {
  return /\b(donde (queda|es|esta) (la sede|el consultorio|el lugar)?|a que hora (es|tengo)|con quien (es|tengo)|cual es la (direccion|sede|lugar)|como llego (a la sede|al consultorio)?|la direccion( exacta)?|la hora (del turno|es)?|fecha (del turno|exacta)?|quien es (el|la) (medico|profesional|doctor)|en que (sede|consultorio|lugar))\b/.test(msg)
}

/** Queja o frustración */
function isComplaint(msg: string): boolean {
  return /\b(estuve (llamando|intentando|tratando)|nunca (atienden|funcionan|me atendieron|me respondieron)|siempre igual|imposible (comunicarse|contactarlos|hablar)|nadie (atiende|responde|contesta)|dias (llamando|esperando|tratando)|horas (esperando|llamando)|muy (mal|malo)|pesimo|nefasto|terrible|horrible|un desastre|no funciona(n)?|mal servicio|paciencia|no es posible que|increible que)\b/.test(msg)
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
function classifyIntentWithRules(
  userMessage: string,
): FallbackIntentResult {
  const msg = normalizeText(userMessage)

  // 1. PRIORIDAD MÁXIMA: consulta médica prohibida
  if (isMedicalQuery(msg)) {
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

  // 4. Confirmación de asistencia
  if (isConfirmation(msg)) {
    return {
      intent: "confirmar_asistencia",
      confidence: 0.85,
      reasoning: "Señales de confirmación de asistencia detectadas",
    }
  }

  // 5. Cancelación del turno
  if (isCancellation(msg)) {
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

  // Usar respuesta de GPT si existe, sino usar fallback
  const empaticResponse = gptResponse || "Esa información no la tengo disponible en este momento."

  // Construir mensaje de derivación con número si está disponible
  const derivacionMsg = escalationPhoneNumber
    ? `Para esa consulta te recomiendo comunicarte directamente con la clínica al *${escalationPhoneNumber}*.`
    : `Para esa consulta te recomiendo comunicarte directamente con la clínica.`

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

  // Número de derivación
  const derivacionMsg = escalationPhoneNumber
    ? `Para consultas médicas, por favor comunicate directamente con la clínica al *${escalationPhoneNumber}* o consultalo con tu médico en tu próxima visita.`
    : `Para consultas médicas, por favor consultalo directamente con tu médico en tu próxima visita o comunicate con la clínica.`

  return `No puedo brindarte información médica, ya que ese tipo de consultas deben ser respondidas por un profesional de la salud.

${derivacionMsg}

Tu turno sigue confirmado para el *${fechaFormateada}* a las *${hora || 'hora no disponible'}* con ${profesional || 'el profesional'} en ${sede || 'la sede indicada'}.

Si necesitás ayuda con tu turno (confirmar, cancelar o reagendar), con gusto te ayudo.`
}

/**
 * Respuesta para mensajes completamente fuera del scope del bot (intent = "otro").
 * Este canal es exclusivo para gestión de turnos — cualquier otra consulta se deriva.
 */
function buildOutOfScopeResponse(escalationPhoneNumber?: string): string {
  const phoneMsg = escalationPhoneNumber
    ? `Para otro tipo de consultas, por favor contactanos al *${escalationPhoneNumber}*.`
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
