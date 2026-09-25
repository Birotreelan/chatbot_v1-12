/**
 * El token del portal: emisión, lectura y consumo (22/9/2026).
 *
 * ── Opaco, no cifrado ──────────────────────────────────────────────────────
 *
 * El token es un número aleatorio y nada más. No contiene datos: los datos
 * viven acá, en Redis, y el token es apenas la llave para buscarlos.
 *
 * La alternativa natural —un JWT con el id del paciente adentro— sería peor por
 * dos motivos. Mete información del paciente DENTRO de la URL, que termina en
 * el historial del navegador, en capturas y en proxies. Y si alguna vez se
 * filtrara la clave de firma, todas las URLs emitidas se vuelven legibles hacia
 * atrás. Un token opaco que venció no le sirve ni siquiera a nosotros.
 *
 * ── 192 bits ───────────────────────────────────────────────────────────────
 *
 * 24 bytes aleatorios en base64url: 32 caracteres. Adivinarlo no es una amenaza
 * que haya que considerar. La URL igual queda corta, que importa porque el
 * paciente la ve en la barra del navegador cuando va a gestionar un turno
 * médico.
 */

import { randomBytes, createHash } from "crypto"
import { getRedisClient } from "../redis"
import type { IdentidadDelPaciente } from "./pasos"
import {
  calcularVencimientos,
  estadoDelEnlace,
  type EstadoDelEnlace,
  type IntencionDelPortal,
  type OrigenDelEnlace,
} from "./vigencia"

const PREFIJO = "portal:"

/** Margen sobre la visibilidad antes de que Redis borre la clave. */
const MARGEN_TTL_SEGUNDOS = 24 * 60 * 60

export interface TurnoDelPortal {
  agendaId?: string
  fecha?: string
  fechaFormateada?: string
  hora?: string
  horaFormateada?: string
  profesional?: string
  /**
   * Cuando el recordatorio trae `Chatbot_Data`, viene el id del profesional y
   * no hace falta resolverlo por nombre. Es el camino bueno: buscar por nombre
   * falla con abreviaturas, comas y homónimos.
   */
  profesionalId?: string
  sede?: string
  direccion?: string
}

export interface ContextoDelPortal {
  configId: string
  clienteId?: string
  /** Teléfono al que se le mandó el enlace. Normalizado. */
  phone: string
  intencion: IntencionDelPortal
  origen: OrigenDelEnlace

  /** Identidad ya resuelta, para no volver a preguntarla en el portal. */
  pacienteId?: string
  /**
   * Nombre completo, para saludar.
   *
   * Para RESERVAR no alcanza: `set_turno` exige `Paciente_Nombre` y
   * `Paciente_Apellido` por separado. Por eso están también los dos campos de
   * abajo — ver la nota de `datosDesdeElContexto`.
   */
  pacienteNombre?: string
  /** Sólo los nombres de pila, como los manda la clínica en `Chatbot_Data`. */
  pacienteNombres?: string
  /** Sólo el apellido, como lo manda la clínica. */
  pacienteApellido?: string
  /** El email de la ficha, si la clínica lo mandó. */
  pacienteEmail?: string
  pacienteDNI?: string
  obraSocialId?: string
  sedeId?: string

  /** El turno sobre el que se actúa. Ausente cuando se pide uno nuevo. */
  turno?: TurnoDelPortal

  /**
   * Lo que el propio portal averiguó sobre el paciente (23/9/2026).
   *
   * Cuando el bot no lo reconoció por su teléfono, el portal le pide el DNI,
   * busca la ficha y —si no tiene— lo da de alta. Todo eso se guarda acá.
   *
   * ── Por qué en el token y no en la URL ─────────────────────────────────
   *
   * Los filtros de búsqueda (especialidad, profesional) viajan por query
   * string, y está bien: son ids opacos de un catálogo público. El DNI, el
   * nombre y el email de una persona no. La URL termina en el historial del
   * navegador, en capturas de pantalla y en cualquier `Referer` que el
   * navegador mande. Es la misma razón por la que el token es opaco y no un
   * JWT con los datos adentro.
   */
  identidad?: IdentidadDelPaciente

