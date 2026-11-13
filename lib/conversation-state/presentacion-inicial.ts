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
 * El cuerpo estaba bien —era el turno de Testuno, el del botón que se tocó—.
 * El que estaba mal era el saludo: el nombre sale del snapshot del paciente,
 * que está guardado POR TELÉFONO, así que tiene al último que se identificó.
 * Con dos pacientes en un teléfono, el snapshot es una respuesta vieja a una
 * pregunta que cambió.
 *
 * ── La regla: ante la duda, sin nombre ────────────────────────────────────
 *
 * Si el snapshot y el turno del que estamos hablando apuntan a documentos
 * distintos, no sabemos quién está escribiendo, y entonces no se usa ninguno
 * de los dos: sale "*¡Hola!* Soy Iris…", que es la variante que ya existía
 * para cuando no se conoce al paciente.
 *
 * Nombrar mal a alguien en una conversación sobre su salud es peor que no
 * nombrarlo. Y acá hay un agravante: el cuerpo del mensaje sí nombra al
 * paciente correcto, así que un saludo equivocado no queda como un detalle
 * —queda como dos personas en un mismo mensaje, y el paciente no puede saber
 * cuál de las dos cosas creer—.
 */
export function nombreParaSaludar(opciones: {
  /** Del snapshot por teléfono: el último paciente identificado. */
  nombreDelSnapshot?: string | null
  dniDelSnapshot?: string | null
  /** Del turno del que trata esta respuesta. */
  dniDelTurno?: string | null
}): string | null {
  const digitos = (v?: string | null) => String(v ?? "").replace(/[^0-9]/g, "")
  const delSnapshot = digitos(opciones.dniDelSnapshot)
  const delTurno = digitos(opciones.dniDelTurno)

  if (delSnapshot && delTurno && delSnapshot !== delTurno) return null

  return opciones.nombreDelSnapshot || null
}

/**
 * Arma el bloque de presentación. Pura y exportada para poder testear las
 * cuatro combinaciones (con nombre o sin, saludando o no).
 */
export function construirPresentacion(opciones: {
  nombre?: string | null
  clinica?: string | null
  mensajeYaSaluda: boolean
}): string {
  const deLaClinica = opciones.clinica ? ` de ${opciones.clinica}` : ""
  const identidad = `Soy Iris, tu asistente virtual de inteligencia artificial${deLaClinica}.`

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
        nombreDelSnapshot: snapshot?.nombre,
        dniDelSnapshot: snapshot?.nrodoc,
        dniDelTurno: contextoDelTurno?.paciente?.dni,
      }),
      clinica: config?.displayName,
    })

    await marcarPresentado(configId, phoneNumber)
    return conPresentacion
  } catch {
    return mensaje
  }
}
