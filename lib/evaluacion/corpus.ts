/**
 * lib/evaluacion/corpus.ts
 *
 * Corpus de evaluación de comprensión del lenguaje (1/9/2026).
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Hasta ahora los problemas de comprensión se descubrían de a uno, en
 * producción, cuando un paciente quedaba trabado y alguien lo reportaba. Cada
 * arreglo se validaba "a ojo" y nada garantizaba que siguiera funcionando
 * después del cambio siguiente.
 *
 * El caso que lo dejó claro (1/9/2026, tel. 2214001402): el patrón `que tengo`
 * en el detector de consultas médicas hacía que "los turnos *que tengo* para
 * mañana" se respondiera como una consulta clínica. Nadie lo vio hasta que un
 * paciente perdió siete minutos. Con un corpus, ese mensaje es un caso de una
 * línea que falla en rojo antes de desplegar.
 *
 * ── Qué es ────────────────────────────────────────────────────────────────
 *
 * Una lista de mensajes REALES (o realistas) con la intención que el sistema
 * debería reconocer. Cada caso lleva de dónde salió, para poder auditarlo.
 *
 * Dos tipos de caso, y la distinción importa:
 *
 *   - `regresion`: rompió de verdad en producción. Si vuelve a fallar,
 *     reintrodujimos un bug conocido. Estos NO se tocan para "que pase el test".
 *   - `cobertura`: lenguaje normal que debería funcionar. Sirven para detectar
 *     que al arreglar algo no rompimos lo que ya andaba.
 *
 * ── Cómo crece ────────────────────────────────────────────────────────────
 *
 * Tres fuentes, todas ya disponibles en el proyecto:
 *
 *   1. Cada conversación rota que se reporte: se agrega ANTES de arreglarla.
 *   2. Las muestras de diagnóstico (`/api/admin/diagnostics`), sobre todo
 *      `regla_ambigua_escalada_a_ia` y `preferencia_descartada`, que capturan
 *      justamente los mensajes donde el sistema dudó.
 *   3. El export de conversaciones reales (`/api/admin/export-conversations`).
 *
 * ── Qué NO es ─────────────────────────────────────────────────────────────
 *
 * No mide si la respuesta al paciente es buena; mide si la INTENCIÓN se
 * entiende bien. Es el primer eslabón: si la intención está mal, todo lo que
 * sigue está mal, sin importar qué tan linda sea la redacción.
 */

import type { FallbackIntent } from '../conversation-state/nlu-fallback-handler'

export interface CasoCorpus {
  /** El mensaje tal cual lo escribiría (o lo escribió) el paciente. */
  mensaje: string
  /** Intención que el sistema DEBERÍA reconocer. */
  esperado: FallbackIntent
  /**
   * `regresion`: falló en producción, está documentado, no debe volver a fallar.
   * `cobertura`: lenguaje habitual que tiene que seguir funcionando.
   */
  tipo: 'regresion' | 'cobertura'
  /** De dónde salió: teléfono + fecha para los reales, o "sintético". */
  origen: string
  /** Por qué es interesante este caso. Se muestra cuando falla. */
  nota?: string
  /**
   * true si este caso NO puede resolverse con reglas y necesita a la IA
   * (requiere entender la oración completa). Para estos, lo CORRECTO es que
   * las reglas no decidan y cedan; decidir es la falla.
   */
  requiereIA?: boolean
  /**
   * Contexto con el que hay que evaluar el caso.
   *
   * Algunos mensajes sólo tienen sentido sabiendo qué se le preguntó al paciente:
   * "si mucha gracias" es una despedida si nadie preguntó nada, y una
   * confirmación si acaba de recibir un recordatorio (7/9/2026).
   */
  contexto?: { confirmacionPendiente?: boolean }
  /**
   * Motivo por el que este caso hoy falla y todavía no está arreglado.
   *
   * Se documenta en vez de borrarse: el corpus tiene que reflejar la realidad,
   * no una foto conveniente. Los casos con `pendiente` se listan aparte en el
   * reporte y no bloquean, hasta que se resuelvan y se les saque la marca.
   */
  pendiente?: string
}

