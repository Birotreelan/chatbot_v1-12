/**
 * Presentación de Iris como asistente virtual de inteligencia artificial.
 *
 * ── Por qué esto vive en un solo lugar (17/9/2026) ─────────────────────────
 *
 * Hasta hoy la decisión de presentarse estaba tomada a mano en 13 puntos
 * distintos del código, con `conSaludoSiCorresponde()`. Cada vez que apareció
 * una rama de respuesta nueva, se olvidó: el executor el 31/8, el router
 * primario el 10/9, el NLU fallback el 17/9. Tres parches del mismo agujero.
 *
 * Ahora la decisión se toma en `sendDirectResponse`, que es el embudo por donde
 * salen las respuestas (141 llamadas). Ninguna rama puede olvidarse.
 *
 * ── Presentarse no es saludar ──────────────────────────────────────────────
 *
 * La versión anterior se auto-suprimía con esta guarda:
 *
 *     if (/^(hola|buen(os|as)\s|bienvenid)/i.test(mensaje)) return mensaje
 *
 * El caso que lo destapó (tel. 1121607311 / Marcela, 17/9): GPT generó una
 * respuesta que arrancaba con "Hola, estoy bien, gracias", la guarda matcheó, y
 * la paciente nunca se enteró de que hablaba con una IA.
 *
 * Son dos cosas distintas. Que el mensaje ya salude no quiere decir que ya se
 * haya identificado. Lo que no se puede omitir es la identificación; el "¡Hola!"
 * sí, si el texto ya trae uno.
 */

import { getRedisClient } from "../redis"
import { getPatientSnapshot } from "../conversations"
import { getWhatsAppConfigById } from "../db"
import { getAppointmentContext } from "../appointment-flow-state"

const PRESENTACION_PREFIX = "presentacion_enviada:"

/**
 * 24 horas. Se corresponde con la regla acordada: si es el primer mensaje del
 * día, se saluda siempre. Al día siguiente el paciente vuelve a recibir la
 * presentación, que es lo que corresponde.
 */
const PRESENTACION_TTL_SEGUNDOS = 24 * 60 * 60

/** El mensaje ya se identifica como asistente — no hay que volver a hacerlo. */
const YA_SE_PRESENTA = /asistente virtual|bienvenid/i

/** El mensaje ya arranca con un saludo: alcanza con agregarle la identificación. */
const YA_SALUDA = /^[\s*_]*(¡?\s*)?(hola|buen(os|as)\s|buen\s*d[ií]a)/i

function clave(configId: string, phoneNumber: string): string {
  return `${PRESENTACION_PREFIX}${configId}:${phoneNumber}`
}

function primerNombre(nombreCompleto?: string | null): string {
  const primero = (nombreCompleto || "").trim().split(/\s+/)[0] || ""
  if (!primero) return ""
  return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase()
}

/**
 * ¿Con qué nombre saludamos? (13/11/2026)
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Un mismo mensaje nombró a dos pacientes distintos:
 *
 *   ¡Hola, Testdos! Soy Iris, tu asistente virtual…
 *   Testuno, tu confirmación de asistencia fue recibida correctamente.
 *
 * El turno de las 18:00 es de Testuno, y el cuerpo lo decía bien: es el turno
 * del botón que el paciente tocó. El que estaba mal era el saludo, porque el
 * nombre salía del snapshot del paciente —guardado POR TELÉFONO, con el
 * último que se identificó—. Con dos pacientes en un teléfono, el snapshot es
 * una respuesta vieja a una pregunta que cambió.
 *
 * ── La regla: manda el turno del que trata la respuesta ───────────────────
 *
 * Si el turno que se está gestionando dice de quién es, ése es el nombre. El
 * snapshot queda como respaldo para cuando no hay turno en juego —una
 * consulta general, un saludo suelto—.
 *
 * Es la misma idea que arregló la confirmación: el recordatorio trae al
 * paciente, y preguntarle al teléfono quién es sólo agrega una oportunidad de
 * equivocarse. Y el saludo tiene que coincidir con el cuerpo: dos nombres en
 * un mismo mensaje no son un detalle de redacción, son dos personas, y el
 * paciente no puede saber cuál de las dos cosas creer.
 *
 * Si no hay ningún nombre confiable, sale "*¡Hola!* Soy Iris…", la variante
 * que ya existía para cuando no se conoce al paciente. Mejor sin nombre que
 * con el de otro.
 */
export function nombreParaSaludar(opciones: {
  /** Del turno del que trata esta respuesta. Tiene prioridad. */
  nombreDelTurno?: string | null
  dniDelTurno?: string | null
  /** Del snapshot por teléfono: el último paciente identificado. */
  nombreDelSnapshot?: string | null
  dniDelSnapshot?: string | null
}): string | null {
  const digitos = (v?: string | null) => String(v ?? "").replace(/[^0-9]/g, "")
  const delTurno = digitos(opciones.dniDelTurno)
  const delSnapshot = digitos(opciones.dniDelSnapshot)

  const nombreDelTurno = (opciones.nombreDelTurno || "").trim()
  if (nombreDelTurno) return nombreDelTurno

  // El turno no trae nombre pero sí documento, y es otro paciente que el del
  // snapshot: el snapshot no sirve para esta respuesta y no hay con qué
  // reemplazarlo.
  if (delTurno && delSnapshot && delTurno !== delSnapshot) return null

  return (opciones.nombreDelSnapshot || "").trim() || null
}

/**
 * Arma el bloque de presentación. Pura y exportada para poder testear las
 * cuatro combinaciones (con nombre o sin, saludando o no).
 */
