/**
 * Router de intención — Estados piloto: oferta post-template de clínica.
 *
 * - clinica_post_cancel_offer:   tras turno_cancelado_clinica, ofrecimos nuevo turno (1/2).
 * - clinica_post_confirm_followup: tras turno_confirmado_clinica, seguimiento pasivo.
 *
 * Todo el texto que ve el paciente sale de plantilla + datos reales (teléfono del
 * template). El LLM solo clasifica la intención; acá no se inventa nada.
 *
 * ── Preguntar por el motivo no es preguntar cualquier cosa (28/10/2026) ────
 *
 * Había UNA acción, `consulta_no_respondible`, que mezclaba "¿por qué me lo
 * cancelaron?" con "¿cuánto vale la consulta?" —su descripción nombraba
 * "costos" y "coberturas"— y las dos recibían el mismo texto sobre el motivo.
 * El paciente preguntaba el precio y le contestábamos que no sabemos por qué
 * la clínica decidió lo que decidió.
 *
 * Ahora son dos: la del motivo la responde este estado, que es el único que
 * sabe que ese dato no lo tenemos; cualquier otra consulta se cede al pipeline,
 * que tiene la información de la clínica y además recuerda el turno.
 */

import {
  getClinicaFollowupData,
  clearClinicaCancellationOffer,
} from '@/lib/appointment-flow-state'
import type { StateContract, StateContext, StateContextBase, RouterEffect } from '../contract'

const BUTTONS_SI_NO = [
  { id: '1', title: 'Sí, quiero turno' },
  { id: '2', title: 'No, gracias' },
]

/** Mensaje de "no tenemos el motivo" + derivación a la clínica (con o sin re-oferta 1/2). */
function buildUnknownReasonMessage(telefono: string | undefined, withOffer: boolean): string {
  let m = 'No tengo el detalle del motivo por parte de la clínica.'
  m += telefono
    ? ` Para más información podés comunicarte directamente con la clínica al *${telefono}*.`
    : ' Para más información podés comunicarte directamente con la clínica.'
  if (withOffer) {
    m += '\n\nMientras tanto, ¿querés que busquemos un nuevo turno disponible?\n\n1. Sí, quiero un nuevo turno\n2. No, gracias'
  }
  return m
}

// ============================================================================
// ESTADO: oferta post-cancelación (con opciones 1/2)
// ============================================================================

export const clinicaPostCancelOffer: StateContract = {
  id: 'clinica_post_cancel_offer',
  askedPrompt:
    'Se le informó al paciente que la clínica canceló su turno y se le ofreció buscar un nuevo turno: 1) Sí, quiero un nuevo turno; 2) No, gracias.',

  async loadContext(base: StateContextBase): Promise<StateContext | null> {
    const followup = await getClinicaFollowupData(base.phone, base.configId)
    if (!followup || followup.kind === 'confirmed') return null
    return { ...base, data: { kind: 'cancelled', telefonoContacto: followup.telefonoContacto || '' } }
  },

  fastPath(message: string): string | null {
    const t = message.trim()
    if (t === '1') return 'aceptar_nuevo_turno'
    if (t === '2') return 'rechazar_oferta'
    return null
  },

  allowedActions: [
    {
      id: 'aceptar_nuevo_turno',
      description:
        "El paciente acepta buscar/gestionar un nuevo turno. Ej: 'sí', 'dale', 'quiero un turno', 'busquemos otro', 'obvio'.",
    },
    {
      id: 'rechazar_oferta',
      description:
        "El paciente NO quiere gestionar un turno ahora. Ej: 'no', 'no gracias', 'ahora no', 'dejalo'.",
    },
    {
      id: 'consulta_por_el_motivo',
      description:
        "El paciente pregunta POR QUÉ la clínica canceló el turno. Ej: '¿por qué me lo cancelaron?', '¿qué pasó?', 'quiero saber el motivo', '¿cuál fue la razón?'. SÓLO esto: una pregunta sobre otra cosa (precio, cobertura, qué llevar) NO va acá.",
    },
    {
      id: 'otra_consulta',
      description:
        "El paciente pregunta sobre algo que no es el motivo de la cancelación: cuánto sale la consulta, si la cubre su obra social, qué tiene que llevar, dónde queda, si hay que ir en ayunas. Ej: '¿cuánto vale la consulta?', '¿tengo que llevar la derivación?'.",
    },
    {
      id: 'cambiar_intencion',
      description:
        'El paciente cambia de tema y quiere otra gestión no relacionada con esta oferta (confirmar otro turno, consultar datos de otro turno, cancelar otra cosa).',
    },
  ],

  fallbackActionId: 'reofrecer_neutral',

  async execute(actionId: string, _slots, ctx: StateContext): Promise<RouterEffect> {
    // Priorizar el Número de Derivación de la config (ctx.escalationPhone); el del
    // template/estado guardado es solo fallback.
    const telefono = ctx.escalationPhone || (ctx.data.telefonoContacto as string | undefined)

    switch (actionId) {
      case 'aceptar_nuevo_turno':
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return { type: 'init_booking' }

      case 'rechazar_oferta':
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return {
          type: 'send_and_return',
          message: 'Entendido. Si en algún momento querés gestionar un turno, escribime. ¡Hasta pronto!',
        }

      case 'consulta_por_el_motivo':
        // Mantiene el estado (no limpiamos la oferta): responde + vuelve a ofrecer 1/2.
        return {
          type: 'send_and_return',
          message: buildUnknownReasonMessage(telefono, true),
          buttons: BUTTONS_SI_NO,
        }

      case 'otra_consulta':
        // ── No es asunto de este estado (28/10/2026) ────────────────────────
        // Antes esto y la pregunta por el motivo eran la MISMA acción, así que
        // "¿cuánto vale la consulta?" recibía "No tengo el detalle del motivo
        // por parte de la clínica": la respuesta a otra pregunta. El pipeline
        // normal sí sabe contestarla —consulta la información de la clínica y
        // deriva por lo que se preguntó—, así que se le cede.
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return { type: 'clear_state_and_passthrough' }

      case 'cambiar_intencion':
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return { type: 'clear_state_and_passthrough' }

      case 'reofrecer_neutral':
      default:
        // Fallback determinístico: re-ofrecer sin afirmar nada.
        return {
          type: 'send_and_return',
          message: 'Para continuar, respondé *1* (buscar un nuevo turno) o *2* (no, gracias).',
          buttons: BUTTONS_SI_NO,
        }
    }
  },
}

