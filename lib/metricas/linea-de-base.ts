/**
 * Las cuatro métricas del motor conversacional (24/11/2026).
 *
 * ── Para qué existe ───────────────────────────────────────────────────────
 *
 * El plan de la próxima versión del chatbot cambia quién escribe los mensajes
 * que el paciente lee. La trampa de ese trabajo es que "conversa mejor" se
 * siente y no se mide, y entonces cada cambio se discute por impresiones. Esto
 * mide, y se puede volver a correr: la línea de base de hoy y la de dentro de
 * dos meses salen de la misma función, así que la comparación es honesta.
 *
 * ── Las cuatro, y de dónde sale cada una ──────────────────────────────────
 *
 *  1. Gestiones resueltas sobre conversaciones. ¿El bot sirve?
 *  2. Mensajes por gestión resuelta. ¿Conversa o interroga?
 *  3. Conversaciones que terminan en derivación o en error. ¿Dónde se cae?
 *  4. Costo por gestión resuelta. ¿La mejora se paga sola?
 *
 * Ninguna necesita instrumentación nueva: los eventos de turno ya se registran
 * por día (lib/appointment-stats.ts), los mensajes salientes los cuenta el
 * proxy de WhatsApp (lib/consumos-wpp.ts) y las conversaciones están en Redis
 * con sus mensajes (lib/conversations.ts). Agregar un contador nuevo habría
 * significado medir desde cero; así, la primera corrida ya tiene historia.
 *
 * ── Qué es una "gestión resuelta", que es la decisión difícil ─────────────
 *
 * Los eventos no se pueden sumar de frente. Un reagendamiento produce DOS:
 * una cancelación y una reserva marcada como `rescheduled`. Sumando todo, el
 * paciente que mueve su turno cuenta como dos gestiones y la métrica mejora
 * sola cada vez que alguien reprograma.
 *
 *     gestiones = confirmados
 *               + turnos nuevos
 *               + reagendamientos
 *               + (cancelaciones − reagendamientos)
 *
 * O sea: una cancelación que NO terminó en otro turno es su propia gestión, y
 * la que sí terminó se cuenta una sola vez, como reagendamiento. El resto no
 * se cuenta: `template_sent` es nuestro, `user_initiated` es el denominador y
 * `reschedule_started` es un intento, no un resultado.
 *
 * ── Y qué es una "conversación" ───────────────────────────────────────────
 *
 * Un teléfono que escribió al menos una vez en la ventana. No un episodio
 * separado por silencios: el historial guarda los mensajes por teléfono, y
 * partirlos por un corte de N horas sería inventar un criterio que después hay
 * que defender. Contar personas es más grueso y es más difícil de discutir.
 *
 * La consecuencia hay que tenerla presente al leer el número: alguien que
 * escribió el lunes y el jueves es UNA conversación con dos gestiones, así que
 * la métrica 1 puede pasar del 100%. Es información, no un error.
 *
 * ── Por qué los mensajes salen del proxy y no de nuestro historial ────────
 *
 * Porque lo que se paga es lo que Meta registra, y es también lo que el
 * paciente recibió. Nuestro historial puede tener un mensaje que falló al
 * enviarse, y le faltan los que salieron por caminos que no lo escriben. Para
 * la métrica 2 se usan los mensajes de SERVICIO (`servicio.total`), no las
 * plantillas: los recordatorios los dispara el sistema de la clínica y no
 * dependen de si el bot conversa bien. Los 16 mensajes de Aurora eran de
 * servicio.
 */

import { getAppointmentStatsByClienteIdFiltered } from "@/lib/appointment-stats"
import { getConsumoDeWpp } from "@/lib/consumos-wpp"
import { getConversationContacts, getConversationMessages } from "@/lib/conversations"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"

/** US$ por mensaje saliente, con impuestos. El mismo número que Facturación. */
export const COSTO_POR_MENSAJE_USD = 0.0318

