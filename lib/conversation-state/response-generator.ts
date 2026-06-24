/**
 * Response Generator (Sprint 52)
 *
 * Genera respuestas en lenguaje natural y empático usando GPT-4o-mini.
 * En lugar de templates fijos, recibe datos estructurados (qué comunicar)
 * y produce texto que suena a una persona del equipo administrativo de la clínica.
 *
 * Principios:
 *   - El tono es cálido, profesional, argentino informal (vos, tuteo)
 *   - Nunca inventa datos médicos ni responde consultas médicas
 *   - Siempre tiene un fallback al template original (si GPT falla)
 *   - Incluye historial conversacional para mantener coherencia de tono
 *   - Temperatura 0.4 (algo de variación natural, sin perder consistencia)
 */

import { openai } from '@/lib/openai'
import { formatHistoryForPrompt, type ConversationMessage } from './conversation-history'

// ============================================================================
// TIPOS DE RESPUESTA
// ============================================================================

export type ResponseType =
  | 'bienvenida_paciente_nuevo'
  | 'pedir_nombre'
  | 'pedir_dni'
  | 'pedir_obra_social'
  | 'pedir_email'
  | 'confirmar_datos'
  | 'turno_confirmado'
  | 'turno_cancelado'
  | 'sin_turnos_disponibles'
  | 'derivacion_telefonica'
  | 'despedida'

export interface ResponseContext {
  type: ResponseType
  /** Template fallback — siempre se usa si GPT falla */
  fallback: string
  /** Datos estructurados adicionales para enriquecer la respuesta */
  data?: Record<string, string | undefined>
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `Sos parte del equipo administrativo de una clínica médica. Respondés mensajes de WhatsApp de pacientes.

Reglas ESTRICTAS:
- Nunca respondas preguntas médicas (síntomas, diagnósticos, medicamentos, tratamientos). Para eso derivá al médico.
- Nunca inventes turnos, profesionales, precios ni disponibilidad.
- Usá "vos" y tuteo argentino informal pero educado.
- Sé conciso: máximo 3-4 oraciones. No repitas lo que ya dijiste antes.
- Usá *negritas* para resaltar datos importantes (nombre, fecha, hora).
- No uses emojis en exceso (máximo 1 por mensaje, solo si es natural).
- No empieces con "¡Hola!" si ya sabes el nombre del paciente.
- Mantené calidez humana: reconocé cuando el paciente tuvo que esperar, agradecer, etc.
- El mensaje debe sonar como lo escribió un humano, no un bot.`

// ============================================================================
// GENERACIÓN
// ============================================================================

/**
 * Genera una respuesta humanizada basada en el contexto estructurado.
 * Si GPT falla (error, timeout, etc.), retorna el template fallback.
 *
 * @param context - Qué comunicar y con qué datos
 * @param history - Historial de la conversación (para tono y coherencia)
 * @returns Texto listo para enviar al paciente
 */
export async function generateResponse(
  context: ResponseContext,
  history: ConversationMessage[] = []
): Promise<string> {
  try {
    const historyContext = formatHistoryForPrompt(history, 6)

    const userPrompt = buildUserPrompt(context, historyContext)

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]
    })

    const generated = response.choices[0]?.message?.content?.trim()
    if (!generated) return context.fallback

    return generated
  } catch (error) {
    console.error('[RESPONSE-GENERATOR] GPT generation failed, using fallback:', error)
    return context.fallback
  }
}

// ============================================================================
// CONSTRUCCIÓN DEL PROMPT POR TIPO
// ============================================================================

