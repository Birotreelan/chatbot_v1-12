/**
 * Router de intención — Compositor de re-entrada al flujo (humanización).
 *
 * Cuando el paciente hace una consulta/comentario al margen en medio de un flujo,
 * en vez de concatenar "respuesta + transición fija + prompt del paso" (que suena
 * robótico y repite saludos), usamos GPT-4o-mini para redactar UN SOLO mensaje
 * natural y cálido que responde y retoma el paso con fluidez.
 *
 * Garantías:
 * - No inventa datos: solo puede usar la información que se le pasa.
 * - Conserva EXACTAMENTE las opciones numeradas del paso (son la fuente de verdad
 *   de los botones y del handler determinístico).
 * - Timeout duro + fallback: si falla, el caller usa la composición determinística.
 */

import { openai } from '@/lib/openai'

const COMPOSE_TIMEOUT_MS = 3000

export interface ComposeReentryParams {
  /** Respuesta controlada a la consulta (hechos que SÍ podemos decir), o '' si no hay. */
  answer: string
  /** El paso pendiente al que hay que volver (con su pregunta y opciones numeradas). */
  stepPrompt: string
}

const SYSTEM_PROMPT = `Sos Iris, la asistente virtual de una clínica de ojos en Argentina. Hablás en español rioplatense (voseo), de forma cálida, humana y natural, como una recepcionista experta.

El paciente está gestionando un turno e hizo un comentario o consulta al margen del paso actual. Tu tarea es escribir UN SOLO mensaje de WhatsApp que:
1) Responda o reconozca su comentario de forma breve y amable, usando EXCLUSIVAMENTE la información que te doy.
2) Lo retome con naturalidad al paso pendiente, con una transición propia y fluida.

REGLAS ESTRICTAS (no negociables):
- NO inventes NADA: ni datos, ni teléfonos, ni direcciones, ni horarios, ni precios, ni opciones. Si no hay información para su comentario, reconocelo con amabilidad y seguí.
- Del paso pendiente, conservá EXACTAMENTE su pregunta operativa y las opciones numeradas (las líneas que empiezan con "1.", "2.", "3.", "0.", etc.) TAL CUAL, sin cambiar textos ni números ni orden. Podés reescribir el saludo/transición alrededor, pero la lista numerada queda idéntica.
- NO repitas saludos de bienvenida ni muletillas del paso ("Perfecto", "Gracias", "¡Bienvenido!"): reemplazalos por tu propia transición natural.
- Breve, cálido, humano. Sin encabezados ni markdown de títulos. Máximo ~4-5 líneas antes de las opciones.`

export async function composeReentryMessage(params: ComposeReentryParams): Promise<string | null> {
  const { answer, stepPrompt } = params
  if (!stepPrompt || !stepPrompt.trim()) return null

  const userPrompt = `INFORMACIÓN DISPONIBLE PARA RESPONDER SU COMENTARIO (no uses nada fuera de esto):
${answer && answer.trim() ? answer.trim() : '(No tenemos información puntual sobre su comentario. Reconocelo con amabilidad y seguí, sin inventar.)'}

PASO PENDIENTE AL QUE HAY QUE VOLVER (conservá su pregunta y opciones numeradas EXACTAS):
${stepPrompt.trim()}

Escribí el mensaje único, natural y humano.`

  try {
    const completion = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 500,
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('compose_timeout')), COMPOSE_TIMEOUT_MS),
    )
    const res = (await Promise.race([completion, timeout])) as Awaited<typeof completion>
    const text = res.choices[0]?.message?.content?.trim()
    return text && text.length > 0 ? text : null
  } catch {
    return null
  }
}