export interface MetricasDelCliente {
  configId: string
  clienteId?: string
  clinica: string

  /** Teléfonos que escribieron al menos una vez en la ventana. */
  conversaciones: number

  gestiones: {
    confirmados: number
    turnosNuevos: number
    reagendamientos: number
    /** Las que no terminaron en otro turno. Ver la nota del encabezado. */
    cancelacionesSolas: number
    total: number
  }

  mensajes: {
    /** Conversacionales salientes, los que dependen de cómo conversa el bot. */
    deServicio: number | null
    /** Recordatorios. Los dispara la clínica; van aparte. */
    plantillas: number | null
  }

  /** `null` cuando no se pudo medir, que no es lo mismo que cero. */
  resueltasPorConversacion: number | null
  mensajesPorGestion: number | null
  costoPorGestionUsd: number | null

  finales: {
    /** Conversaciones cuyo último mensaje del bot deriva a la clínica. */
    derivacion: number
    /** …o avisa de un problema técnico. */
    error: number
    /** …o es cualquier otra cosa. */
    otro: number
    /** Sobre cuántas conversaciones se pudo mirar el final. */
    revisadas: number
  }

  /** Lo que no se pudo medir y por qué. Para no leer un cero como un dato. */
  huecos: string[]
}

export interface LineaDeBase {
  desde: string
  hasta: string
  medidoEn: string
  clientes: MetricasDelCliente[]
  total: Omit<MetricasDelCliente, "configId" | "clienteId" | "clinica">
}

// ── Cómo termina una conversación ─────────────────────────────────────────

export type FinalDeLaConversacion = "derivacion" | "error" | "otro"

/**
 * Las frases que el código realmente emite.
 *
 * Esto es detección por texto y tiene su límite, así que conviene que esté
 * acotado y rastreable: cada marca de abajo sale de un mensaje que existe en
 * el repositorio, no de lo que supongo que diría el bot.
 *
 * El error es el más confiable: es una frase fija y nuestra. La derivación es
 * más difícil —el texto lo arma `fraseDerivacion` con el teléfono que cargó
 * cada clínica— así que además de las frases se busca el teléfono de ESE
 * cliente, que es la señal más precisa que tenemos.
 */
const MARCAS_DE_ERROR = [
  "hubo un problema",
  "intentá de nuevo en unos momentos",
  "intenta de nuevo en unos momentos",
  "estoy teniendo un problema",
  "no pudimos conectarnos",
]

const MARCAS_DE_DERIVACION = [
  "comunicate",
  "comunicarte",
  "contactanos",
  "contactate",
  "exclusivo para la gestión",
  "no puedo brindarte información médica",
  "se gestionan por teléfono",
  "turno por teléfono",
]