function buildUserPrompt(context: ResponseContext, historyContext: string): string {
  const d = context.data || {}
  const history = historyContext ? `\nConversación previa:\n${historyContext}\n` : ''

  switch (context.type) {
    case 'bienvenida_paciente_nuevo':
      return `${history}
El paciente escribe por primera vez. No tenemos sus datos registrados.
Dales la bienvenida y pediles que escriban su *nombre y apellido completo* para registrarlos.
${d.esFamiliar === 'true' ? 'El turno es para un familiar, no para quien escribe.' : ''}
Sé cálido pero directo.`

    case 'pedir_nombre':
      return `${history}
Necesitamos el nombre completo del paciente para continuar.
${d.esFamiliar === 'true' ? 'El turno es para un familiar.' : ''}
Pedí el nombre y apellido completo de forma natural.`

    case 'pedir_obra_social':
      return `${history}
El paciente ${d.nombre ? `se llama *${d.nombre}*` : ''}.
Necesitamos saber su obra social o prepaga.
${d.esFamiliar === 'true' ? 'El turno es para un familiar.' : ''}
Pedísela de forma amable, aclarando que también puede ser "Particular" si no tiene cobertura.`

    case 'pedir_email':
      return `${history}
El paciente ${d.nombre ? `*${d.nombre}*` : ''} eligió el turno.
Necesitamos su correo electrónico para enviarle la confirmación.
${d.esFamiliar === 'true' ? 'Es para el familiar.' : ''}
Pedíselo brevemente.`

    case 'confirmar_datos':
      return `${history}
Mostrá al paciente un resumen de los datos del turno y pedí confirmación.
Datos del turno:
- Paciente: *${d.paciente || ''}*
- Profesional: *${d.profesional || ''}*
- Fecha y hora: *${d.fecha || ''} ${d.hora || ''}*
- Sede: *${d.sede || ''}*
- Obra social: *${d.obra_social || ''}*
${d.email ? `- Email: *${d.email}*` : ''}
Preguntá si quiere confirmar o prefiere cambiar algo.`

    case 'turno_confirmado':
      return `${history}
El turno fue confirmado exitosamente.
Datos:
- Profesional: *${d.profesional || ''}*
- Fecha y hora: *${d.fecha || ''} ${d.hora || ''}*
- Sede: *${d.sede || ''}*
Felicitá al paciente brevemente y recordale la dirección si la tenés.`

    case 'turno_cancelado':
      return `${history}
El turno del paciente fue cancelado.
Profesional: ${d.profesional || ''}, fecha: ${d.fecha || ''}.
Confirmá la cancelación de forma empática y ofrecé ayuda para reagendar si lo desea.`

    case 'sin_turnos_disponibles':
      return `${history}
No hay turnos disponibles para la búsqueda del paciente.
${d.profesional ? `Profesional buscado: ${d.profesional}.` : ''}
${d.especialidad ? `Especialidad: ${d.especialidad}.` : ''}
${d.sede ? `Sede: ${d.sede}.` : ''}
Comunicalo con empatía y ofrecé alternativas: otro profesional, otra especialidad, o llamar al teléfono de la clínica.`

    case 'derivacion_telefonica':
      return `${history}
Este canal es solo para gestión de turnos.
${d.motivo ? `El paciente preguntó sobre: ${d.motivo}.` : ''}
${d.telefono ? `Teléfono de la clínica: *${d.telefono}*` : ''}
Derivá amablemente sin responder la consulta en sí.`

    case 'despedida':
      return `${history}
El flujo terminó. Despedite del paciente de forma cálida y breve.
${d.nombre ? `Su nombre es *${d.nombre}*.` : ''}
No más de 2 oraciones.`

    default:
      return context.fallback
  }
}

// ============================================================================
// HELPERS PARA USO RÁPIDO
// ============================================================================

/**
 * Genera bienvenida para paciente nuevo
 */
export async function generateWelcomeMessage(
  esFamiliar: boolean,
  history: ConversationMessage[]
): Promise<string> {
  return generateResponse({
    type: 'bienvenida_paciente_nuevo',
    fallback: esFamiliar
      ? `Veo que es la primera vez con nosotros. Para registrar al familiar y agendar un turno, necesito algunos datos.\n\nPor favor, escribí el *nombre y apellido completo* de la persona que va a atenderse.`
      : `Veo que es tu primera vez con nosotros. Para registrarte y agendar un turno, necesito algunos datos.\n\nPor favor, escribí tu *nombre y apellido completo*.`,
    data: { esFamiliar: String(esFamiliar) }
  }, history)
}

/**
 * Genera mensaje pidiendo obra social
 */
export async function generateObraSocialRequest(
  nombre: string | undefined,
  esFamiliar: boolean,
  history: ConversationMessage[]
): Promise<string> {
  return generateResponse({
    type: 'pedir_obra_social',
    fallback: esFamiliar
      ? `Escribí el nombre de la *obra social o prepaga* del familiar (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tiene cobertura.`
      : `Escribí el nombre de tu *obra social o prepaga* (por ejemplo: OSDE, Swiss Medical, PAMI, etc.) o *Particular* si no tenés cobertura.`,
    data: { nombre, esFamiliar: String(esFamiliar) }
  }, history)
}

/**
 * Genera mensaje de despedida
 */
export async function generateFarewellMessage(
  nombre: string | undefined,
  history: ConversationMessage[]
): Promise<string> {
  return generateResponse({
    type: 'despedida',
    fallback: nombre
      ? `¡Hasta pronto, ${nombre}! Que tengas un buen día. Si necesitás algo más, no dudes en escribirnos.`
      : `¡Hasta pronto! Que tengas un buen día. Si necesitás algo más, no dudes en escribirnos.`,
    data: { nombre }
  }, history)
}
