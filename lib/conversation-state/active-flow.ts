/**
 * Refactor Paso 2 (18/8/2026) — unifica el cálculo de "¿hay un flujo activo?".
 *
 * Antes de este archivo, la misma pregunta se respondía copiando a mano, en al
 * menos 6 puntos distintos de lib/whatsapp.tsx, la misma combinación de lecturas
 * Redis (isPatientDetectionFlowActive / isExistingPatientFlowActive /
 * isNewPatientFlowActive / isRescheduleFlowActive / getBookingFlowState /
 * getFlowState), con pequeñas variantes según qué interceptor las usaba (por
 * ejemplo, el reagendamiento se incluye para algunos usos y se excluye a propósito
 * para otros porque tiene su propia selección de turno por texto libre). Esas
 * variantes eran legítimas — no es un bug que difieran — pero al estar copiadas a
 * mano en cada sitio, un cambio en una no se propagaba a las demás y podían
 * divergir por accidente.
 *
 * Este módulo no cambia CUÁNDO se calcula el estado (se sigue llamando fresco en
 * cada punto de la cascada de lib/whatsapp.tsx — no se cachea entre interceptores,
 * porque un interceptor anterior puede haber iniciado un flujo nuevo y una
 * instantánea vieja daría un resultado incorrecto). Solo unifica CÓMO se calcula
 * cada variante, en un solo lugar con las diferencias documentadas explícitamente.
 */

import { getFlowState, getClinicaFollowupData } from "../appointment-flow-state"
import { getBookingFlowState } from "./booking-flow-handler"
import { isRescheduleFlowActive } from "./reschedule-flow-integration"
import { isPatientDetectionFlowActive } from "./patient-detection/patient-flow-integration"
import { isExistingPatientFlowActive } from "./existing-patient/existing-patient-flow-integration"
import { isNewPatientFlowActive } from "./new-patient/new-patient-flow-integration"
import { getRedisClient } from "../redis"

export interface ActiveFlowStatus {
  detection: boolean
  existing: boolean
  newPatient: boolean
  reschedule: boolean
  pendingFlowState: boolean
  booking: boolean
  /** Contexto de "oferta de clínica" (post-cancelación/confirmación) — no es un flujo por pasos. */
  clinicaFollowup: boolean

  /**
   * Cualquier flujo "real" de conversación (booking/detección/reagendamiento),
   * sin contar el contexto de clínica. Antes: `hasRealFlow` en whatsapp.tsx.
   */
  hasRealFlow: boolean

  /**
   * Igual a hasRealFlow pero SIN reagendamiento — el reagendamiento tiene su
   * propia selección de turno por texto libre y no debe pasar por el router de
   * intercalada (interceptarlo rompía esa selección). Antes: `hasInterjectionFlow`.
   */
  hasInterjectionFlow: boolean

  /**
   * Los 4 flujos "por pasos" que necesitan que los interceptores Sprint 14/16/17
   * no los pisen con datos del paso mal interpretados como confirmación/consulta.
   * Antes: `stepFlowActiveForPreflows`. A diferencia de hasRealFlow, NO incluye
   * detección de paciente (ese flujo reconstruye su propio menú desde Redis y no
   * necesita esta guarda — incluirlo causó el caso "Liliana" documentado en
   * whatsapp.tsx, ver comentario junto al fallback de re-muestra de paso).
   */
  hasStepFlow: boolean
}

/**
 * Calcula el estado de flujo activo para un paciente, en una sola tanda de
 * lecturas Redis en paralelo (antes: la misma tanda se repetía, secuencial o en
 * paralelo, en cada uno de los ~6 call sites).
 */
export async function resolveActiveFlow(userPhoneNumber: string, configId: string): Promise<ActiveFlowStatus> {
  const [detection, existing, newPatient, reschedule, pendingFlowState, booking, clinicaFollowup] = await Promise.all([
    isPatientDetectionFlowActive(userPhoneNumber),
    isExistingPatientFlowActive(userPhoneNumber),
    isNewPatientFlowActive(userPhoneNumber),
    isRescheduleFlowActive(userPhoneNumber, configId),
    getFlowState(userPhoneNumber, configId),
    getBookingFlowState(userPhoneNumber, configId),
    getClinicaFollowupData(userPhoneNumber, configId),
  ])

  const pendingFlowStateBool = !!pendingFlowState
  const bookingBool = !!booking

  const hasRealFlow = detection || existing || newPatient || reschedule || pendingFlowStateBool || bookingBool
  const hasInterjectionFlow = detection || existing || newPatient || pendingFlowStateBool || bookingBool
  const hasStepFlow = reschedule || existing || newPatient || bookingBool

  return {
    detection,
    existing,
    newPatient,
    reschedule,
    pendingFlowState: pendingFlowStateBool,
    booking: bookingBool,
    clinicaFollowup: !!clinicaFollowup,
    hasRealFlow,
    hasInterjectionFlow,
    hasStepFlow,
  }
}

/**
 * ¿El paciente está en un flujo de asistente especializado de OpenAI (ej.
 * reagendamiento vía Assistants API)? Se guarda aparte en Redis
 * (`specialized_assistant_active:*`) porque es un mecanismo del camino legacy,
 * no del AI Dispatcher — se mantiene como función separada en vez de meterlo
 * dentro de ActiveFlowStatus para no mezclar dos sistemas distintos bajo el mismo
 * objeto, pero vive acá para que quede documentado junto al resto de "flujo activo".
 */
export async function isSpecializedAssistantFlowActive(userPhoneNumber: string, configId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  const value = await redis.get(`specialized_assistant_active:${configId}:${userPhoneNumber}`)
  return !!value
}
