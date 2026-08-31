import { createConversationLogger } from '../logger'
import { getEffectiveFeatureFlags } from '../feature-flags'
import {
  startPatientDetectionFlow,
  processPatientDetectionMessage,
  isPatientDetectionFlowActive,
  getDetectedPatientInfo,
  clearPatientDetectionFlow,
  processDNIForDisambiguation,
  getPatientDetectionState,
  updatePatientDetectionPhase,
  updatePatientDetectionHasReminder,
  clearIdentifiedPatient,
  getIdentifiedPatient,
  returnPatientToMenu,
  identifyPatientByDNI,
  updatePatientDetectionObraSocialBloqueada,
} from './patient-flow-handler'
import type { ObraSocialBloqueada } from './patient-templates'
import {
  buildExistingPatientGreeting,
  buildNewPatientGreeting,
  buildMultiplePatientGreeting,
  buildSelectionConfirmation,
  buildInvalidSelectionMessage,
  buildDetectionErrorMessage,
  buildTurnosSummary,
  buildOtherInquiryMessage,
  buildTurnoIntentConfirmedMessage,
  buildFamiliarDNIRequestContextualMessage,
} from './patient-templates'
import { detectFamiliarIntent } from './familiar-intent-detector'
import { classifyTurnoEstado } from './turno-estado'
import { extractDNI } from '../dni-handler'
import { resolverTurnosOnline } from '../shared/obra-social'
import { recordDiag, DIAG } from '@/lib/diagnostics'

/**
 * Patient Detection Flow Integration
 * API limpia para integrar el flujo de detección en whatsapp.tsx
 * Maneja decisiones entre flujo determinístico vs OpenAI
 */

export interface PatientDetectionResult {
  handled: boolean
  message?: string
  buttons?: Array<{ id: string; title: string }>
  action?: string
  patientInfo?: {
    isNewPatient: boolean
    patientId?: string
    patientName?: string
    patientDNI?: string
    patientLastName?: string
    patientFirstName?: string
    obraSocialId?: string
    obraSocialNombre?: string
    turnos?: any[]
    turnosQx?: any[]
  }
  shouldCallOpenAI?: boolean
  openAIContext?: string
}

/**
 * Punto de entrada principal: Iniciar detección de paciente
 * Se llama cuando el usuario escribe SIN recordatorio previo
 * @param phoneNumber - Número de teléfono del usuario
 * @param configId - ID de configuración de WhatsApp (para feature flags y logging)
 * @param clienteId - ID del cliente en el sistema de la clínica (para llamadas a la API)
 * @param clinicName - Nombre de la clínica/centro para personalizar mensajes
 */
