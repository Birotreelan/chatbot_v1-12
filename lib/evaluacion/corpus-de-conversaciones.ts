/**
 * El corpus de conversaciones etiquetadas (25/11/2026).
 *
 * ── Qué mide, y en qué se diferencia del corpus que ya existe ─────────────
 *
 * `lib/evaluacion/corpus.ts` mide si la INTENCIÓN de un mensaje se entiende.
 * Es el primer eslabón y está bien que exista aparte: si la intención está mal,
 * todo lo que sigue está mal.
 *
 * Esto mide otra cosa, la que el diagnóstico del 20/11 dejó al descubierto: el
 * bot puede entender perfectamente y la conversación fracasar igual. Aurora
 * pidió un turno con la Dra. Molina en su primer mensaje —el dispatcher lo
 * entendió— y después de 16 mensajes se fue sin turno. La unidad acá es la
 * CONVERSACIÓN y la pregunta es "¿consiguió lo que vino a buscar?".
 *
 * ── Por qué etiquetado a mano y no automático ─────────────────────────────
 *
 * Porque no hay ninguna señal en los datos que diga "esta persona se fue
 * contenta". Los eventos de turno dicen que un turno se reservó, no que el
 * paciente haya conseguido el que quería; el final de la conversación dice que
 * se derivó, no si derivar estaba bien. Las dos cosas las sabe quien lee la
 * conversación, y nadie más.
 *
 * Cien conversaciones etiquetadas no son una muestra estadística; son un banco
 * de pruebas. El valor no está en el porcentaje exacto sino en poder correr las
 * mismas cien antes y después de un cambio.
 *
 * ── Las etiquetas, y por qué estas ────────────────────────────────────────
 *
 * Dos preguntas y una nota. Más preguntas haría el etiquetado más lento y lo
 * más probable es que se abandone a las veinte conversaciones.
 *
 * La segunda pregunta distingue dos derivaciones que parecen iguales y no lo
 * son. Derivar al paciente de PAMI que no puede sacar turno online es la
 * respuesta CORRECTA —es lo que la clínica quiere que pase—. Derivar a Aurora,
 * que pidió un turno que el bot podía dar, es un fracaso. Si las dos cuentan
 * igual, la métrica premia derivar y es exactamente lo contrario de lo que
 * queremos.
 */

import { getRedisClient } from "@/lib/redis"

/** Qué vino a hacer el paciente. */
export type QueQueria =
  | "turno_nuevo"
  | "reagendar"
  | "cancelar"
  | "confirmar"
  | "consulta_practica"
  | "consulta_clinica"
  | "hablar_con_humano"
  | "otra"
  /** No se entiende qué quería, ni leyendo la conversación entera. */
  | "no_se_entiende"

export type Resultado =
  /** Consiguió lo que vino a buscar. */
  | "resuelto"
  /** Lo consiguió, pero le costó más mensajes de los que debería. */
  | "resuelto_con_friccion"
  /** No lo consiguió y el bot podía dárselo. */
  | "no_resuelto"
  /** Se lo derivó, y derivar era lo correcto. */
  | "derivado_bien"
  /** Se lo derivó algo que el bot podía resolver. */
  | "derivado_mal"
  /** Terminó en un error técnico. */
  | "error_tecnico"

export interface EtiquetaDeConversacion {
  /** El id del export: hash estable del teléfono. Nunca el teléfono. */
  id: string
  configId: string
  clinica?: string
  queQueria: QueQueria
  resultado: Resultado
  nota?: string
  /** Cuántos mensajes del bot tenía la conversación cuando se etiquetó. */
  mensajesDelBot?: number
  etiquetadoPor: string
  etiquetadoEn: string
}

/** Las que cuentan como que el paciente se fue con lo que vino a buscar. */
const SALIERON_BIEN: Resultado[] = ["resuelto", "resuelto_con_friccion", "derivado_bien"]

export function salioBien(resultado: Resultado): boolean {
  return SALIERON_BIEN.includes(resultado)
}