function normalizar(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

/**
 * Clasifica el ÚLTIMO mensaje del bot.
 *
 * "Termina en" es literal: lo que importa es con qué se quedó el paciente. Un
 * mensaje de error en el medio de una conversación que después se resolvió no
 * cuenta —y es correcto que no cuente, porque se resolvió—.
 *
 * El error gana sobre la derivación cuando están los dos: casi todos los
 * mensajes de error ofrecen además el teléfono, y lo que hay que arreglar es
 * el error.
 */
export function finalDeLaConversacion(
  ultimoMensajeDelBot: string | undefined | null,
  telefonoDeLaClinica?: string | null,
): FinalDeLaConversacion {
  const texto = normalizar(ultimoMensajeDelBot || "")
  if (!texto) return "otro"

  if (MARCAS_DE_ERROR.some((marca) => texto.includes(normalizar(marca)))) return "error"

  if (MARCAS_DE_DERIVACION.some((marca) => texto.includes(normalizar(marca)))) return "derivacion"

  // El teléfono de la clínica en el texto es derivación aunque la frase que lo
  // introduce no esté en la lista: un número de teléfono no aparece en un
  // mensaje del bot por otro motivo.
  const telefono = (telefonoDeLaClinica || "").trim()
  if (telefono) {
    const soloDigitos = telefono.replace(/[^0-9]/g, "")
    if (soloDigitos.length >= 6 && normalizar(texto).replace(/[^0-9]/g, "").includes(soloDigitos)) {
      return "derivacion"
    }
  }

  return "otro"
}

// ── Las cuentas ───────────────────────────────────────────────────────────

/**
 * Las gestiones resueltas, a partir de los contadores por día.
 *
 * Ver la nota del encabezado: el reagendamiento son dos eventos y una sola
 * gestión. `Math.max(0, …)` porque los contadores se llevan por separado y en
 * una ventana corta puede haber una reserva cuya cancelación quedó del lado de
 * afuera; un negativo ahí restaría gestiones que sí ocurrieron.
 */
export function contarGestiones(stats: {
  totalConfirmed: number
  totalCancelled: number
  totalRescheduled: number
  totalNewAppointments: number
}): MetricasDelCliente["gestiones"] {
  const cancelacionesSolas = Math.max(0, stats.totalCancelled - stats.totalRescheduled)
  return {
    confirmados: stats.totalConfirmed,
    turnosNuevos: stats.totalNewAppointments,
    reagendamientos: stats.totalRescheduled,
    cancelacionesSolas,
    total: stats.totalConfirmed + stats.totalNewAppointments + stats.totalRescheduled + cancelacionesSolas,
  }
}

/** Divide dejando `null` cuando la división no significa nada. */
function dividir(numerador: number | null, denominador: number): number | null {
  if (numerador === null) return null
  if (!denominador) return null
  return numerador / denominador
}

function redondear(valor: number | null, decimales = 2): number | null {
  if (valor === null || !Number.isFinite(valor)) return null
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

// ── La medición ───────────────────────────────────────────────────────────

/**
 * Cuántas conversaciones se revisan por cliente para clasificar el final.
 *
 * Las otras tres métricas salen de contadores agregados y no cuestan nada. Ésta
 * necesita leer el historial de cada teléfono, así que se acota: con 400
 * conversaciones el porcentaje ya es estable, y una medición que tarda cinco
 * minutos es una medición que nadie corre.
 */
const TOPE_DE_CONVERSACIONES_REVISADAS = 400

export async function medirLineaDeBase(params: {
  desde: string
  hasta: string
  /** Para medir una clínica sola. Vacío = todas. */
  configIds?: string[]
  /** Saltea la clasificación de finales, que es la parte lenta. */
  sinFinales?: boolean
}): Promise<LineaDeBase> {
  const { desde, hasta } = params
  const configs = await getAllWhatsAppConfigs()
  const elegidas = params.configIds?.length
    ? configs.filter((c: any) => params.configIds!.includes(c.id))
    : configs

  const clientes: MetricasDelCliente[] = []

  for (const config of elegidas as any[]) {
    const huecos: string[] = []

    // ── Conversaciones ────────────────────────────────────────────────────
    let conversaciones = 0
    let contactos: Array<{ phoneNumber: string }> = []
    try {
      contactos = await getConversationContacts(config.id, desde, hasta)
      conversaciones = contactos.length
    } catch (error) {
      huecos.push(`no se pudieron leer las conversaciones: ${String(error)}`)
    }

    // ── Gestiones ─────────────────────────────────────────────────────────
    let gestiones = contarGestiones({
      totalConfirmed: 0,
      totalCancelled: 0,
      totalRescheduled: 0,
      totalNewAppointments: 0,
    })
    if (config.cliente_id) {
      const stats = await getAppointmentStatsByClienteIdFiltered(config.cliente_id, desde, hasta)
      if (stats) gestiones = contarGestiones(stats)
      else huecos.push("no hay estadísticas de turnos para este cliente en la ventana")
    } else {
      huecos.push("la configuración no tiene cliente_id: no se pueden contar gestiones")
    }

    // ── Mensajes salientes ────────────────────────────────────────────────
    let deServicio: number | null = null
    let plantillas: number | null = null
    if (config.cliente_id) {
      const consumo = await getConsumoDeWpp(config.cliente_id, desde, hasta)
      if (consumo) {
        plantillas = consumo.plantillas
        deServicio = consumo.servicio?.total ?? null
        if (deServicio === null) {
          // El formato viejo del proxy no desglosa los de servicio. Vale
          // decirlo en vez de usar el total y llamarlo conversacional.
          huecos.push("el proxy devolvió el formato viejo: no hay desglose de mensajes de servicio")
        }
      } else {
        huecos.push("el proxy de consumos no respondió")
      }
    }

    // ── Cómo terminaron ───────────────────────────────────────────────────
    const finales = { derivacion: 0, error: 0, otro: 0, revisadas: 0 }
    if (!params.sinFinales && contactos.length > 0) {
      const aRevisar = contactos.slice(0, TOPE_DE_CONVERSACIONES_REVISADAS)
      if (contactos.length > aRevisar.length) {
        huecos.push(
          `los finales se midieron sobre ${aRevisar.length} de ${contactos.length} conversaciones`,
        )
      }
      for (const contacto of aRevisar) {
        try {
          // Los últimos mensajes alcanzan: se busca el último del bot.
          const { messages } = await getConversationMessages(config.id, contacto.phoneNumber, 10, 0)
          const delBot = [...messages].reverse().find((m) => m.role === "assistant")
          const final = finalDeLaConversacion(delBot?.content, config.escalationPhoneNumber)
          finales[final] += 1
          finales.revisadas += 1
        } catch {
          // Una conversación que no se pudo leer no se cuenta como ningún
          // final: inventarle uno movería el porcentaje.
        }
      }
    }

    clientes.push({
      configId: config.id,
      clienteId: config.cliente_id,
      clinica: config.displayName || config.id,
      conversaciones,
      gestiones,
      mensajes: { deServicio, plantillas },
      resueltasPorConversacion: redondear(dividir(gestiones.total, conversaciones)),
      mensajesPorGestion: redondear(dividir(deServicio, gestiones.total)),
      costoPorGestionUsd: redondear(
        dividir(deServicio === null ? null : deServicio * COSTO_POR_MENSAJE_USD, gestiones.total),
        4,
      ),
      finales,
      huecos,
    })
  }

  return {
    desde,
    hasta,
    medidoEn: new Date().toISOString(),
    clientes,
    total: totalizar(clientes),
  }
}

// ── Guardar la medición ───────────────────────────────────────────────────

/**
 * ── Por qué una medición se guarda y no se recalcula (24/11/2026) ─────────
 *
 * Porque dentro de dos meses la de hoy ya no se va a poder volver a hacer. Los
 * tres orígenes tienen vidas distintas: el consumo del proxy es permanente, los
 * eventos de turno duran 90 días, y las conversaciones —el denominador de la
 * métrica 1 y la base de la 3— vencen con el TTL del historial. O sea que la
 * ventana de hoy deja de ser medible bastante antes de que haga falta
 * compararla.
 *
 * Una medición guardada es además la única forma de que la comparación sea
 * honesta: queda escrito qué dio, con qué ventana y con qué versión de la
 * cuenta. Si mañana cambiamos la definición de "gestión resuelta", el número
 * viejo sigue siendo el número viejo y se nota que no son comparables.
 *
 * Sin TTL a propósito: son unos kilobytes por medición y su valor aparece justo
 * cuando pasa el tiempo.
 */
const PREFIJO = "metricas:linea_de_base:"
const INDICE = "metricas:linea_de_base:indice"

function claveDeLaMedicion(desde: string, hasta: string): string {
  return `${PREFIJO}${desde}_${hasta}`
}

export async function guardarMedicion(medicion: LineaDeBase): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  try {
    const clave = claveDeLaMedicion(medicion.desde, medicion.hasta)
    await redis.set(clave, JSON.stringify(medicion))
    // Un índice, para poder listarlas sin recorrer claves.
    await redis.sadd(INDICE, `${medicion.desde}_${medicion.hasta}`)
    console.log(`[METRICAS] Medición guardada: ${medicion.desde} → ${medicion.hasta}`)
    return true
  } catch (error) {
    console.error("[METRICAS] No se pudo guardar la medición:", error)
    return false
  }
}

export async function medicionesGuardadas(): Promise<string[]> {
  const redis = getRedisClient()
  if (!redis) return []
  try {
    const ventanas = (await redis.smembers(INDICE)) as string[]
    return (ventanas || []).sort()
  } catch {
    return []
  }
}

export async function leerMedicion(desde: string, hasta: string): Promise<LineaDeBase | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const crudo = await redis.get(claveDeLaMedicion(desde, hasta))
    if (!crudo) return null
    return typeof crudo === "string" ? JSON.parse(crudo) : (crudo as LineaDeBase)
  } catch {
    return null
  }
}