export async function initializePatientDetection(
  phoneNumber: string,
  configId: string,
  clienteId: string,
  clinicName?: string,
  firstMessage?: string,
  hasReminder: boolean = false,
  bypassFlag: boolean = false,
  /**
   * WhatsAppConfig.permitirNuevoTurno del cliente (default true). Cuando es
   * false, se ocultan del menú "Solicitar turno" y "Turno para familiar" —
   * el bloqueo funcional real ocurre río abajo en initializeNewPatientFlow/
   * initializeExistingPatientFlow, esto es sólo para no ofrecer una opción
   * que después se va a rechazar.
   */
  permitirNuevoTurno?: boolean,
  /** WhatsAppConfig.permitirCancelacion del cliente (default true). */
  permitirCancelacion?: boolean,
  /** WhatsAppConfig.escalationPhoneNumber — para los mensajes de derivación cuando no queda ninguna gestión disponible. */
  escalationPhoneNumber?: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'initial_detection_pending')
  logger.info('Initializing patient detection', {})

  // Verificar si el feature flag está habilitado
  const flags = await getEffectiveFeatureFlags(configId)

  console.log(`[v0] [INIT_DETECTION] flag directPatientDetection=${flags.directPatientDetection} bypassFlag=${bypassFlag} configId=${configId}`)

  // bypassFlag=true: se usa cuando ya sabemos con certeza (por el contenido
  // exacto del mensaje) que corresponde mostrar el menú determinístico —
  // ej. el mensaje predefinido del widget de WhatsApp — sin depender de que
  // el cliente tenga prendido el flag general de detección por teléfono.
  if (!flags.directPatientDetection && !bypassFlag) {
    logger.debug('Feature flag disabled, using OpenAI', {})
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Patient detection disabled, route to asst_router',
    }
  }

  try {
    // ── Menú corto si el paciente YA está identificado ─────────────────────
    //
    // 28/8/2026: el saludo completo de bienvenida se repetía en el 6,6% de las
    // conversaciones, y en 17 de 29 casos ocurría dentro de la misma hora — o
    // sea, con la identidad del paciente todavía viva en Redis. El paciente
    // escribía algo genérico ("Hola, te hago una pregunta"), el dispatcher
    // pedía "mostrar menú principal", y eso disparaba la detección COMPLETA de
    // nuevo: se lo volvía a saludar como si recién llegara y, en teléfonos con
    // varios pacientes, se le volvía a pedir el DNI que ya había dado.
    //
    // Si ya sabemos quién es y hay un flujo de detección vivo, alcanza con
    // recordarle las opciones. Se excluye el caso de recordatorio pendiente
    // (hasReminder), donde el saludo completo sí aporta el contexto del turno.
    if (!hasReminder) {
      try {
        const [identificado, detectionActiva] = await Promise.all([
          getIdentifiedPatient(phoneNumber),
          isPatientDetectionFlowActive(phoneNumber),
        ])

        if (identificado?.patientName && detectionActiva) {
          const menuCorto = await returnPatientToMenu(phoneNumber)
          if (menuCorto) {
            logger.info('Paciente ya identificado — menú corto en vez de saludo completo', {
              patientName: identificado.patientName,
            })
            void recordDiag(configId, DIAG.MENU_CORTO)
            return {
              handled: true,
              message: menuCorto,
              patientInfo: {
                isNewPatient: false,
                patientId: identificado.patientId,
                patientName: identificado.patientName,
              },
            }
          }
        }
      } catch (error) {
        // Ante cualquier problema se sigue por el camino normal (saludo completo).
        logger.warn('No se pudo resolver el menú corto, se usa detección completa', { error: String(error) })
      }
    }

    const detectionResult = await startPatientDetectionFlow(phoneNumber, configId, clienteId, permitirNuevoTurno, permitirCancelacion, escalationPhoneNumber)
    console.log(`[v0] [INIT_DETECTION] startPatientDetectionFlow result: isNewPatient=${detectionResult.isNewPatient} error=${detectionResult.error} multiplePatients=${detectionResult.multiplePatients?.length}`)

    if (detectionResult.error) {
      logger.warn('Detection error, fallback to OpenAI', {
        error: detectionResult.error,
      })
      return {
        handled: true,
        message: buildDetectionErrorMessage(),
        shouldCallOpenAI: true,
        openAIContext: 'Patient detection error, request DNI',
      }
    }

    if (detectionResult.isNewPatient) {
      // Antes de darlo por paciente nuevo: si trajo el DNI en su primer mensaje,
      // buscarlo por DNI. El teléfono desde el que escribe puede no estar
      // registrado (número nuevo, teléfono de un familiar) aunque el paciente sí
      // exista en el sistema de la clínica.
      //
      // 28/8/2026 — caso real: "hola, quiero un turno dni 36100432" desde un
      // teléfono no registrado. La detección por teléfono devolvía "no
      // encontrado", se lo trataba como nuevo y se le volvía a pedir el DNI que
      // acababa de escribir.
      const dniDelMensaje = firstMessage ? extractDNI(firstMessage) : null

      if (dniDelMensaje?.valid) {
        const encontrado = await identifyPatientByDNI(phoneNumber, dniDelMensaje.dni, configId, clienteId)

        if (encontrado) {
          logger.info('Paciente hallado por DNI pese a teléfono no registrado', {
            patientName: encontrado.patientName,
          })
          void recordDiag(configId, DIAG.DNI_DESDE_PRIMER_MENSAJE)
          // Se continúa por el camino de paciente existente (saludo con turnos).
          detectionResult.isNewPatient = false
          detectionResult.patientId = encontrado.patientId
          detectionResult.patientName = encontrado.patientName
          detectionResult.turnos = encontrado.turnos
        }
      }
    }

    if (detectionResult.isNewPatient) {
      logger.info('New patient detected', { phone: phoneNumber })
      // 21/8/2026 (caso Instituto Privado de Ojos Dres. Filomena): identified_patient
      // (patient-flow-handler.ts) persiste la identidad de un paciente ya identificado
      // por 1h para no re-validar dentro de la misma sesión — pero nada la invalidaba
      // cuando una consulta FRESCA a get_paciente decía "no encontrado" para ese mismo
      // teléfono (ej. de prueba: se borró el paciente de la base para simular uno
      // nuevo). Resultado: el saludo de "paciente nuevo" se mostraba bien, pero el
      // siguiente mensaje (ej. "1") caía en restoreDetectionStateFromCache, que leía
      // esa caché vieja y resucitaba la identidad anterior (nombre, DNI, obra social)
      // para armar la reserva, ignorando que la detección recién dijo que no existía.
      // Se limpia acá para que un "no encontrado" fresco siempre gane sobre la caché.
      await clearIdentifiedPatient(phoneNumber)
      return {
        handled: true,
        message: buildNewPatientGreeting(clinicName, permitirNuevoTurno, escalationPhoneNumber),
        buttons: permitirNuevoTurno === false
          ? undefined
          : [
              { id: "1", title: "Solicitar turno" },
              { id: "2", title: "Turno para familiar" },
              { id: "3", title: "Otra consulta" },
            ],
        patientInfo: {
          isNewPatient: true,
        },
      }
    }

    // Si hay múltiples pacientes, solicitar DNI para desambiguar...
    if (detectionResult.multiplePatients && detectionResult.multiplePatients.length > 1) {
      // ...salvo que el paciente YA lo haya dado en su primer mensaje.
      //
      // 28/8/2026 (caso Luis, Salud Ocular): el paciente escribió "Buen día
      // necesito un turno. LUIS COLOMBO dni 4531271 Pami" y el bot igual le
      // respondió "indicame tu DNI"; el paciente tuvo que repetir el mismo
      // número que acababa de escribir. Dos mensajes de fricción evitables en
      // el primer contacto, justo donde peor impresión deja.
      const dniEnPrimerMensaje = firstMessage ? extractDNI(firstMessage) : null

      if (dniEnPrimerMensaje?.valid) {
        logger.info('DNI encontrado en el primer mensaje — desambiguando sin volver a preguntar', {
          count: detectionResult.multiplePatients.length,
        })

        const resolucion = await processDNIForDisambiguation(
          phoneNumber,
          dniEnPrimerMensaje.dni,
          configId,
          clienteId,
        )

        if (resolucion.found) {
          // Identidad resuelta: se continúa como paciente existente (el saludo
          // con sus turnos se arma más abajo, igual que en el camino normal).
          detectionResult.patientId = resolucion.patientId
          detectionResult.patientName = resolucion.patientName
          detectionResult.turnos = resolucion.turnos || []
          detectionResult.multiplePatients = undefined
          void recordDiag(configId, DIAG.DNI_DESDE_PRIMER_MENSAJE)
        } else {
          // El DNI del mensaje no coincide con ninguno de los pacientes del
          // teléfono (o falló la validación) → pedirlo como siempre.
          logger.info('El DNI del primer mensaje no resolvió la desambiguación — se pide igual', {
            error: resolucion.error,
          })
          return {
            handled: true,
            message: buildMultiplePatientGreeting(detectionResult.multiplePatients, clinicName),
            patientInfo: { isNewPatient: false },
          }
        }
      } else {
        logger.info('Multiple patients detected, requesting DNI', {
          count: detectionResult.multiplePatients.length,
          phone: phoneNumber,
        })
        return {
          handled: true,
          message: buildMultiplePatientGreeting(detectionResult.multiplePatients, clinicName),
          patientInfo: {
            isNewPatient: false,
          },
        }
      }
    }

    // Paciente existente: detectar intención de familiar en primer mensaje
    if (firstMessage) {
      const familiarIntent = detectFamiliarIntent(firstMessage)
      if (familiarIntent.detected) {
        console.log(`[v0] [INIT_DETECTION] Familiar intent detected: relation="${familiarIntent.relation}" from message="${firstMessage.substring(0, 60)}"`)
        await updatePatientDetectionPhase(phoneNumber, 'awaiting_familiar_dni')
        const callerFirstName = (detectionResult.patientName || 'Hola').split(' ')[0]
        const firstName = callerFirstName.charAt(0).toUpperCase() + callerFirstName.slice(1).toLowerCase()
        return {
          handled: true,
          message: buildFamiliarDNIRequestContextualMessage(firstName, familiarIntent.relation),
          patientInfo: {
            isNewPatient: false,
            patientId: detectionResult.patientId,
            patientName: detectionResult.patientName,
            turnos: detectionResult.turnos,
          },
        }
      }
    }

    // Paciente existente: mostrar saludo con turnos
    // Persistir hasReminder en el estado para que processPatientDetectionMessage
    // use el mismo valor al construir el action map.
    await updatePatientDetectionHasReminder(phoneNumber, hasReminder)
    void recordDiag(configId, DIAG.SALUDO_COMPLETO)

    const hasTurnos = detectionResult.turnos && detectionResult.turnos.length > 0
    const hasTurnosQx = detectionResult.turnosQx && detectionResult.turnosQx.length > 0

    // ── Obra social no habilitada para turnos online ───────────────────────
    //
    // 28/8/2026 (caso Luis, Salud Ocular): el paciente escribió "necesito un
    // turno", se lo identificó, se le mostró el menú, eligió "1" y RECIÉN AHÍ
    // se le dijo que su obra social (PAMI SO) no estaba habilitada. Cuatro
    // mensajes para una respuesta que ya se podía dar en el primero.
    //
    // 31/8/2026 (caso Ana, PAMI CANNING): la primera versión de este aviso se
    // agregaba como nota al final del saludo, pero el menú se construía antes y
    // seguía ofreciendo "Solicitar turno médico" — le ofrecíamos al paciente una
    // opción que el sistema ya sabía que iba a rechazar (y que además lo metía
    // en el flujo de reserva para frenarlo adentro). Ahora se resuelve ANTES de
    // construir el saludo y se pasa a los builders, que quitan esa opción y
    // renumeran. El flag se persiste en el estado para que el action map de
    // patient-flow-handler.ts ofrezca exactamente lo mismo.
    //
    // Las demás gestiones (cancelar, confirmar, turno para un familiar, otra
    // consulta) siguen disponibles: la restricción es solo sobre el turno propio.
    let obraSocialBloqueada: ObraSocialBloqueada | undefined

    if (permitirNuevoTurno !== false) {
      try {
        // BUG CORREGIDO (31/8/2026): esto leía la obra social de
        // getIdentifiedPatient, pero esa clave SOLO se escribe cuando se limpia
        // el flujo de detección (clearPatientDetectionFlow) — en el momento del
        // saludo siempre devuelve null, así que el aviso nunca se enviaba.
        // La fuente correcta es el estado de detección, que startPatientDetectionFlow
        // acaba de guardar con obraSocialId/obraSocialNombre. Se deja
        // getIdentifiedPatient como respaldo para los casos en que el estado ya
        // se limpió pero la identidad sigue viva.
        const [estadoDeteccion, identificado] = await Promise.all([
          getPatientDetectionState(phoneNumber),
          getIdentifiedPatient(phoneNumber),
        ])
        const obraSocialNombre = (estadoDeteccion?.obraSocialNombre || identificado?.obraSocialNombre)?.trim()

        const obraSocialId = estadoDeteccion?.obraSocialId || identificado?.obraSocialId

        if (obraSocialNombre) {
          // Resolución exacta por Deudor_Id (ver shared/obra-social.ts): buscar
          // por nombre y quedarse con el primer resultado hacía que se evaluara
          // la obra social equivocada cuando la búsqueda devolvía varias.
          const resultadoOS = await resolverTurnosOnline(clienteId, obraSocialNombre, obraSocialId)

          if (resultadoOS.estado === 'bloqueada') {
            logger.info('Obra social no habilitada — se ajusta el menú del saludo', { obraSocialNombre })
            void recordDiag(configId, DIAG.OBRA_SOCIAL_BLOQUEADA_EN_SALUDO)
            obraSocialBloqueada = {
              nombre: resultadoOS.nombre || obraSocialNombre,
              telefonoDerivacion: escalationPhoneNumber,
            }
            // Persistir para que el action map ofrezca las mismas opciones que
            // el texto. Si esto falla, el menú mostrado y el interpretado se
            // desincronizan, así que se prefiere no ocultar la opción antes que
            // mostrar un menú cuyos números hacen otra cosa.
            const persistido = await updatePatientDetectionObraSocialBloqueada(phoneNumber, true)
            if (!persistido) {
              logger.warn('No se pudo persistir obraSocialBloqueada — se mantiene el menú completo')
              obraSocialBloqueada = undefined
            }
          }
        }
      } catch (error) {
        // No bloquea el saludo: si la validación falla, el flujo de reserva
        // vuelve a chequearlo más adelante como siempre.
        logger.warn('No se pudo validar la obra social para el aviso temprano', { error: String(error) })
        obraSocialBloqueada = undefined
      }
    }

    let greeting = buildExistingPatientGreeting(
      detectionResult.patientName || 'Paciente',
      detectionResult.turnos || [],
      clinicName,
      detectionResult.turnosQx || [],
      hasReminder,
      permitirNuevoTurno,
      permitirCancelacion,
      escalationPhoneNumber,
      obraSocialBloqueada
    )

    // Único turno, sin posibilidad de confirmar (no hubo recordatorio) ni de
    // cancelar-y-agendar-nuevo (permitirNuevoTurno=false): el saludo ofrece
    // solo el botón "Cancelar turno" — debe coincidir con la lógica de
    // buildSingleTurnoGreeting (patient-templates.ts) y con el actionMap de
    // patient-flow-handler.ts.
    const singleTurno = detectionResult.turnos && detectionResult.turnos.length === 1
      ? detectionResult.turnos[0]
      : null
    const singleTurnoSoloCancelar =
      !!singleTurno &&
      !(classifyTurnoEstado(singleTurno) === 'no_confirmado' && hasReminder) &&
      permitirCancelacion !== false &&
      permitirNuevoTurno === false

    // Incluir botones interactivos para los casos sin turnos médicos.
    // Los ids DEBEN coincidir con el texto del menú y con el action map: con la
    // obra social bloqueada no se ofrece "Solicitar turno" y todo se corre uno.
    const greetingButtons: Array<{ id: string; title: string }> | undefined =
      singleTurnoSoloCancelar
        ? [{ id: "1", title: "Cancelar turno" }]
        : (!hasTurnos)
            ? (permitirNuevoTurno === false
                ? undefined
                : obraSocialBloqueada
                  ? [
                      { id: "1", title: "Turno para familiar" },
                      { id: "2", title: "Otra consulta" },
                    ]
                  : [
                      { id: "1", title: "Solicitar turno" },
                      { id: "2", title: "Turno para familiar" },
                      { id: "3", title: "Otra consulta" },
                    ])
            : undefined

    return {
      handled: true,
      message: greeting,
      buttons: greetingButtons,
      patientInfo: {
        isNewPatient: false,
        patientId: detectionResult.patientId,
        patientName: detectionResult.patientName,
        turnos: detectionResult.turnos,
      },
    }
  } catch (error) {
    logger.error('Unexpected error', error as Error)

    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Patient detection error, use asst_router',
    }
  }
}

