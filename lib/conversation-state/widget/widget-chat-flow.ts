/**
 * Flujo conversacional del widget embebible (chat en el sitio web de cada clínica).
 *
 * Reglas de producto (definidas 9/7/2026):
 * - El widget SOLO sirve para agendar turnos NUEVOS — nada de cancelar, confirmar
 *   asistencia, reagendar ni derivar a atención humana. Fuera de eso, no hace nada más.
 * - El visitante es anónimo: no hay teléfono de WhatsApp hasta que el propio flujo de
 *   paciente nuevo lo pide explícitamente (fase 'awaiting_telefono', sólo en este canal).
 * - Reutiliza EXACTAMENTE el mismo motor de agendamiento que ya usa WhatsApp:
 *     - paciente existente -> lib/conversation-state/existing-patient (sin cambios)
 *     - paciente nuevo     -> lib/conversation-state/new-patient, con channel: 'widget'
 * - El primer mensaje de la conversación, si no hay flujo activo, se interpreta como
 *   el DNI del paciente (o se le pide si el mensaje no tiene forma de DNI).
 *
 * El "phone"/identificador que estas funciones compartidas reciben es el sessionId del
 * visitante (formato `web_...`, generado en components/widget-chat.tsx), NUNCA un
 * teléfono real. `normalizePhoneNumber` (lib/utils.ts) ya trata ese prefijo como caso
 * especial en el resto del proyecto.
 *
 * A diferencia de WhatsApp, las respuestas del widget son SIEMPRE texto plano — el
 * frontend (components/widget-chat.tsx) no renderiza botones ni listas interactivas.
 * El texto de cada paso ya incluye las opciones numeradas legibles (ej: "1. Sí, confirmar
 * / 2. No, modificar"), así que degradar a texto plano no pierde funcionalidad, sólo la
 * UI de botones. Por eso acá se ignoran deliberadamente sedesListRows/searchTypeButtons/
 * turnosButtons/confirmationButtons/modifyMenuRows — quedan como posible mejora futura.
 */

import { ClinicAPI } from '../../clinic-api'
import { createConversationLogger } from '../logger'
import {
  initializeNewPatientFlow,
  handleNewPatientMessage,
  isNewPatientFlowActive,
} from '../new-patient/new-patient-flow-integration'
import {
  initializeExistingPatientFlow,
  handleExistingPatientMessage,
  isExistingPatientFlowActive,
} from '../existing-patient/existing-patient-flow-integration'

export interface WidgetChatResult {
  handled: boolean
  message: string
  /** true cuando este mensaje resultó en una reserva de turno exitosa (para rate limiting de reservas). */
  reserved?: boolean
}

const WELCOME_ASK_DNI =
  `¡Hola! Soy el asistente virtual para agendar turnos. Para comenzar, decime tu número de *DNI* (sin puntos).`

const FEATURE_DISABLED_MESSAGE =
  `Este servicio no está disponible por el momento. Por favor, contactanos directamente para agendar tu turno.`

const GENERIC_FALLBACK_MESSAGE =
  `Disculpá, no entendí tu mensaje. ¿Podés reformularlo?`

/**
 * Extrae un DNI del mensaje del visitante. DNI argentino: 7 u 8 dígitos.
 * Devuelve null si el mensaje no tiene forma de DNI (para no confundir un
 * saludo o una pregunta cualquiera con un intento de DNI).
 */
function extractDNI(userMessage: string): string | null {
  const digits = userMessage.replace(/[^0-9]/g, '')
  if (digits.length >= 7 && digits.length <= 8) return digits
  return null
}

/**
 * Punto de entrada único del widget: recibe cada mensaje del visitante y
 * devuelve el texto de respuesta. No conoce nada de WhatsApp Cloud API ni
 * de Redis directamente — delega todo en los flujos compartidos existentes.
 */
