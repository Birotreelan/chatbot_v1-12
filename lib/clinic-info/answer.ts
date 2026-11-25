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

import { MODELO_REDACCION } from "@/lib/ai-models"

const SIN_DATOS = 'SIN_DATOS'

const SYSTEM_PROMPT = `Sos el asistente virtual de una clínica médica. Un paciente eligió la opción "Realizar otra consulta" en el menú y escribió algo que NO es sobre agendar, cancelar o confirmar un turno.

Tu única fuente de información es el bloque "INFORMACIÓN DE LA CLÍNICA" que te paso a continuación. Reglas estrictas:
- Respondé SOLO si la pregunta se puede contestar con esos datos, tal cual están escritos.
- Nunca inventes ni completes con conocimiento general (horarios, direcciones, obras sociales, profesionales, precios, etc. que no estén en el bloque).
- Si el bloque no alcanza para responder con certeza, respondé EXACTAMENTE: ${SIN_DATOS}
- Si el bloque trae una sección marcada como SÓLO CONTEXTO, usala para entender de qué te hablan, pero NO le repitas ese contenido al paciente: para eso respondé ${SIN_DATOS} y lo derivamos nosotros.
- Nada de lo que digas puede depender de la historia clínica de este paciente en particular: qué medicación toma, qué le indicaron, qué dosis. Eso es ${SIN_DATOS} siempre, aunque el bloque tenga algo parecido.
- Si respondés, hacelo en 1 a 3 oraciones, tono cordial, tuteo argentino (vos/tenés), sin saludos ni cortesías largas.`

/**
 * ── Qué partes del conocimiento se le pueden repetir al paciente
 *    (25/11/2026) ───────────────────────────────────────────────────────────
 *
 * Decisión de Nicolás: el bot contesta con lo que la clínica escribió, literal.
 * Pero campo por campo y eligiendo la clínica, no nosotros: hay cosas que
 * dependen de la historia de cada paciente —"qué gotas me pongo y en qué
 * orden", con una cirugía al otro día, que es una pregunta real— y ahí un texto
 * general es peor que derivar.
 *
 * ── Por qué el default es "no contesta" ───────────────────────────────────
 *
 * Porque es el comportamiento de hoy, y porque la lista crece: el día que
 * alguien agregue un bloque nuevo al esquema, ese bloque no tiene que volverse
 * contestable por el solo hecho de existir. Tiene que ir a la lista a mano, que
 * es cuando alguien piensa si corresponde.
 *
 * Los cuatro bloques administrativos arrancan habilitados —órdenes,
 * coberturas, aranceles y guardia— porque no dependen del paciente y son el
 * 46% de lo que se pregunta. Lo clínico no.
 */
const CONTESTABLES_POR_DEFECTO = [
  "guardia",
  "coberturas",
  "obrasSociales",
  "ordenesYAutorizaciones",
  "aranceles",
  "sedes",
  "horarioAtencion",
  "telefonoContacto",
  "emailContacto",
  "especialidades",
  "profesionales",
  "equipamiento",
]

/**
 * Parte el bloque en lo que se puede repetir y lo que es sólo contexto.
 *
 * El modelo recibe las dos partes porque entender la pregunta necesita todo:
 * sin el bloque de estudios no sabe que "el OCT" es un estudio. Lo que cambia
 * es qué puede devolverle al paciente.
 */
export function partirPorPermiso(
  bloque: string,
  permitidos: string[],
): { contestable: string; soloContexto: string } {
  /** Cada línea del bloque empieza con "- <Tema>:"; las sub-líneas con "  ·". */
  const ETIQUETAS: Record<string, string[]> = {
    guardia: ["Guardia / urgencias"],
    coberturas: ["Coberturas, con plan y copago"],
    obrasSociales: ["Obras sociales/prepagas aceptadas"],
    ordenesYAutorizaciones: ["Órdenes y autorizaciones"],
    aranceles: ["Aranceles y pagos"],
    estudios: ["Estudios"],
    sedes: ["Sede"],
    horarioAtencion: ["Horario de atención general"],
    telefonoContacto: ["Teléfono de contacto"],
    emailContacto: ["Email de contacto"],
    especialidades: ["Especialidades"],
    profesionales: ["Profesionales"],
    equipamiento: ["Equipamiento"],
    instruccionesPreConsulta: ["Instrucciones previas a la consulta"],
    cuidadosPostOperatorios: ["Cuidados post-operatorios generales"],
    informacionAdicional: ["Información adicional"],
  }

  const etiquetaDeLaLinea = (linea: string): string | null => {
    for (const [campo, etiquetas] of Object.entries(ETIQUETAS)) {
      if (etiquetas.some((e) => linea.startsWith(`- ${e}`))) return campo
    }
    return null
  }

  const contestable: string[] = []
  const soloContexto: string[] = []
  let destino = contestable

  for (const linea of bloque.split("\n")) {
    // El encabezado del bloque va en las dos partes: es la instrucción de no
    // inventar, y aplica igual.
    if (linea.startsWith("INFORMACIÓN DE LA CLÍNICA")) {
      contestable.push(linea)
      soloContexto.push(linea)
      continue
    }
    const campo = etiquetaDeLaLinea(linea)
    if (campo) destino = permitidos.includes(campo) ? contestable : soloContexto
    // Las sub-líneas ("  · OSDE — …") siguen al tema que las abrió.
    destino.push(linea)
  }

  const hayContenido = (lineas: string[]) => lineas.length > 1
  return {
    contestable: hayContenido(contestable) ? contestable.join("\n") : "",
    soloContexto: hayContenido(soloContexto) ? soloContexto.join("\n") : "",
  }
}

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

    /**
     * La clínica decide campo por campo; sin configuración, los cuatro bloques
     * administrativos. Ver `CONTESTABLES_POR_DEFECTO`.
     */
    const permitidos = info.camposQueElBotPuedeContestar?.length
      ? info.camposQueElBotPuedeContestar
      : CONTESTABLES_POR_DEFECTO
    const { contestable, soloContexto } = partirPorPermiso(bloque, permitidos)

    // Sin nada contestable no hace falta pagar la llamada: la respuesta ya es
    // la derivación de siempre.
    if (!contestable) {
      void recordDiag(configId, DIAG.OTRA_CONSULTA_SIN_RESPUESTA)
      return { respondida: false }
    }

    const response = await openai.chat.completions.create({
      model: MODELO_REDACCION,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `${contestable}\n\n` +
            (soloContexto ? `SÓLO CONTEXTO (no repetir al paciente):\n${soloContexto}\n\n` : "") +
            `Pregunta del paciente: "${userMessage.trim()}"`,
        },
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
