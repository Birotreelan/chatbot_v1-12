/**
 * Extracción de los datos del turno al enviar un template (17/9/2026).
 *
 * ── El bug ─────────────────────────────────────────────────────────────────
 *
 * La versión anterior leía los parámetros del template POR POSICIÓN, asumiendo
 * siempre el orden de `confirmacion_1_turno`:
 *
 *     [0] clínica · [1] fecha · [2] hora · [3] profesional · [4] dirección
 *
 * `cancelar_turno_solicitado` no lleva el nombre de la clínica al principio, así
 * que sus parámetros son [0] fecha · [1] hora · [2] profesional · [3] teléfono.
 * Todo se corría un lugar y quedaba esto en el contexto que se guarda en Redis:
 *
 *     fecha: '08:50'
 *     hora: 'TRAVERSO ALVARADO, ARIANNA ANDREA'
 *     profesional: '0800-345-9393'
 *
 * El envío del template no falla —los parámetros los arma el backend de la
 * clínica, no nosotros— pero si el paciente responde a ese mensaje, el bot
 * razona sobre datos basura.
 *
 * ── El criterio ────────────────────────────────────────────────────────────
 *
 * La posición de un parámetro no es un dato: es una coincidencia que se rompe
 * con cada template nuevo que arme una clínica. Pero el dato REAL ya viene en
 * `Chatbot_Data`, estructurado y con nombre. Entonces:
 *
 *   1. Se lee de Chatbot_Data, que es la fuente autoritativa.
 *   2. Lo que falte se completa desde los parámetros del template, y ahí se
 *      identifican POR FORMA (una fecha parece una fecha, una hora parece una
 *      hora), no por índice.
 *   3. El orden posicional sólo se usa para los templates cuyo layout conocemos
 *      y está declarado abajo. Para cualquier otro no se adivina: se deja en
 *      null, que es honesto y no corrompe nada.
 *
 * Un template nuevo, entonces, ya no puede desalinear los campos. En el peor
 * caso deja alguno vacío.
 */

export interface DatosDelTurno {
  fecha: string | null
  hora: string | null
  profesional: string | null
  especialidad: string | null
  lugar: string | null
}

type CampoDelTurno = keyof DatosDelTurno

/**
 * Layouts posicionales conocidos, usados SÓLO como último recurso cuando no
 * vino Chatbot_Data. `null` = parámetro que no aporta datos del turno.
 *
 * Agregar uno acá es una decisión deliberada: si el backend de la clínica
 * cambia el orden de ese template, esta tabla miente.
 */
const LAYOUTS_CONOCIDOS: Record<string, Array<CampoDelTurno | null>> = {
  confirmacion_1_turno: [null, "fecha", "hora", "profesional", "lugar"],
}

/** "18/09/2026", "2026-09-18", "3 de octubre de 2026". */
const PARECE_FECHA = /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$|^\d{1,2}\s+de\s+\p{L}+/iu

/** "08:50", "8:50", "08:50:00". */
const PARECE_HORA = /^\d{1,2}:\d{2}(:\d{2})?$/

function vacio(): DatosDelTurno {
  return { fecha: null, hora: null, profesional: null, especialidad: null, lugar: null }
}

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

function parsearBody(templateBody: any): any {
  if (!templateBody) return null
  if (typeof templateBody !== "string") return templateBody
  try {
    return JSON.parse(templateBody)
  } catch {
    return null
  }
}

function parametrosDelBody(templateBody: any): Array<{ text?: string }> {
  const data = parsearBody(templateBody)
  const componentes = data?.template?.components
  if (!Array.isArray(componentes)) return []

  for (const componente of componentes) {
    if (componente?.type === "body" && Array.isArray(componente.parameters)) {
      return componente.parameters
    }
  }
  return []
}

function nombreDelTemplate(templateBody: any): string | null {
  return texto(parsearBody(templateBody)?.template?.name)
}

/**
 * Fuente autoritativa. Contempla las dos formas que manda el backend:
 *
 *  - Recordatorio de turno: los datos viven en `turnos[0]`.
 *  - Avisos de la clínica (turno cancelado, turno confirmado): los datos vienen
 *    sueltos en la raíz del objeto.
 */
function desdeChatbotData(chatbotData: any): DatosDelTurno {
  const datos = vacio()
  if (!chatbotData || typeof chatbotData !== "object") return datos

  const turno = Array.isArray(chatbotData.turnos) ? chatbotData.turnos[0] : null
  const fuente = turno && typeof turno === "object" ? turno : chatbotData

  datos.fecha = texto(fuente.fecha_formateada) ?? texto(fuente.fecha)
  datos.hora = texto(fuente.hora_formateada) ?? texto(fuente.hora)
  datos.profesional = texto(fuente.profesional)
  datos.especialidad = texto(fuente.especialidad)
  datos.lugar = texto(fuente.direccion) ?? texto(fuente.sede) ?? texto(fuente.lugar)

  return datos
}

/**
 * Respaldo para cuando no vino Chatbot_Data. Primero el layout declarado del
 * template si lo conocemos; si no, sólo lo que se puede reconocer por su forma.
 */
function desdeParametros(templateBody: any): DatosDelTurno {
  const datos = vacio()
  const parametros = parametrosDelBody(templateBody)
  if (parametros.length === 0) return datos

  const layout = LAYOUTS_CONOCIDOS[nombreDelTemplate(templateBody) ?? ""]
  if (layout) {
    layout.forEach((campo, indice) => {
      if (!campo) return
      const valor = texto(parametros[indice]?.text)
      if (valor) datos[campo] = valor
    })
    return datos
  }

  // Template desconocido: sólo fecha y hora, y sólo si se reconocen por forma.
  for (const parametro of parametros) {
    const valor = texto(parametro?.text)
    if (!valor) continue
    if (!datos.fecha && PARECE_FECHA.test(valor)) {
      datos.fecha = valor
      continue
    }
    if (!datos.hora && PARECE_HORA.test(valor)) {
      datos.hora = valor
    }
  }

  return datos
}

export function extraerDatosDelTurno(templateBody: any, chatbotData?: any): DatosDelTurno {
  const principal = desdeChatbotData(chatbotData)

  // Si Chatbot_Data ya trajo lo esencial, no hace falta mirar el template.
  if (principal.fecha && principal.hora) return principal

  const respaldo = desdeParametros(templateBody)

  return {
    fecha: principal.fecha ?? respaldo.fecha,
    hora: principal.hora ?? respaldo.hora,
    profesional: principal.profesional ?? respaldo.profesional,
    especialidad: principal.especialidad ?? respaldo.especialidad,
    lugar: principal.lugar ?? respaldo.lugar,
  }
}