/**
 * Procesa mensajes del usuario durante el flujo de detección
 * Se llama para cada mensaje mientras el flujo está activo
 */
export async function handlePatientDetectionMessage(
  phoneNumber: string,
  userMessage: string,
  clientId: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_awaiting_action')
  logger.info('Handling patient detection message', {
    message: userMessage.substring(0, 50),
  })

  // Verificar si el flujo está activo
  const isActive = await isPatientDetectionFlowActive(phoneNumber)

  if (!isActive) {
    logger.debug('Flow not active for this user', { phone: phoneNumber })
    return { handled: false, shouldCallOpenAI: true }
  }

  // Leer el estado actual para saber en qué fase estamos
  const state = await getPatientDetectionState(phoneNumber)

  if (!state) {
    logger.warn('No state found despite flow being active', {})
    return { handled: false, shouldCallOpenAI: true }
  }

  // --- Fase: Selección de intención de contacto (paciente nuevo — turno vs consulta) ---
  if (state.phase === 'awaiting_contact_intent') {
    logger.info('Processing contact intent selection', {})
    // Delegar a whatsapp.tsx para procesar con clienteId disponible
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'contact_intent_pending',
      patientInfo: { isNewPatient: true },
    }
  }

  // --- Fase: Espera de DNI del familiar ---
  if (state.phase === 'awaiting_familiar_dni') {
    logger.info('Processing familiar DNI input', {})

    // "0" = volver al menú principal
    if (userMessage.trim() === '0') {
      return {
        handled: false,
        shouldCallOpenAI: false,
        action: 'familiar_back_to_main',
        patientInfo: { isNewPatient: false },
      }
    }

    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')

    if (dniOnly.length < 7 || dniOnly.length > 9) {
      return {
        handled: true,
        message:
          'El DNI no parece válido. Por favor, indicame el DNI del familiar (7 u 8 dígitos) sin puntos ni espacios.',
      }
    }

    // Tiene formato de DNI válido — delegar a whatsapp.tsx con clienteId
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'familiar_dni_pending',
      patientInfo: { isNewPatient: false },
    }
  }

  // --- Fase: Espera de DNI para desambiguar múltiples pacientes ---
  if (state.phase === 'awaiting_dni_for_disambiguation') {
    logger.info('Processing DNI for disambiguation', {})
    // La desambiguación necesita clienteId real, pero desde aquí solo tenemos configId.
    // Delegamos al handler que ya tiene la lógica correcta.
    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')

    if (dniOnly.length < 7 || dniOnly.length > 9) {
      // Si el mensaje no tiene dígitos en absoluto (texto libre, ej. "Se podría cambiar el turno"),
      // re-preguntar sin decir "no es válido" — el paciente simplemente no envió el DNI todavía.
      const message = dniOnly.length === 0
        ? 'Para continuar, necesito que me indiques tu DNI (7 u 8 dígitos, sin puntos ni espacios).'
        : 'El DNI ingresado no parece válido. Por favor indicame tu DNI (7 u 8 dígitos) sin puntos ni espacios.'
      return {
        handled: true,
        message,
      }
    }

    // Necesitamos clienteId para llamar a la API — lo pasamos como shouldCallOpenAI
    // para que whatsapp.tsx lo procese con clienteId disponible.
    // Por eso retornamos una señal especial para que whatsapp.tsx llame a handleDNIForMultiplePatients.
    return {
      handled: false,
      shouldCallOpenAI: false,
      action: 'dni_disambiguation_pending',
      patientInfo: { isNewPatient: false },
    }
  }

  // --- Fase: Espera de respuesta inicial (paciente nuevo — pide DNI) ---
  if (state.phase === 'awaiting_initial_response') {
    const dniOnly = userMessage.trim().replace(/[^0-9]/g, '')
    if (dniOnly.length >= 7 && dniOnly.length <= 9) {
      // Tiene pinta de DNI — delegar a whatsapp.tsx con clienteId
      return {
        handled: false,
        shouldCallOpenAI: false,
        action: 'new_patient_dni_pending',
        patientInfo: { isNewPatient: true },
      }
    }
    // Texto libre — va a OpenAI
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'New patient, waiting for DNI. Extract DNI from message.',
    }
  }

  // --- Fase: Selección de acción (menú 1-4) ---
  const processResult = await processPatientDetectionMessage(
    phoneNumber,
    userMessage,
    clientId
  )

  if (!processResult.handled) {
    // Mensaje no numérico — requiere NLU
    logger.info('Message requires NLU processing', {
      nextPhase: processResult.nextPhase,
    })

    const patientInfo = await getDetectedPatientInfo(phoneNumber)
    let openAIContext = ''
    if (patientInfo && !patientInfo.isNewPatient) {
      openAIContext =
        `Paciente existente: ${patientInfo.patientName}. ` +
        `Tiene ${patientInfo.turnos?.length || 0} turno(s) agendado(s). ` +
        `Opciones disponibles: 1-Confirmar turno, 2-Cancelar turno, 3-Solicitar otro turno.`
    }

    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext,
    }
  }

  // Selección numérica válida procesada (o consulta informativa interceptada)
  logger.info('Valid selection processed', {
    action: processResult.action,
  })

  // La acción se propaga a whatsapp.tsx para derivar al flujo correspondiente
  return {
    handled: true,
    action: processResult.action,
    message: processResult.message,
    patientInfo: processResult.data,
  }
}