export async function processWidgetMessage(
  sessionId: string,
  userMessage: string,
  clientId: string,
  escalationPhoneNumber?: string
): Promise<WidgetChatResult> {
  const logger = createConversationLogger(sessionId, clientId, 'widget_chat')

  try {
    // ── Flujo de paciente nuevo ya activo ──────────────────────────────────
    if (await isNewPatientFlowActive(sessionId)) {
      const result = await handleNewPatientMessage(sessionId, userMessage, clientId, escalationPhoneNumber)
      return finalizeResult(result)
    }

    // ── Flujo de paciente existente ya activo ──────────────────────────────
    if (await isExistingPatientFlowActive(sessionId)) {
      const result = await handleExistingPatientMessage(sessionId, userMessage, clientId, escalationPhoneNumber)
      return finalizeResult(result)
    }

    // ── Sin flujo activo: el mensaje debería ser el DNI ────────────────────
    const dni = extractDNI(userMessage)
    if (!dni) {
      return { handled: true, message: WELCOME_ASK_DNI }
    }

    logger.info('DNI recibido en widget, validando paciente', {})
    const clinicAPI = new ClinicAPI(clientId)
    const patientResponse = await clinicAPI.paciente_dni(dni)

    if (!patientResponse.exito || !patientResponse.datos) {
      // No encontrado → paciente nuevo
      const result = await initializeNewPatientFlow(dni, sessionId, clientId, false, userMessage, 'widget')
      return finalizeResult(result)
    }

    // Encontrado → paciente existente. Normalizar campos (misma lógica usada en
    // lib/whatsapp.tsx para el flujo de familiar por DNI — la API responde en
    // formatos ligeramente distintos según el caso).
    const patientData = patientResponse.datos as any
    let patient: any
    if (patientData.paciente) {
      patient = patientData.paciente
    } else if (patientData.warning === 'pacientes_multiples' && Array.isArray(patientData.pacientes) && patientData.pacientes.length > 0) {
      // Por DNI no debería haber ambigüedad real; por las dudas, tomamos el primero.
      patient = patientData.pacientes[0]
    } else if (Array.isArray(patientData) && patientData.length > 0) {
      patient = patientData[0]
    } else {
      patient = patientData
    }

    const patientId = patient.paciente_id || patient.Id || patient.id || ''
    const patientFirstName = (patient.Nombres || patient.nombres || '').trim()
    const patientLastName = (patient.Apellido || patient.apellido || '').trim()
    const patientName = `${patientFirstName} ${patientLastName}`.trim()
    const patientDNI = (patient.Nrodoc || patient.dni || dni).toString()
    const patientEmailRaw = (patient.Mail || patient.mail || patient.Email || patient.email || '').trim()
    const patientEmail = patientEmailRaw === '-' || patientEmailRaw === 'NO USA' ? '' : patientEmailRaw
    const patientCelular = (patient.Celular || patient.celular || patient.Telefono || patient.telefono || '').trim()
    const obraSocialId = (patient.Deudor_Id || patient.deudor_id || '').toString().trim()
    const obraSocialNombre = (patient.Deudor_Nombre || patient.deudor_nombre || '').toString().trim()

    const result = await initializeExistingPatientFlow(
      sessionId,
      patientId,
      patientName,
      patientDNI,
      patientEmail || undefined,
      clientId,
      {
        patientFirstName,
        patientLastName,
        obraSocialId,
        obraSocialNombre,
        // IMPORTANTE: acá `sessionId` es anónimo (web_...), no un teléfono real —
        // pasamos el que ya tiene la clínica en su ficha para que la reserva (y
        // futuros recordatorios) usen el número correcto, no el sessionId.
        patientCelular: patientCelular || undefined,
      },
      escalationPhoneNumber,
      userMessage
    )

    return finalizeResult(result)
  } catch (error) {
    logger.error('Error procesando mensaje del widget', error as Error)
    return { handled: true, message: GENERIC_FALLBACK_MESSAGE }
  }
}

/**
 * Normaliza el resultado de cualquiera de los dos flujos a un mensaje de texto plano.
 * Cubre los casos: mensaje normal, flag directPacienteNuevo/Existente apagado
 * (shouldCallOpenAI true, sin pipeline de IA de respaldo en el widget), y
 * 'back_to_main_menu' (el visitante llegó al principio del flujo y pidió volver).
 */
function finalizeResult(result: {
  handled: boolean
  message?: string
  action?: string
  shouldCallOpenAI?: boolean
}): WidgetChatResult {
  if (result.action === 'back_to_main_menu') {
    return { handled: true, message: WELCOME_ASK_DNI }
  }
  if (result.shouldCallOpenAI && !result.message) {
    return { handled: true, message: FEATURE_DISABLED_MESSAGE }
  }
  return {
    handled: true,
    message: result.message || GENERIC_FALLBACK_MESSAGE,
    reserved: result.action === 'turno_reservado',
  }
}
