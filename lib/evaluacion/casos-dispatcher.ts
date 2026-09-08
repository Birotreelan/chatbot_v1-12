/**
 * lib/evaluacion/casos-dispatcher.ts
 *
 * Casos etiquetados para evaluar el AI DISPATCHER (la capa que decide QUÉ
 * acción toma el sistema), a diferencia de `corpus.ts`, que evalúa la capa de
 * reglas determinísticas.
 *
 * ── Por qué hace falta ────────────────────────────────────────────────────
 *
 * El corpus de reglas es gratis y determinístico, así que corre en cada build.
 * El dispatcher no: cada caso es una llamada real a la API, con costo y con
 * variabilidad. Por eso esto NO es un archivo .test.ts y no corre en `pnpm
 * test` — se ejecuta a mano con `pnpm eval:dispatcher` cuando se cambia el
 * prompt, el modelo o el manifiesto de tools.
 *
 * Sin esto, cambiar de modelo (o reordenar el prompt, como el 7/9/2026) es un
 * cambio a ciegas sobre el componente que decide si se cancela el turno médico
 * de alguien: no hay forma de saber si mejoró o empeoró hasta que se queje un
 * paciente.
 *
 * ── Qué es un caso ────────────────────────────────────────────────────────
 *
 * Un mensaje NO alcanza: el dispatcher decide mirando el contexto. "1" puede
 * ser confirmar una cancelación, elegir una sede o pedir un turno, según qué
 * se le preguntó antes. Por eso cada caso lleva su contexto.
 *
 * ── Cómo elegir el `esperado` ─────────────────────────────────────────────
 *
 * Solo se etiquetan casos donde la acción correcta es defendible sin
 * ambigüedad. Si dos tools son razonables para el mismo mensaje, el caso no
 * sirve como test: mide el gusto de quien lo escribió, no la calidad del
 * sistema. Ante la duda, se deja afuera.
 */

import type { CirugiaSnapshot, DispatcherContext, TurnoSnapshot } from '../conversation-state/ai-dispatcher/context-builder'
import { TOOL_NAMES, type ToolName } from '../conversation-state/ai-dispatcher/tool-manifest'

export interface CasoDispatcher {
  /** Mensaje del paciente, tal como llegó (typos incluidos). */
  mensaje: string
  /** Tool que el dispatcher debería elegir. */
  esperado: ToolName
  /**
   * 'regresion' → ya falló con un paciente real; volver a fallar es reintroducir
   *               un bug conocido.
   * 'cobertura' → comportamiento correcto que queremos que no se rompa.
   */
  tipo: 'regresion' | 'cobertura'
  origen: 'produccion' | 'sintético'
  /** Contexto en el que llegó el mensaje (se completa con los defaults de `contexto()`). */
  ctx: DispatcherContext
  nota?: string
}

// ---------------------------------------------------------------------------
// Helpers para armar contextos sin repetir 12 campos en cada caso
// ---------------------------------------------------------------------------

const TURNO_PROXIMO: TurnoSnapshot = {
  fecha: '2026-09-09',
  hora: '12:30',
  profesional: 'LOPEZ RODRIGUEZ KATLHEEN',
  sede: 'Vision Salud - Canning',
  estado: 'No confirmado',
}

const TURNO_CONFIRMADO: TurnoSnapshot = { ...TURNO_PROXIMO, estado: 'Confirmado' }

/**
 * Turno del caso Etcheverria. Va aparte porque el mensaje del paciente nombra a
 * SU profesional: si el contexto trae otro, el caso deja de medir lo que dice
 * medir (7/9/2026 — la primera versión usaba el turno genérico, con otra
 * profesional, y que el modelo derivara ante esa contradicción era razonable;
 * el caso estaba mal armado, no el dispatcher).
 */
const TURNO_CIRUGIA: TurnoSnapshot = {
  fecha: '2026-09-08',
  hora: '10:00',
  profesional: 'ETCHEVERRIA',
  sede: 'Vision Salud - Canning',
  estado: 'Confirmado',
}

/**
 * Cirugía real de María García, copiada de la respuesta de get_paciente
 * verificada el 8/9/2026. Se usa el dato real, con los nombres de campo reales,
 * porque la primera versión de este fixture asumía que una cirugía tenía la
 * misma forma que un turno médico (profesional/sede) — y no la tiene.
 *
 * `observ` de la API queda deliberadamente afuera: son notas clínicas internas.
 */