  /**
   * Enlace de prueba (23/9/2026).
   *
   * Recorre TODAS las pantallas y termina mostrando el resultado, pero no
   * reserva ni cancela nada contra el proxy. Existe para poder probar el portal
   * antes de que Meta apruebe las plantillas, y también después: es la única
   * forma de revisar la interfaz en la cuenta de una clínica real sin tocarle
   * la agenda a nadie.
   *
   * La bandera vive en el token y no en una variable de entorno a propósito:
   * así conviven enlaces de prueba y reales en el mismo despliegue, y no hay
   * un interruptor global que alguien se pueda olvidar de apagar.
   */
  demo?: boolean

  creadoEn: string
  venceAccion: string
  venceVisibilidad: string

  /**
   * Presente cuando la gestión ya se hizo. A partir de acá el enlace muestra
   * el resultado y no deja gestionar de nuevo.
   */
  resultado?: {
    texto: string
    cuando: string
    turno?: TurnoDelPortal
  }

  /**
   * Hash del secreto del primer dispositivo que abrió el enlace.
   *
   * Es un REGISTRO, no un muro: si después se abre desde otro navegador se deja
   * pasar y se anota. Bloquear dejaría afuera al paciente que tocó "abrir en
   * Chrome" o a quien usa un iPhone que limpió el almacenamiento del navegador
   * interno de WhatsApp — un falso positivo que cuesta más que lo que evita.
   */
  dispositivo?: string
  /** Cuántas veces se abrió desde un dispositivo distinto al primero. */
  aperturasDeOtroDispositivo?: number
  aperturas?: number
}

export interface EnlaceEmitido {
  token: string
  url: string
  contexto: ContextoDelPortal
}

function clave(token: string): string {
  return `${PREFIJO}${token}`
}

function hashear(valor: string): string {
  return createHash("sha256").update(valor).digest("hex").slice(0, 32)
}

/** El token en sí. 24 bytes = 192 bits, en 32 caracteres seguros para una URL. */
export function generarToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * La URL que ve el paciente.
 *
 * `/p/` y no `/portal/turnos/` a propósito: cuanto más corta, menos ruido en la
 * barra del navegador y menos posibilidad de que se corte al compartirla.
 */
export function urlDelPortal(token: string, baseUrl?: string): string {
  return `${baseDelPortal(baseUrl)}/p/${token}`
}

/**
 * De dónde sale el dominio.
 *
 * `APP_URL` es la que ya usa el proyecto. `VERCEL_URL` es el respaldo que
 * Vercel inyecta sola en cada deploy, y viene sin protocolo. Si no hay ninguna
 * de las dos, queda una URL relativa — que en un mensaje de WhatsApp no sirve
 * para nada, así que el llamador debería pasar `baseUrl` a mano.
 */
export function baseDelPortal(baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/+$/, "")
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "")
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, "")
  return ""
}

/** Emite un enlace y guarda su contexto. */
export async function emitirEnlace(params: {
  configId: string
  clienteId?: string
  phone: string
  intencion: IntencionDelPortal
  origen: OrigenDelEnlace
  pacienteId?: string
  pacienteNombre?: string
  pacienteNombres?: string
  pacienteApellido?: string
  pacienteEmail?: string
  pacienteDNI?: string
  obraSocialId?: string
  sedeId?: string
  turno?: TurnoDelPortal
  baseUrl?: string
  demo?: boolean
}): Promise<EnlaceEmitido | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const { venceAccion, venceVisibilidad } = calcularVencimientos({
    origen: params.origen,
    fechaDelTurno: params.turno?.fecha,
  })

  const contexto: ContextoDelPortal = {
    configId: params.configId,
    clienteId: params.clienteId,
    phone: params.phone,
    intencion: params.intencion,
    origen: params.origen,
    pacienteId: params.pacienteId,
    pacienteNombre: params.pacienteNombre,
    pacienteNombres: params.pacienteNombres,
    pacienteApellido: params.pacienteApellido,
    pacienteEmail: params.pacienteEmail,
    pacienteDNI: params.pacienteDNI,
    obraSocialId: params.obraSocialId,
    sedeId: params.sedeId,
    turno: params.turno,
    demo: params.demo === true ? true : undefined,
    creadoEn: new Date().toISOString(),
    venceAccion,
    venceVisibilidad,
    aperturas: 0,
  }

  const token = generarToken()
  const ttl = Math.max(
    60,
    Math.ceil((new Date(venceVisibilidad).getTime() - Date.now()) / 1000) + MARGEN_TTL_SEGUNDOS,
  )

  await redis.setex(clave(token), ttl, JSON.stringify(contexto))

  console.log(
    `[PORTAL] Enlace emitido para ${params.phone} (${params.intencion}, ${params.origen}), vence ${venceAccion}`,
  )

  return { token, url: urlDelPortal(token, params.baseUrl), contexto }
}