export const CORPUS: CasoCorpus[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // REGRESIONES — casos que rompieron en producción
  // ══════════════════════════════════════════════════════════════════════════

  {
    mensaje: 'Buen día , voy a tener que cambiar los turnos con Guemes que tengo para mañana',
    esperado: 'reagendar_turno',
    tipo: 'regresion',
    origen: 'tel. 2214001402 — 1/9/2026',
    nota:
      'El patrón `que tengo` del detector médico lo clasificaba como consulta clínica ' +
      'y se le respondía "no puedo brindarte información médica". Es EL caso que motivó ' +
      'separar patrones inequívocos de ambiguos.',
  },
  {
    mensaje: 'Buen día, tengo 3 turnos con Guemes para mañana, tendría que cambiarlos para la semana del 16 de septiembre',
    esperado: 'reagendar_turno',
    tipo: 'regresion',
    origen: 'tel. 2214001402 — 1/9/2026',
    nota:
      'El mismo pedido que el caso anterior pero SIN la expresión "que tengo": este sí ' +
      'se clasificaba bien. Tenerlos juntos deja a la vista que la diferencia entre ' +
      'acertar y fallar eran dos palabras, no el sentido de la frase.',
  },
  {
    mensaje: 'Por favor cancele mi turno, estoy muy mal del estomago',
    esperado: 'cancelar_turno',
    tipo: 'regresion',
    origen: 'tel. 1164160904 — 18/8/2026',
    nota:
      'El imperativo formal "cancele" no matcheaba, y el resto de la frase caía en el ' +
      'detector de quejas: un pedido de cancelación se respondía como si fuera un reclamo.',
  },
  {
    mensaje: 'Si mucha gracias',
    esperado: 'confirmar_asistencia',
    tipo: 'regresion',
    origen: 'tel. 1139200357 — 19/8/2026',
    nota:
      'Respuesta a un recordatorio que pedía confirmar asistencia. El "gracias" lo hace ' +
      'caer en el detector de despedidas con 0.8, así que las reglas DECIDEN y la IA ' +
      'nunca ve el mensaje.',
    requiereIA: true,
    contexto: { confirmacionPendiente: true },
  },
  {
    mensaje: 'gracias, hasta luego',
    esperado: 'saludo_despedida',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      'Contracara del caso anterior: SIN confirmación pendiente, un agradecimiento es ' +
      'justamente eso. Sirve para verificar que la abstención se aplica sólo cuando ' +
      'corresponde y no rompimos las despedidas normales.',
  },
  {
    mensaje: 'Puedo cambiar la fecha de turno.',
    esperado: 'reagendar_turno',
    tipo: 'regresion',
    origen: 'caso Ives — 31/8/2026',
    nota:
      'Se procesó como cancelación pura y se le habló de cancelar sin avisarle que ' +
      'después se le ofrecerían otras fechas.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // COBERTURA — lenguaje habitual que debe seguir funcionando
  // ══════════════════════════════════════════════════════════════════════════

  // ── Responder con el dato que se pidió ────────────────────────────────────
  // Caso Rosa Mattos (tel. 1162028924, 7/9/2026): se le pidió el DNI y mandó
  // "9390322 rosa mattos". El sistema lo tomó como pedido de menú, descartó el
  // dato y terminó agendando un turno sin nombre ni documento.
  //
  // Nota sobre qué mide esto: la respuesta correcta acá NO es una intención de
  // la lista, es "esto es el dato del paso, no una intención nueva". Las reglas
  // deben abstenerse; quien tiene que reconocerlo es la heurística de input de
  // paso (isObviousStepInput), antes de llegar a clasificar nada.
  {
    mensaje: '9390322 rosa mattos',
    esperado: 'otro',
    tipo: 'regresion',
    origen: 'tel. 1162028924 — 7/9/2026',
    nota:
      'DNI + nombre como respuesta a "indicame tu DNI". Ninguna regla de intención ' +
      'debe apropiarse de este mensaje: es el dato del paso.',
  },
  {
    mensaje: 'dni 30111222 Juan Perez',
    esperado: 'otro',
    tipo: 'cobertura',
    origen: 'sintético',
    nota: 'Misma forma que el caso Rosa Mattos, con la etiqueta "dni" explícita.',
  },

  // ── Reagendar, en sus formas más naturales ────────────────────────────────
  { mensaje: 'quiero cambiar el turno', esperado: 'reagendar_turno', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'necesito cambiar mis turnos', esperado: 'reagendar_turno', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'se puede pasar para otra fecha?', esperado: 'reagendar_turno', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'quisiera reagendar', esperado: 'reagendar_turno', tipo: 'cobertura', origen: 'sintético' },

  // ── Cancelar ──────────────────────────────────────────────────────────────
  { mensaje: 'no voy a poder ir', esperado: 'cancelar_turno', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'cancelame el turno por favor', esperado: 'cancelar_turno', tipo: 'cobertura', origen: 'sintético' },
  {
    mensaje: 'no voy a cancelar, quiero confirmar',
    esperado: 'confirmar_asistencia',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      'Trampa deliberada: la palabra "cancelar" está presente, pero NEGADA. Una regex ve ' +
      'la palabra y no la negación que la gobierna, así que clasificaba como cancelación ' +
      'justo la frase que significa lo contrario. Lo correcto es que las reglas se ' +
      'abstengan y decida la IA.',
    requiereIA: true,
  },

  // ── Confirmar ─────────────────────────────────────────────────────────────
  { mensaje: 'confirmo', esperado: 'confirmar_asistencia', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'si, ahi estare', esperado: 'confirmar_asistencia', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'dale', esperado: 'confirmar_asistencia', tipo: 'cobertura', origen: 'sintético' },

  // ── Consultas médicas REALES (la protección no se debe debilitar) ─────────
  {
    mensaje: 'me duele mucho el ojo desde ayer, que hago?',
    esperado: 'consulta_medica_prohibida',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      'Síntoma explícito: debe derivarse a un profesional, nunca responderse. ' +
      'Este caso destapó un falso negativo: el detector tenía "dolor" pero no "duele", ' +
      'que es como la gente escribe de verdad.',
  },
  {
    mensaje: 'puedo seguir tomando el ibuprofeno antes del turno?',
    esperado: 'consulta_medica_prohibida',
    tipo: 'cobertura',
    origen: 'sintético',
  },
  {
    mensaje: 'que tengo doctor? los resultados me dieron mal',
    esperado: 'consulta_medica_prohibida',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      'El uso LEGÍTIMO de "que tengo". Al sacarlo de las reglas, este caso pasa a ' +
      'depender de la IA — por eso está marcado como requiereIA.',
    requiereIA: true,
  },

  {
    mensaje: 'la cirugia es riesgosa? me da miedo',
    esperado: 'consulta_medica_prohibida',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      'El uso LEGÍTIMO de "cirugia". Al sacarla de las reglas inequívocas (caso María García, ' +
      '8/9/2026), este caso pasa a depender de la IA — por eso está marcado como requiereIA. ' +
      'La protección no desaparece: se mueve de capa.',
    requiereIA: true,
  },

  // ── Frases con expresiones ambiguas que NO son consultas médicas ──────────

  {
    mensaje: 'Tengo cirugía el nueve de septiembre,',
    esperado: 'otro',
    tipo: 'regresion',
    origen: 'produccion',
    nota:
      'Caso María García (tel. 1133550488, 8/9/2026). Avisar que tenés una cirugía agendada es un ' +
      'DATO sobre tu agenda, no una consulta clínica. La palabra "cirugia" decidía sola con 0.95 ' +
      'y la paciente recibió el bloque de "no puedo brindarte información médica" cuando lo único ' +
      'que hizo fue avisar que se operaba el día anterior a su turno. Las reglas ahora se abstienen.',
    requiereIA: true,
  },

  {
    mensaje: 'puedo hacer el cambio de fecha por acá?',
    esperado: 'reagendar_turno',
    tipo: 'cobertura',
    origen: 'sintético',
    nota: '"puedo hacer" estaba en el detector médico.',
  },
  {
    mensaje: 'que hago si no puedo ir ese dia?',
    esperado: 'cancelar_turno',
    tipo: 'cobertura',
    origen: 'sintético',
    nota:
      '"que hago si" estaba en el detector médico. Ahora la señal ambigua se evalúa al ' +
      'final, así que gana isCancellation por "no puedo ir" — que es lo correcto.',
  },

  // ── Quejas reales vs. frases que sólo parecen quejas ──────────────────────
  {
    mensaje: 'hace tres dias que los estoy llamando y nadie atiende',
    esperado: 'queja_frustracion',
    tipo: 'cobertura',
    origen: 'sintético',
  },
  {
    mensaje: 'ese horario me viene muy mal',
    esperado: 'reagendar_turno',
    tipo: 'cobertura',
    origen: 'sintético',
    nota: '"muy mal" estaba en el detector de quejas: esto es un pedido de otro horario.',
    requiereIA: true,
  },
  {
    mensaje: 'gracias por la paciencia',
    esperado: 'saludo_despedida',
    tipo: 'cobertura',
    origen: 'sintético',
    nota: '"paciencia" estaba en el detector de quejas, siendo lo contrario de una queja.',
  },

  // ── Llegar tarde / no asistir ─────────────────────────────────────────────
  { mensaje: 'ya sali, voy llegando', esperado: 'llego_tarde', tipo: 'cobertura', origen: 'sintético' },
  { mensaje: 'me olvide del turno, no pude ir', esperado: 'no_asisti', tipo: 'cobertura', origen: 'sintético' },

  // ── Número equivocado ─────────────────────────────────────────────────────
  { mensaje: 'creo que se equivocaron, no soy esa persona', esperado: 'numero_equivocado', tipo: 'cobertura', origen: 'sintético' },

  // ── Administrativas ───────────────────────────────────────────────────────
  { mensaje: 'cuanto cuesta la consulta?', esperado: 'consulta_no_disponible', tipo: 'cobertura', origen: 'sintético' },
]
