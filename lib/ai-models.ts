/**
 * lib/ai-models.ts
 *
 * Selección centralizada de los modelos de IA que usa el chatbot (7/9/2026).
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Hasta hoy el nombre del modelo estaba escrito a mano en 17 lugares distintos.
 * Eso hacía que cualquier evaluación seria ("¿conviene cambiar de modelo?")
 * fuera imposible de hacer bien: no se podía cambiar UNA capa, medir el efecto
 * y volver atrás sin tocar una docena de archivos y arriesgarse a dejar la
 * mitad migrada por error.
 *
 * Las capas están separadas por RIESGO, no por comodidad. La diferencia
 * importa: mover el extractor de fechas a otro modelo es un experimento
 * barato; mover el dispatcher es cambiar el componente que decide si se
 * cancela el turno médico de alguien.
 *
 * ── Cómo cambiar un modelo ────────────────────────────────────────────────
 *
 * Cada capa acepta una variable de entorno con el mismo nombre que la
 * constante. Así se puede probar un modelo en producción (o en un preview de
 * Vercel) sin deploy, y revertir borrando la variable:
 *
 *     MODELO_DISPATCHER=gpt-4.1-mini
 *
 * Los valores por defecto son los que ya estaban en uso: este módulo NO
 * cambia ningún comportamiento al introducirse.
 *
 * ── Antes de cambiar un modelo ────────────────────────────────────────────
 *
 * El corpus (lib/evaluacion/) hoy sólo cubre la capa de REGLAS determinísticas,
 * no las llamadas a la IA. Cambiar cualquiera de estas constantes sin extender
 * el corpus a la capa correspondiente es un cambio a ciegas: no hay forma
 * automatizada de saber si mejoró o empeoró hasta que se queje un paciente.
 */

function modeloDe(variableEntorno: string, porDefecto: string): string {
  const valor = process.env[variableEntorno]?.trim()
  return valor && valor.length > 0 ? valor : porDefecto
}

/**
 * ORQUESTADOR. Elige qué acción toma el sistema ante cada mensaje
 * (confirmar, cancelar, reagendar, derivar…). Corre en casi todos los
 * mensajes y es, de lejos, el que más tokens consume: su prompt ronda los
 * 4.800 tokens de entrada contra ~50 de salida.
 *
 * RIESGO ALTO: sus errores se traducen en turnos cancelados o consultas
 * médicas mal derivadas. Es el último que habría que tocar, y sólo con
 * evaluación previa.
 */
export const MODELO_DISPATCHER = modeloDe('MODELO_DISPATCHER', 'gpt-4o-mini')

/**
 * CLASIFICADORES DE INTENCIÓN. Deciden qué quiso decir el paciente cuando las
 * reglas determinísticas se abstienen (confirmación vs. cancelación,
 * despedidas, interrupciones de flujo, opciones de menú).
 *
 * RIESGO ALTO: acá se resuelven los "sí"/"no" ambiguos sobre turnos.
 */
export const MODELO_CLASIFICACION = modeloDe('MODELO_CLASIFICACION', 'gpt-4o-mini')

/**
 * EXTRACTORES DE DATOS ESTRUCTURADOS. Sacan fechas, horarios, filtros y
 * selecciones de turno del texto libre del paciente. Devuelven JSON que el
 * código valida después.
 *
 * RIESGO MEDIO: un error se nota enseguida (el turno extraído no coincide) y
 * el código determinístico lo valida contra la lista real de turnos. Es la
 * capa más barata para experimentar con otro modelo.
 */
export const MODELO_EXTRACCION = modeloDe('MODELO_EXTRACCION', 'gpt-4o-mini')

/**
 * REDACCIÓN. Genera texto que le llega tal cual al paciente (respuestas
 * empáticas, reingreso a un flujo, información institucional de la clínica).
 *
 * RIESGO ALTO EN OTRO SENTIDO: no se equivoca de acción, se equivoca de
 * contenido — inventar un horario o prometer algo que la clínica no confirmó
 * (ver buildLlegoTardeResponse en nlu-fallback-handler.ts, 7/9/2026).
 */
export const MODELO_REDACCION = modeloDe('MODELO_REDACCION', 'gpt-4o-mini')

/**
 * ASISTENTE DE TEXTO LIBRE. El fallback conversacional completo, con tools
 * (buscar turnos, validar DNI, reservar). Sólo corre cuando ningún flujo
 * determinístico agarró el mensaje.
 *
 * Es el modelo más caro del sistema por token ($2/$8 por millón contra
 * $0,15/$0,60 de gpt-4o-mini) y además puede encadenar hasta
 * MAX_TOOL_ITERATIONS (12) llamadas para un solo mensaje del paciente,
 * reenviando el historial completo cada vez.
 */
export const MODELO_ASISTENTE = modeloDe('MODELO_ASISTENTE', 'gpt-4.1')

/**
 * TRANSCRIPCIÓN de los audios que mandan los pacientes.
 */
export const MODELO_TRANSCRIPCION = modeloDe('MODELO_TRANSCRIPCION', 'whisper-1')