/**
 * Verifica si debe usar detección de paciente
 * Útil para decidir en whatsapp.tsx si procesar localmente o enviar a OpenAI
 */
export async function shouldUsePatientDetection(
  phoneNumber: string,
  clientId: string,
  isReminderPending: boolean
): Promise<boolean> {
  // No usar si hay recordatorio pendiente (usa otro flujo)
  if (isReminderPending) {
    return false
  }

  // Verificar si el flujo ya está activo para este usuario
  const isActive = await isPatientDetectionFlowActive(phoneNumber)

  if (isActive) {
    return true
  }

  // Verificar si el feature flag está habilitado
  const flags = await getEffectiveFeatureFlags(clientId)

  return flags.directPatientDetection
}

/**
 * Limpia la detección cuando el usuario termina el flujo
 */
export async function completePatientDetectionFlow(
  phoneNumber: string,
  clientId: string
): Promise<void> {
  const logger = createConversationLogger(phoneNumber, clientId, 'initial_detection_pending')
  logger.info('Completing patient detection flow', { phone: phoneNumber })

  await clearPatientDetectionFlow(phoneNumber, clientId)
}

/**
 * Helper: Extrae número de 1-4 del mensaje
 */
function extractNumberFromMessage(message: string): number {
  const match = message.trim().match(/^[1-4]$/)
  return match ? parseInt(match[0], 10) : 0
}