export interface LecturaDelEnlace {
  contexto: ContextoDelPortal
  estado: EstadoDelEnlace
  /** true si este dispositivo no es el primero que abrió el enlace. */
  dispositivoDistinto: boolean
}

/**
 * Lee el contexto y devuelve en qué estado está.
 *
 * `secretoDelDispositivo` es la cookie del navegador. En la primera apertura se
 * guarda su hash; en las siguientes se compara. Ver la nota de `dispositivo`:
 * no bloquea, sólo registra.
 */
export async function leerEnlace(
  token: string,
  secretoDelDispositivo?: string | null,
): Promise<LecturaDelEnlace | null> {
  const redis = getRedisClient()
  if (!redis || !token) return null

  const crudo = await redis.get(clave(token))
  if (!crudo) return null

  let contexto: ContextoDelPortal
  try {
    contexto = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as ContextoDelPortal)
  } catch {
    return null
  }

  const estado = estadoDelEnlace(contexto)

  let dispositivoDistinto = false
  if (secretoDelDispositivo) {
    const hash = hashear(secretoDelDispositivo)
    if (!contexto.dispositivo) {
      contexto.dispositivo = hash
    } else if (contexto.dispositivo !== hash) {
      dispositivoDistinto = true
      contexto.aperturasDeOtroDispositivo = (contexto.aperturasDeOtroDispositivo || 0) + 1
      console.warn(`[PORTAL] Enlace abierto desde otro dispositivo (${contexto.phone})`)
    }
  }

  contexto.aperturas = (contexto.aperturas || 0) + 1
  await guardar(token, contexto)

  return { contexto, estado, dispositivoDistinto }
}

/**
 * Marca el enlace como gestionado.
 *
 * `texto` es lo que el paciente va a leer cada vez que vuelva a abrirlo, así
 * que tiene que describir lo que quedó, no lo que se pidió: "Tu turno quedó
 * para el viernes 26/09 a las 08:25", no "Recibimos tu solicitud".
 */
export async function consumirEnlace(
  token: string,
  resultado: { texto: string; turno?: TurnoDelPortal },
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false

  const crudo = await redis.get(clave(token))
  if (!crudo) return false

  const contexto: ContextoDelPortal = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)

  // Si ya se gestionó, no se pisa: el primer resultado es el que ocurrió.
  if (contexto.resultado) return false

  contexto.resultado = {
    texto: resultado.texto,
    cuando: new Date().toISOString(),
    turno: resultado.turno,
  }

  await guardar(token, contexto)
  console.log(`[PORTAL] Enlace consumido (${contexto.intencion}) para ${contexto.phone}`)
  return true
}

/**
 * Guarda lo que el portal averiguó del paciente (23/9/2026).
 *
 * Se mergea sobre lo que ya había en vez de pisarlo: el alta llega en dos
 * pantallas (DNI primero, datos después) y la segunda no vuelve a mandar lo de
 * la primera.
 *
 * NO se toca nada fuera de `identidad`. Un enlace ya gestionado tampoco se
 * modifica: si el turno ya se reservó, cambiarle los datos al contexto sólo
 * puede confundir a quien después lea el registro.
 */
export async function guardarIdentidad(
  token: string,
  identidad: Partial<IdentidadDelPaciente>,
): Promise<ContextoDelPortal | null> {
  const redis = getRedisClient()
  if (!redis) return null

  const crudo = await redis.get(clave(token))
  if (!crudo) return null

  const contexto: ContextoDelPortal = typeof crudo === "string" ? JSON.parse(crudo) : (crudo as any)
  if (contexto.resultado) return contexto

  contexto.identidad = { ...(contexto.identidad || {}), ...identidad }

  await guardar(token, contexto)
  return contexto
}

async function guardar(token: string, contexto: ContextoDelPortal): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  const restante = Math.ceil((new Date(contexto.venceVisibilidad).getTime() - Date.now()) / 1000)
  const ttl = Math.max(60, restante + MARGEN_TTL_SEGUNDOS)
  await redis.setex(clave(token), ttl, JSON.stringify(contexto))
}