/**
 * Cómo se presenta Iris. Una sola frase, exportada (24/11/2026).
 *
 * ── Dos personas distintas hablaban ───────────────────────────────────────
 *
 * En las conversaciones del 20/11 convivían:
 *
 *   «¡Hola, X! Soy Iris, tu asistente virtual de inteligencia artificial…»
 *   «¡Bienvenido! Soy el asistente virtual…»
 *   «Soy Iris, la asistente virtual de la clínica.»
 *
 * Las tres salían de lugares distintos —este archivo, el prompt de
 * openai-responses y el ejecutor del dispatcher— y una de ellas, la del
 * prompt, no decía ni el nombre. Para el paciente son tres interlocutores.
 *
 * Que la frase esté acá y se importe NO es elegancia: la guarda
 * `YA_SE_PRESENTA` de este mismo archivo busca "asistente virtual" para no
 * presentarse dos veces, así que una presentación escrita en otra parte con
 * otras palabras se duplica o se come la de acá. Las dos fallas son
 * invisibles hasta que un paciente las ve.
 */
export function identidadDeIris(clinica?: string | null): string {
  const deLaClinica = clinica ? ` de ${clinica}` : ""
  return `Soy Iris, tu asistente virtual de inteligencia artificial${deLaClinica}.`
}

export function construirPresentacion(opciones: {
  nombre?: string | null
  clinica?: string | null
  mensajeYaSaluda: boolean
}): string {
  const identidad = identidadDeIris(opciones.clinica)

  // Si el texto ya trae su propio saludo, no se le encima otro: sólo la
  // identificación, que es lo que no puede faltar.
  if (opciones.mensajeYaSaluda) return identidad

  const nombre = primerNombre(opciones.nombre)
  return nombre ? `*¡Hola, ${nombre}!* ${identidad}` : `*¡Hola!* ${identidad}`
}

/**
 * Antepone la presentación al mensaje, si corresponde. Pura: la decisión de si
 * ya se presentó hoy la toma el llamador.
 */
export function anteponerPresentacion(
  mensaje: string,
  opciones: { nombre?: string | null; clinica?: string | null },
): string {
  const texto = mensaje || ""
  if (!texto.trim()) return texto

  // Ya se identifica solo (el saludo de detección de paciente, por ejemplo).
  if (YA_SE_PRESENTA.test(texto)) return texto

  const presentacion = construirPresentacion({
    nombre: opciones.nombre,
    clinica: opciones.clinica,
    mensajeYaSaluda: YA_SALUDA.test(texto),
  })

  return `${presentacion}\n\n${texto}`
}

/**
 * ¿Ya se presentó hoy en esta conversación?
 *
 * Marca propia en Redis en vez de deducirlo del historial: es una lectura más
 * barata, no depende de que el historial se haya escrito a tiempo, y codifica
 * directamente la regla de "una vez por día".
 */
async function yaSePresentoHoy(configId: string, phoneNumber: string): Promise<boolean> {
  try {
    const redis = getRedisClient()
    if (!redis) return true // Sin Redis no podemos saberlo: no molestamos con presentaciones repetidas.
    return (await redis.get(clave(configId, phoneNumber))) !== null
  } catch {
    return true
  }
}

async function marcarPresentado(configId: string, phoneNumber: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (!redis) return
    await redis.set(clave(configId, phoneNumber), new Date().toISOString(), {
      ex: PRESENTACION_TTL_SEGUNDOS,
    })
  } catch {
    // Si falla, en el peor caso el paciente recibe la presentación dos veces.
  }
}

/**
 * Punto único de decisión, llamado desde sendDirectResponse.
 *
 * En el caso normal cuesta una sola lectura a Redis. Los datos del paciente y
 * de la clínica se buscan SÓLO cuando hay que presentarse de verdad, o sea una
 * vez por conversación por día, no en cada respuesta.
 *
 * Nunca lanza: si algo falla, devuelve el mensaje original. Una presentación
 * que falta es mucho menos grave que una respuesta que no sale.
 */
export async function presentarSiCorresponde(
  mensaje: string,
  configId: string,
  phoneNumber: string,
): Promise<string> {
  try {
    if (!mensaje?.trim()) return mensaje
    if (await yaSePresentoHoy(configId, phoneNumber)) return mensaje

    // El mensaje ya se identifica (saludo de detección de paciente): no se toca,
    // pero se marca igual para no presentarse de nuevo más adelante.
    if (YA_SE_PRESENTA.test(mensaje)) {
      await marcarPresentado(configId, phoneNumber)
      return mensaje
    }

    const [snapshot, config, contextoDelTurno] = await Promise.all([
      getPatientSnapshot(configId, phoneNumber).catch(() => null),
      getWhatsAppConfigById(configId).catch(() => null),
      // El turno del que trata esta respuesta. En el camino de los botones ya
      // quedó guardado el del mensaje que el paciente tocó, así que acá se
      // puede saber si el snapshot del teléfono habla de otra persona.
      getAppointmentContext(phoneNumber, configId).catch(() => null),
    ])

    const conPresentacion = anteponerPresentacion(mensaje, {
      nombre: nombreParaSaludar({
        nombreDelTurno: contextoDelTurno?.paciente?.nombres,
        dniDelTurno: contextoDelTurno?.paciente?.dni,
        nombreDelSnapshot: snapshot?.nombre,
        dniDelSnapshot: snapshot?.nrodoc,
      }),
      clinica: config?.displayName,
    })

    await marcarPresentado(configId, phoneNumber)
    return conPresentacion
  } catch {
    return mensaje
  }
}