/**
 * Obtiene información del paciente detectado para contexto
 */
export async function getPatientContextForOpenAI(
  phoneNumber: string
): Promise<string> {
  const patientInfo = await getDetectedPatientInfo(phoneNumber)

  if (!patientInfo) {
    return ''
  }

  if (patientInfo.isNewPatient) {
    return 'CONTEXTO: Usuario es nuevo en el sistema. Necesitas extraer su DNI.'
  }

  let context = `CONTEXTO: Usuario es paciente existente.\n`
  context += `Nombre: ${patientInfo.patientName}\n`
  context += `DNI: ${patientInfo.patientDNI}\n`

  if (patientInfo.turnos && patientInfo.turnos.length > 0) {
    context += `Turnos: ${patientInfo.turnos.length} agendados\n`
    context += `Próximo: ${patientInfo.turnos[0].fecha}\n`
  }

  return context
}


/**
 * Procesa DNI cuando hay múltiples pacientes
 * Se llama cuando el usuario envía su DNI durante la fase de desambiguación
 */
export async function handleDNIForMultiplePatients(
  phoneNumber: string,
  dniMessage: string,
  configId: string,
  clienteId: string,
  clinicName?: string
): Promise<PatientDetectionResult> {
  const logger = createConversationLogger(phoneNumber, configId, 'dni_disambiguation')
  logger.info('Processing DNI for multiple patients', {})

  // Verificar estado
  const state = await getPatientDetectionState(phoneNumber)

  if (!state || state.phase !== 'awaiting_dni_for_disambiguation') {
    logger.warn('Invalid state for DNI processing', { phase: state?.phase })
    return {
      handled: false,
      shouldCallOpenAI: true,
      openAIContext: 'Invalid state, route to asst_router',
    }
  }

  // Extraer DNI del mensaje
  const dniMatch = dniMessage.trim().replace(/[^0-9]/g, '')

  if (dniMatch.length < 7 || dniMatch.length > 9) {
    logger.warn('Invalid DNI format', { length: dniMatch.length })
    const invalidMsg = dniMatch.length === 0
      ? 'Para continuar, necesito que me indiques tu DNI (7 u 8 dígitos, sin puntos ni espacios).'
      : 'El DNI ingresado no parece válido. Por favor indicame tu DNI (7 u 8 dígitos) sin puntos ni espacios.'
    return {
      handled: true,
      message: invalidMsg,
      patientInfo: {
        isNewPatient: false,
      },
    }
  }

  // Procesar DNI
  const result = await processDNIForDisambiguation(
    phoneNumber,
    dniMatch,
    configId,
    clienteId
  )

  if (!result.found) {
    logger.warn('DNI not found in patients list', {})

    if (result.error?.includes('Max attempts')) {
      // Después de 3 intentos fallidos, registrar como nuevo paciente
      await clearPatientDetectionFlow(phoneNumber, configId)
      return {
        handled: true,
        message: buildNewPatientGreeting(clinicName),
        buttons: [
          { id: "1", title: "Solicitar turno" },
          { id: "2", title: "Turno para familiar" },
          { id: "3", title: "Otra consulta" },
        ],
        patientInfo: {
          isNewPatient: true,
        },
      }
    }

    return {
      handled: true,
      message:
        `El DNI ${dniMatch} no está registrado con este número de teléfono. ` +
        `Por favor, intenta de nuevo o contactá al centro.`,
      patientInfo: {
        isNewPatient: false,
      },
    }
  }

  // Paciente identificado correctamente
  logger.info('Patient identified', {
    patientId: result.patientId,
    patientName: result.patientName,
  })

  // Recuperar hasReminder del estado previo (fue guardado al iniciar la detección)
  const currentState = await getPatientDetectionState(phoneNumber)
  const hasReminderFromState = currentState?.hasReminder ?? false

  const greeting = buildExistingPatientGreeting(
    result.patientName || 'Paciente',
    result.turnos || [],
    clinicName,
    result.turnosQx || [],
    hasReminderFromState
  )

  return {
    handled: true,
    message: greeting,
    patientInfo: {
      isNewPatient: false,
      patientId: result.patientId,
      patientName: result.patientName,
      turnos: result.turnos,
    },
  }
}

/**
 * Procesa el DNI del familiar ingresado por el usuario
 * Busca al familiar en el sistema y arranca el flujo de paciente existente o nuevo
 */
// Re-export functions from handler so they can be imported from this module
export { isPatientDetectionFlowActive, getDetectedPatientInfo, clearPatientDetectionFlow, updatePatientDetectionPhase, getIdentifiedPatient, clearIdentifiedPatient, returnPatientToMenu, resetDetectionToMainMenu, restoreDetectionStateFromCache } from './patient-flow-handler'