/**
 * El total, sumando y recalculando los cocientes.
 *
 * Los cocientes NO se promedian: el promedio de los promedios le da el mismo
 * peso a una clínica con tres conversaciones que a una con trescientas. Se
 * suman los numeradores y los denominadores y se divide una vez.
 */
export function totalizar(clientes: MetricasDelCliente[]): LineaDeBase["total"] {
  const conversaciones = clientes.reduce((s, c) => s + c.conversaciones, 0)
  const gestiones = clientes.reduce(
    (acum, c) => ({
      confirmados: acum.confirmados + c.gestiones.confirmados,
      turnosNuevos: acum.turnosNuevos + c.gestiones.turnosNuevos,
      reagendamientos: acum.reagendamientos + c.gestiones.reagendamientos,
      cancelacionesSolas: acum.cancelacionesSolas + c.gestiones.cancelacionesSolas,
      total: acum.total + c.gestiones.total,
    }),
    { confirmados: 0, turnosNuevos: 0, reagendamientos: 0, cancelacionesSolas: 0, total: 0 },
  )

  // Un cliente cuyo consumo no se pudo leer queda afuera de la suma, no como
  // cero: sumarle cero mensajes bajaría el promedio de todos.
  const conConsumo = clientes.filter((c) => c.mensajes.deServicio !== null)
  const deServicio = conConsumo.length
    ? conConsumo.reduce((s, c) => s + (c.mensajes.deServicio || 0), 0)
    : null
  const conPlantillas = clientes.filter((c) => c.mensajes.plantillas !== null)
  const plantillas = conPlantillas.length
    ? conPlantillas.reduce((s, c) => s + (c.mensajes.plantillas || 0), 0)
    : null

  const finales = clientes.reduce(
    (acum, c) => ({
      derivacion: acum.derivacion + c.finales.derivacion,
      error: acum.error + c.finales.error,
      otro: acum.otro + c.finales.otro,
      revisadas: acum.revisadas + c.finales.revisadas,
    }),
    { derivacion: 0, error: 0, otro: 0, revisadas: 0 },
  )

  const huecos: string[] = []
  if (conConsumo.length < clientes.length) {
    huecos.push(
      `${clientes.length - conConsumo.length} de ${clientes.length} clientes sin desglose de mensajes: ` +
        `los cocientes de mensajes y costo son de los ${conConsumo.length} que sí lo tienen`,
    )
  }

  return {
    conversaciones,
    gestiones,
    mensajes: { deServicio, plantillas },
    resueltasPorConversacion: redondear(dividir(gestiones.total, conversaciones)),
    mensajesPorGestion: redondear(dividir(deServicio, gestiones.total)),
    costoPorGestionUsd: redondear(
      dividir(deServicio === null ? null : deServicio * COSTO_POR_MENSAJE_USD, gestiones.total),
      4,
    ),
    finales,
    huecos,
  }
}