export interface ResumenDelCorpus {
  etiquetadas: number
  /** Cuántas salieron bien, incluida la derivación correcta. */
  bien: number
  /** 0 a 1. `null` sin etiquetas: cero sobre cero no es cero. */
  tasaDeExito: number | null
  porResultado: Record<Resultado, number>
  porIntencion: Record<string, number>
  /**
   * Mensajes del bot por conversación que salió bien.
   *
   * Es la versión por conversación de la métrica 2 de la línea de base, y la
   * más cercana al caso Aurora: lo que importa no es el promedio general sino
   * cuánto cuesta una conversación que SÍ termina bien.
   */
  mensajesPorConversacionBien: number | null
}

export function resumirCorpus(etiquetas: EtiquetaDeConversacion[]): ResumenDelCorpus {
  const porResultado = {
    resuelto: 0,
    resuelto_con_friccion: 0,
    no_resuelto: 0,
    derivado_bien: 0,
    derivado_mal: 0,
    error_tecnico: 0,
  } as Record<Resultado, number>
  const porIntencion: Record<string, number> = {}

  let bien = 0
  let mensajesDeLasBien = 0
  let bienConMensajes = 0

  for (const etiqueta of etiquetas) {
    porResultado[etiqueta.resultado] = (porResultado[etiqueta.resultado] || 0) + 1
    porIntencion[etiqueta.queQueria] = (porIntencion[etiqueta.queQueria] || 0) + 1

    if (salioBien(etiqueta.resultado)) {
      bien += 1
      if (typeof etiqueta.mensajesDelBot === "number") {
        mensajesDeLasBien += etiqueta.mensajesDelBot
        bienConMensajes += 1
      }
    }
  }

  return {
    etiquetadas: etiquetas.length,
    bien,
    tasaDeExito: etiquetas.length ? Math.round((bien / etiquetas.length) * 1000) / 1000 : null,
    porResultado,
    porIntencion,
    mensajesPorConversacionBien: bienConMensajes
      ? Math.round((mensajesDeLasBien / bienConMensajes) * 100) / 100
      : null,
  }
}

// ── Almacén ───────────────────────────────────────────────────────────────

/**
 * Una clave por etiqueta y un índice, no un blob con todas.
 *
 * Con un solo blob, dos personas etiquetando al mismo tiempo se pisan: la
 * segunda escritura parte de una copia que leyó antes de la primera y borra lo
 * que la otra acababa de guardar. Etiquetar cien conversaciones es un trabajo
 * de varias sesiones y es exactamente el caso donde eso pasa.
 *
 * Sin TTL: es el instrumento de medición, no un dato de la operación. Si vence,
 * se pierde el trabajo manual de etiquetar, que es lo más caro de todo esto.
 */
const PREFIJO = "evaluacion:etiqueta:"
const INDICE = "evaluacion:etiquetas:indice"

function clave(configId: string, id: string): string {
  return `${PREFIJO}${configId}:${id}`
}

export async function guardarEtiqueta(etiqueta: EtiquetaDeConversacion): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    await redis.set(clave(etiqueta.configId, etiqueta.id), JSON.stringify(etiqueta))
    await redis.sadd(INDICE, `${etiqueta.configId}:${etiqueta.id}`)
    return true
  } catch (error) {
    console.error("[EVALUACION] No se pudo guardar la etiqueta:", error)
    return false
  }
}

export async function leerEtiquetas(): Promise<EtiquetaDeConversacion[]> {
  const redis = getRedisClient()
  if (!redis) return []
  try {
    const referencias = ((await redis.smembers(INDICE)) as string[]) || []
    if (referencias.length === 0) return []

    // Una sola lectura para todas: el índice puede tener cientos.
    const claves = referencias.map((r) => `${PREFIJO}${r}`)
    const crudas = await redis.mget(...claves)
    return (crudas || [])
      .map((cruda: any) => {
        if (!cruda) return null
        try {
          return typeof cruda === "string" ? JSON.parse(cruda) : cruda
        } catch {
          return null
        }
      })
      .filter(Boolean) as EtiquetaDeConversacion[]
  } catch (error) {
    console.error("[EVALUACION] No se pudieron leer las etiquetas:", error)
    return []
  }
}

export async function borrarEtiqueta(configId: string, id: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    await redis.del(clave(configId, id))
    await redis.srem(INDICE, `${configId}:${id}`)
    return true
  } catch {
    return false
  }
}
