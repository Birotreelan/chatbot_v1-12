/**
 * AI Dispatcher — Tool Manifest (Sprint 60)
 *
 * Define cada capacidad del sistema como un GPT function/tool.
 * El LLM lee estas descripciones para saber cuándo usar cada una.
 *
 * Principio de diseño:
 * - Cada tool = una acción que el sistema puede ejecutar de forma determinística
 * - Las descripciones son precisas para minimizar ambigüedad
 * - Los parámetros solo incluyen lo que el handler realmente necesita
 * - Siempre hay un tool de "fallback" para casos edge
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions'

// ============================================================================
// NOMBRES DE TOOLS (constantes para evitar typos en el executor)
// ============================================================================

export const TOOL_NAMES = {
  MOSTRAR_MENU:              'mostrar_menu_principal',
  CONFIRMAR_ASISTENCIA:      'confirmar_asistencia_turno',
  CANCELAR_TURNO:            'cancelar_turno',
  CANCELAR_Y_REAGENDAR:      'cancelar_y_solicitar_nuevo_turno',
  INICIAR_RESERVA:           'iniciar_reserva_turno',
  CONSULTA_INFORMATIVA:      'responder_consulta_informativa',
  DERIVAR_CONSULTA:          'derivar_consulta_externa',
  RESPUESTA_EMPATICA:        'respuesta_empatica',
  CONTINUAR_FLUJO:           'continuar_flujo_activo',
} as const

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES]

// ============================================================================
// MANIFEST COMPLETO
// ============================================================================

export const DISPATCHER_TOOLS: ChatCompletionTool[] = [

  // ── Menú principal ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.MOSTRAR_MENU,
      description: `Muestra el menú principal de bienvenida al paciente.
Usá este tool cuando:
- El paciente saluda ("Hola", "Buenos días") sin una intención clara.
- El mensaje es ambiguo y no encaja en ninguna otra acción.
- El paciente pide "volver al inicio" o "menú".
- No hay turno activo y el paciente escribe algo genérico.
NO usarlo si ya hay un flujo activo con intención clara.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Confirmar asistencia ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.CONFIRMAR_ASISTENCIA,
      description: `El paciente confirma que asistirá a su turno médico.
Usá este tool cuando el mensaje indica afirmación o intención de ir:
"Sí voy", "Confirmo", "Ahí estaré", "Dale", "Ok", "Confirmar mi asistencia".
Solo usarlo si hay un turno próximo con estado "No confirmado".
Si el turno YA está confirmado, NO usar este tool.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Cancelar turno ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.CANCELAR_TURNO,
      description: `El paciente quiere cancelar su turno médico.
Usá este tool ante expresiones de cancelación:
"No puedo ir", "Cancelo", "Necesito cancelar", "No voy a poder asistir".
También cuando dice que tuvo un imprevisto, enfermedad, viaje, etc.
que le impide asistir. Mostrará un menú de confirmación de cancelación.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Cancelar y solicitar nuevo ─────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.CANCELAR_Y_REAGENDAR,
      description: `El paciente quiere cancelar su turno actual y obtener uno nuevo.
Usá este tool cuando pide cambiar la fecha, reagendar, o cancelar para agendar otro:
"Quiero otro horario", "Cambiar la fecha", "Reagendar", "Necesito otro turno".
Cancelará el turno actual e iniciará el flujo de reserva.`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Iniciar reserva de turno ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.INICIAR_RESERVA,
      description: `El paciente quiere agendar un nuevo turno médico (adicional o sin turno previo).
Usá este tool cuando:
- Pide un turno para una especialidad: "Necesito turno para el oftalmólogo".
- Quiere un turno adicional (no en lugar del actual).
- No tiene turnos y quiere agendar: "Quiero sacar un turno".
Iniciará el flujo de reserva completo (sede → especialidad/médico → turno → confirmación).`,
      parameters: {
        type: 'object',
        properties: {
          profesional_mencionado: {
            type: 'string',
            description: 'Nombre del médico/profesional que mencionó el paciente, si lo hay. Dejar vacío si no mencionó ninguno.',
          },
          especialidad_mencionada: {
            type: 'string',
            description: 'Especialidad médica mencionada (ej: "oftalmología", "cardiología"). Dejar vacío si no mencionó ninguna.',
          },
        },
        required: [],
      },
    },
  },

  // ── Consulta informativa sobre turno ──────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.CONSULTA_INFORMATIVA,
      description: `El paciente pregunta por datos de su turno próximo.
Usá este tool para preguntas como:
"¿A qué hora es?", "¿Dónde queda?", "¿Con quién es el turno?", "¿Cuál es la dirección?".
Solo responde información que ya tenemos del turno. No inventes datos.`,
      parameters: {
        type: 'object',
        properties: {
          aspecto: {
            type: 'string',
            enum: ['hora', 'fecha', 'profesional', 'sede', 'direccion', 'general'],
            description: 'Qué aspecto del turno está preguntando el paciente.',
          },
        },
        required: ['aspecto'],
      },
    },
  },

  // ── Derivar consulta externa ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.DERIVAR_CONSULTA,
      description: `El paciente pregunta algo que este bot no puede responder.
Usá este tool para:
- Consultas administrativas: costos, coberturas, documentación, pagos.
- Consultas médicas: síntomas, medicamentos, diagnósticos, tratamientos.
- Cualquier consulta fuera del scope de gestión de turnos.
Redirigirá al teléfono de la clínica.`,
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['administrativa', 'medica', 'otro'],
            description: 'Tipo de consulta que no podemos responder.',
          },
        },
        required: ['tipo'],
      },
    },
  },

  // ── Respuesta empática ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.RESPUESTA_EMPATICA,
      description: `El paciente expresa una emoción, queja o situación personal que no requiere acción inmediata.
Usá este tool para:
- Quejas sobre el servicio: "Estuve llamando horas y nadie atendía".
- Explicaciones de contexto: "Estuve internada", "Me surgió un viaje".
- Agradecimientos: "Muchas gracias", "Muy amable".
- Despedidas: "Hasta luego", "Chau".
Responde con empatía y sin iniciar ningún flujo.`,
      parameters: {
        type: 'object',
        properties: {
          respuesta: {
            type: 'string',
            description: 'Respuesta empática breve en español rioplatense (1-2 oraciones). Sin tuteo — usar voseo. Sin mencionar acciones que no podemos hacer.',
          },
        },
        required: ['respuesta'],
      },
    },
  },

  // ── Continuar flujo activo ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: TOOL_NAMES.CONTINUAR_FLUJO,
      description: `El paciente está en medio de un flujo activo y su mensaje es una respuesta válida a lo que se le preguntó.
Usá este tool cuando:
- Hay un flujo activo (reserva, selección de sede, etc.) Y
- El mensaje del paciente es una respuesta directa al paso actual (número, nombre, email, sí/no).
Este tool le pasa el mensaje al handler determinístico del flujo activo.
NO usar si el paciente claramente cambió de intención (quiere cancelar en lugar de continuar la reserva).`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]