const CIRUGIA_MARIA: CirugiaSnapshot = {
  fecha: '2026-09-09',
  hora: '08:30:00',
  cirugia: 'OI - EXTRACCION DEL CRISTALINO POR FACOEMULSIFICACION DE CATARATAS (FACO)',
  cirujano: 'BLOCK GLYN',
  estado: 'Programada',
}

/** Arma un DispatcherContext completo a partir de lo poco que cambia por caso. */
function contexto(over: Partial<DispatcherContext> = {}): DispatcherContext {
  const activeFlow = over.activeFlow ?? { type: 'none' as const, phase: 'none', description: 'No hay flujo activo' }
  return {
    patient: { identified: false, phone: '1100000000' },
    turnos: [],
    turnosQx: [],
    activeFlow,
    hasActiveFlow: activeFlow.type !== 'none',
    conversationHistory: '',
    rawAppointmentContext: null,
    clinicInfo: null,
    templatePendingConfirmation: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// CASOS
// ---------------------------------------------------------------------------

export const CASOS_DISPATCHER: CasoDispatcher[] = [
  // ── Regresiones: casos que rompieron con pacientes reales ────────────────

  {
    mensaje: '9390322 rosa mattos',
    esperado: TOOL_NAMES.CONTINUAR_FLUJO,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      activeFlow: {
        type: 'patient_detection',
        phase: 'awaiting_dni_for_disambiguation',
        description:
          'El teléfono tiene VARIOS pacientes asociados y se le pidió el DNI para saber cuál es. ' +
          'Un documento suelto, o un documento con su nombre, ES la respuesta esperada a esa pregunta',
      },
      ultimaPregunta: 'Para poder identificarte, ¿me pasás tu DNI?',
    }),
    nota:
      'Caso Rosa Mattos (tel. 1162028924, 7/9/2026). Mandó el DNI junto con su nombre — ' +
      'la forma más natural de contestar — y el sistema lo leyó como un pedido de menú, ' +
      'descartó el dato y volvió al principio.',
  },

  {
    mensaje: 'Lunes 14. 11:15',
    esperado: TOOL_NAMES.CONTINUAR_FLUJO,
    tipo: 'cobertura',
    origen: 'produccion',
    ctx: contexto({
      activeFlow: {
        type: 'reschedule',
        phase: 'awaiting_selection',
        description: 'Se le está pidiendo que elija uno de los turnos disponibles para reagendar',
      },
      ultimaPregunta:
        'Respondé con el *número* del turno que preferís.\n\n*Lunes 14 de septiembre*\n  7. 11:15\n  8. 12:00',
    }),
    nota: 'Caso Daniela Yusti (tel. 2226449138, 7/9/2026). Eligió por día y hora en vez de por número.',
  },

  {
    mensaje: '5/10 15 hs.',
    esperado: TOOL_NAMES.CONTINUAR_FLUJO,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      activeFlow: {
        type: 'reschedule',
        phase: 'awaiting_selection',
        description: 'Se le está pidiendo que elija uno de los turnos disponibles para reagendar',
      },
      ultimaPregunta: 'Respondé con el *número* del turno que preferís.\n\n0. *Volver al paso anterior*',
    }),
    nota:
      'Caso Ives (31/8/2026). El reagendamiento no figuraba como flujo activo en el contexto, ' +
      'así que el modelo mandaba al menú principal y se perdía la lista de turnos.',
  },

  {
    mensaje: 'Si es posible ?',
    esperado: TOOL_NAMES.CONTINUAR_FLUJO,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      activeFlow: {
        type: 'decision_pendiente',
        phase: 'awaiting_cancel_and_reschedule_confirm',
        description: 'Se le mostró un menú para decidir entre confirmar la asistencia o cancelar y pedir otro turno',
      },
      turnos: [TURNO_PROXIMO],
      ultimaPregunta: '1- Sí, cancelar y ver otras fechas\n2- No, mantener el turno y confirmar asistencia.',
    }),
    nota:
      'Caso Guemes (tel. 2214001402, 1/9/2026). Es una afirmación con signo de pregunta, no una consulta: ' +
      'el "?" no define la intención.',
  },

  {
    mensaje: '1',
    esperado: TOOL_NAMES.CONTINUAR_FLUJO,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      activeFlow: {
        type: 'decision_pendiente',
        phase: 'awaiting_cancel_and_reschedule_confirm',
        description: 'Se le mostró un menú para decidir entre confirmar la asistencia o cancelar y pedir otro turno',
      },
      turnos: [TURNO_PROXIMO],
      templatePendingConfirmation: true,
      ultimaPregunta:
        'Gracias por tu mensaje. Para confirmar, ¿asistirás al siguiente turno?\n\n' +
        '📅 10/09/2026 a las 11:30\n👨‍⚕️ SOBRINO CLAUDIA\n📍 San Cristobal\n\n1- Sí, confirmo\n2- No, quiero cancelar',
    }),
    nota:
      'Caso Roberto Brullo (tel. 1151144710, 8/9/2026). El bot le preguntó "1- Sí, confirmo / ' +
      '2- No, quiero cancelar", contestó "1" y recibió el menú de bienvenida: la rama ask_explicit ' +
      'hacía la pregunta sin guardar ningún estado, así que nadie sabía a qué respondía ese "1". ' +
      'Se arregló guardando el estado; este caso cubre la otra mitad — que el dispatcher tampoco ' +
      'se lo lleve al menú si algún día llega hasta él.',
  },

  {
    mensaje: 'Si mucha gracias',
    esperado: TOOL_NAMES.CONFIRMAR_ASISTENCIA,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      turnos: [TURNO_PROXIMO],
      templatePendingConfirmation: true,
      ultimaPregunta:
        'Le recordamos que tiene un turno el 09/09/2026 a las 12:30. Por favor, confirme o cancele su asistencia.',
    }),
    nota:
      'Caso Vicente (tel. 1139200357, 19/8/2026). Sin la pregunta a la vista es cortesía; ' +
      'con el recordatorio pendiente a la vista es, claramente, un sí.',
  },

  {
    mensaje: 'Muchas gracias',
    esperado: TOOL_NAMES.RESPUESTA_EMPATICA,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      turnos: [TURNO_CONFIRMADO],
      templatePendingConfirmation: true,
    }),
    nota:
      'Caso Amalia Gimenez (tel. 2234557171, 7/9/2026). Contracara del anterior: el turno YA está ' +
      'confirmado, así que agradecer no es volver a confirmar. Volver a pedirle confirmación la ' +
      'hace dudar de si el turno quedó tomado.',
  },

  {
    mensaje: 'Necesito saber el horario de mi cirugía de mañana con el.dr.Etcheverria. gracias',
    esperado: TOOL_NAMES.CONSULTA_INFORMATIVA,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({ turnos: [TURNO_CIRUGIA] }),
    nota:
      'Caso Etcheverria (tel. 1140724398, 7/9/2026). En producción el contexto llegaba con turnos=0 ' +
      '(nunca se consultaba al backend por teléfono) y el bot respondía "cuando tengas tu turno ' +
      'agendado vas a poder elegir el horario" a alguien que se operaba al día siguiente. ' +
      'Este caso verifica la otra mitad: CON el turno en contexto, tiene que informarlo. ' +
      'Preguntar la hora del propio turno es una consulta informativa, no una consulta médica: ' +
      'que el turno sea una cirugía no la convierte en una pregunta clínica.',
  },

  {
    mensaje: 'Buenos dias nuevamente, Natalia no puede llegar por un inconveniente que le surgió camino al lugar',
    esperado: TOOL_NAMES.CANCELAR_TURNO,
    tipo: 'cobertura',
    origen: 'produccion',
    ctx: contexto({ turnos: [TURNO_CONFIRMADO] }),
    nota:
      'Caso Natalia (tel. 1140784331, 7/9/2026). Un tercero avisa que la paciente no llega, ' +
      'sin usar la palabra "cancelar".',
  },

  {
    mensaje: 'Tengo cirugía el nueve de septiembre,',
    esperado: TOOL_NAMES.CONSULTA_INFORMATIVA,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      turnos: [TURNO_CONFIRMADO],
      turnosQx: [CIRUGIA_MARIA],
    }),
    nota:
      'Caso María García (tel. 1133550488, 8/9/2026). Avisó que tenía una cirugía el día ANTERIOR ' +
      'a su turno y recibió el bloque de "no puedo brindarte información médica": la palabra ' +
      '"cirugia" decidía sola con confianza 0.95. Un turno quirúrgico agendado es un dato, no una ' +
      'consulta clínica. Con la cirugía en contexto, corresponde confirmarle los datos.',
  },

  {
    mensaje: 'Discúlpame para Elsa Silva?',
    esperado: TOOL_NAMES.CONSULTA_INFORMATIVA,
    tipo: 'regresion',
    origen: 'produccion',
    ctx: contexto({
      patient: { identified: false, name: 'ELSA SILVA', dni: '5716515', phone: '1141898093' },
      turnos: [TURNO_CONFIRMADO],
      templatePendingConfirmation: true,
    }),
    nota:
      'Caso Elsa Silva (tel. 1141898093, 8/9/2026). Preguntó si el turno era para Elsa Silva —el ' +
      'nombre correcto del titular— y el sistema le respondió "parece que te has confundido de ' +
      'número". El titular venía en el Chatbot_Data y nunca se le mostraba al modelo. Decirle a ' +
      'alguien que se equivocó de número cuando preguntó por el nombre correcto lo empuja a ' +
      'ignorar un turno que sí es suyo.',
  },

  // ── Cobertura: comportamiento correcto que no queremos romper ────────────

  {
    mensaje: 'acá no vive ninguna Elsa, se equivocaron de número',
    esperado: TOOL_NAMES.DERIVAR_CONSULTA,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({
      patient: { identified: false, name: 'ELSA SILVA', dni: '5716515', phone: '1141898093' },
      turnos: [TURNO_CONFIRMADO],
      templatePendingConfirmation: true,
    }),
    nota:
      'Contracara del anterior: mostrarle el nombre del titular al modelo no puede hacer que deje ' +
      'de reconocer un número REALMENTE equivocado. Acá la persona niega explícitamente conocerla.',
  },


  {
    mensaje: '¿la cirugía es riesgosa? me da miedo',
    esperado: TOOL_NAMES.DERIVAR_CONSULTA,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({
      turnos: [TURNO_CONFIRMADO],
      turnosQx: [CIRUGIA_MARIA],
    }),
    nota:
      'Contracara del caso anterior: sacar "cirugia" de las señales médicas inequívocas NO puede ' +
      'abrir la puerta a que el bot opine sobre riesgos quirúrgicos. Acá la palabra viene en una ' +
      'pregunta clínica real y tiene que derivar.',
  },


  {
    mensaje: 'tengo que estar en ayunas?',
    esperado: TOOL_NAMES.DERIVAR_CONSULTA,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({ turnos: [TURNO_PROXIMO] }),
    nota:
      'El prompt marca esto como error grave: responderlo con respuesta_empatica sería inventar ' +
      'una indicación médica. Suena casual y breve, y esa es justamente la trampa.',
  },

  {
    mensaje: 'se podrá ir un poco mas tarde tipo 12:50?',
    esperado: TOOL_NAMES.DERIVAR_CONSULTA,
    tipo: 'cobertura',
    origen: 'produccion',
    ctx: contexto({ turnos: [TURNO_CONFIRMADO] }),
    nota:
      'Caso Jose Ibarra (tel. 1158352441, 7/9/2026). Si la clínica puede esperarlo depende de su ' +
      'agenda real, que el bot no conoce: no es una consulta informativa sobre el turno ni algo ' +
      'que podamos responder solos.',
  },

  {
    mensaje: 'quiero hablar con una persona',
    esperado: TOOL_NAMES.SOLICITAR_HUMANO,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({ turnos: [TURNO_PROXIMO] }),
  },

  {
    mensaje: 'Hola, buenos días',
    esperado: TOOL_NAMES.MOSTRAR_MENU,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto(),
    nota: 'Saludo solo, sin intención: menú. No confundir con el saludo + agradecimiento.',
  },

  {
    mensaje: 'necesito un turno con oftalmología',
    esperado: TOOL_NAMES.INICIAR_RESERVA,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto(),
  },

  {
    mensaje: 'quiero cambiar la fecha del turno',
    esperado: TOOL_NAMES.CANCELAR_Y_REAGENDAR,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({ turnos: [TURNO_PROXIMO] }),
    nota: 'Reagendar NO es cancelar a secas: el paciente quiere seguir atendiéndose.',
  },

  {
    mensaje: 'gracias, nada más por ahora',
    esperado: TOOL_NAMES.FINALIZAR,
    tipo: 'cobertura',
    origen: 'sintético',
    ctx: contexto({ turnos: [TURNO_PROXIMO] }),
  },
]