// ============================================================================
// ESTADO: seguimiento post-confirmación (sin opciones 1/2)
// ============================================================================

export const clinicaPostConfirmFollowup: StateContract = {
  id: 'clinica_post_confirm_followup',
  askedPrompt:
    'Se le confirmó al paciente que su turno fue confirmado por la clínica. No hay opciones 1/2; es solo seguimiento.',

  async loadContext(base: StateContextBase): Promise<StateContext | null> {
    const followup = await getClinicaFollowupData(base.phone, base.configId)
    if (!followup || followup.kind !== 'confirmed') return null
    return { ...base, data: { kind: 'confirmed', telefonoContacto: followup.telefonoContacto || '' } }
  },

  allowedActions: [
    {
      id: 'consulta_por_el_motivo',
      description:
        "El paciente pregunta POR QUÉ la clínica confirmó o decidió algo sobre su turno, o qué pasó con él. Ej: '¿por qué me lo confirmaron recién?', '¿qué pasó con mi turno?', 'quiero saber el motivo'. SÓLO esto.",
    },
    {
      id: 'otra_consulta',
      description:
        "El paciente pregunta sobre algo que no es el estado del turno: cuánto sale la consulta, si la cubre su obra social, qué tiene que llevar, si hay que ir en ayunas, dónde queda. Ej: '¿cuánto vale la consulta?', '¿sabés cuánto es la consulta particular?'.",
    },
    {
      id: 'agradecimiento_despedida',
      description: "El paciente agradece o se despide. Ej: 'gracias', 'chau', 'perfecto', 'buenísimo'.",
    },
    {
      id: 'cambiar_intencion',
      description: 'El paciente quiere otra gestión (cancelar, consultar otro turno, sacar un turno nuevo, etc.).',
    },
  ],

  fallbackActionId: 'ceder_pipeline',

  async execute(actionId: string, _slots, ctx: StateContext): Promise<RouterEffect> {
    // Priorizar el Número de Derivación de la config (ctx.escalationPhone); el del
    // template/estado guardado es solo fallback.
    const telefono = ctx.escalationPhone || (ctx.data.telefonoContacto as string | undefined)

    switch (actionId) {
      case 'consulta_por_el_motivo':
        // Deriva a la clínica, sin re-oferta. Mantiene el seguimiento.
        return { type: 'send_and_return', message: buildUnknownReasonMessage(telefono, false) }

      case 'otra_consulta':
        // Ver la nota del estado de arriba: esto no es el motivo, y el
        // pipeline sí sabe responderlo.
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return { type: 'clear_state_and_passthrough' }

      case 'agradecimiento_despedida':
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return {
          type: 'send_and_return',
          message: '¡Gracias a vos! Cualquier cosa que necesites, escribime. 😊',
        }

      case 'cambiar_intencion':
      case 'ceder_pipeline':
      default:
        await clearClinicaCancellationOffer(ctx.phone, ctx.configId)
        return { type: 'clear_state_and_passthrough' }
    }
  },
}
