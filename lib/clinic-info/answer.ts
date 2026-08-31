/**
 * lib/clinic-info/answer.ts
 *
 * Tarea #42 (OBLIGATORIO, pendiente desde el análisis de Fase 0): cuando el
 * paciente elige "Realizar otra consulta" en el menú, el sistema hoy deriva
 * SIEMPRE a un teléfono, incluso cuando la pregunta ya tiene respuesta en la
 * base de conocimiento institucional que la clínica cargó (lib/clinic-info).
 * Es la mayor demanda insatisfecha detectada en el análisis de 349
 * conversaciones reales (27/8/2026).
 *
 * Este módulo intenta responder ANTES de derivar. Diseño deliberadamente
 * conservador:
 * - Nunca inventa: el prompt exige responder EXCLUSIVAMENTE con lo que ya
 *   está en formatClinicInfoForLLM. Si la pregunta no se puede responder con
 *   esos datos, el modelo devuelve el centinela SIN_DATOS y quien llama cae
 *   al mensaje de derivación de siempre — no se toca ese camino.
 * - Nunca reemplaza la derivación: aunque se pueda responder, el mensaje
 *   final (armado por el caller con buildClinicInfoAnswerMessage) sigue
 *   ofreciendo el teléfono de la clínica para lo que falte.
 * - Falla cerrado: cualquier error (red, timeout, sin clinic-info cargada)
 *   devuelve { respondida: false } y el caller usa el comportamiento actual.
 */

import { openai } from '@/lib/openai'
import { getClinicInfo } from '@/lib/db'
import { formatClinicInfoForLLM } from './context'
import { recordDiag, recordDiagSample, DIAG } from '@/lib/diagnostics'

const SIN_DATOS = 'SIN_DATOS'

const SYSTEM_PROMPT = `Sos el asistente virtual de una clínica médica. Un paciente eligió la opción "Realizar otra consulta" en el menú y escribió algo que NO es sobre agendar, cancelar o confirmar un turno.

Tu única fuente de información es el bloque "INFORMACIÓN DE LA CLÍNICA" que te paso a continuación. Reglas estrictas:
- Respondé SOLO si la pregunta se puede contestar con esos datos, tal cual están escritos.
- Nunca inventes ni completes con conocimiento general (horarios, direcciones, obras sociales, profesionales, precios, etc. que no estén en el bloque).
- Si el bloque no alcanza para responder con certeza, respondé EXACTAMENTE: ${SIN_DATOS}
- Si respondés, hacelo en 1 a 3 oraciones, tono cordial, tuteo argentino (vos/tenés), sin saludos ni cortesías largas.`

export interface RespuestaClinicInfo {
  respondida: boolean
  texto?: string
}

/**
 * Intenta responder `userMessage` usando la base de conocimiento del cliente.
 * Devuelve `respondida: false` si no hay clinic-info cargada, si el modelo no
 * pudo responder con esos datos, o ante cualquier error.
 */
export async function answerFromClinicInfo(
  clienteId: string | undefined,
  configId: string,
  userMessage: string,
): Promise<RespuestaClinicInfo> {
  if (!clienteId || !userMessage?.trim()) return { respondida: false }

  try {
    const info = await getClinicInfo(clienteId)
    if (!info) return { respondida: false }

    const bloque = formatClinicInfoForLLM(info)
    if (
      bloque.startsWith('INFORMACIÓN DE LA CLÍNICA: no cargada') ||
      bloque.startsWith('INFORMACIÓN DE LA CLÍNICA: cargada pero sin datos')
    ) {
      return { respondida: false }
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${bloque}\n\nPregunta del paciente: "${userMessage.trim()}"` },
      ],
      temperature: 0,
      max_tokens: 220,
    })

    const texto = response.choices[0]?.message?.content?.trim()

    if (!texto || texto.startsWith(SIN_DATOS)) {
      void recordDiag(configId, DIAG.OTRA_CONSULTA_SIN_RESPUESTA)
      return { respondida: false }
    }

    void recordDiag(configId, DIAG.OTRA_CONSULTA_RESPONDIDA_CLINIC_INFO)
    void recordDiagSample({
      tipo: DIAG.OTRA_CONSULTA_RESPONDIDA_CLINIC_INFO,
      mensaje: userMessage,
      configId,
      detalle: { respuesta: texto.slice(0, 200) },
    })
    return { respondida: true, texto }
  } catch (error) {
    console.error('[CLINIC-INFO] Error respondiendo "otra consulta":', error)
    return { respondida: false }
  }
}
