/**
 * La llave con la que el sistema de la clínica se identifica al llamarnos
 * (18/11/2026).
 *
 * ── Qué cierra ────────────────────────────────────────────────────────────
 *
 * `/api/proxylistener` y `/api/send-template` son por donde entran los
 * recordatorios. Hasta hoy aceptaban cualquier request: quien conociera la URL
 * podía mandar plantillas de WhatsApp desde el número de cualquier clínica,
 * con el texto y el destinatario que quisiera. El `Cliente_Id` y el
 * `Phone_Number_Id` viajan en el propio cuerpo, así que no hacía falta
 * adivinar nada más.
 *
 * ── Se replica lo que ya existe, no se inventa ────────────────────────────
 *
 * `/api/envios/pausa` resolvió esta misma pregunta el 1/10 y está en
 * producción: clave en un encabezado, comparación de tiempo constante y nunca
 * por query string —las URLs quedan escritas en los logs de Vercel, en los
 * del proxy del cliente y en cualquier intermediario—.
 *
 * ── Una sola llave, la que ya tienen ──────────────────────────────────────
 *
 * Decisión del 18/11: se usa la MISMA clave con la que el sistema externo da
 * de alta clientes en `/api/clients`, y no una por clínica. El motivo es
 * operativo y es bueno: no hay nada nuevo que distribuir, ni una segunda
 * credencial que alguien tenga que recordar dónde guardó.
 *
 * Lo que se resigna, para que esté dicho: una clave compartida no distingue a
 * una clínica de otra, así que si se filtra, se filtran todas, y no se puede
 * detectar que una mande mensajes en nombre de otra. `PROXYLISTENER_API_KEY`
 * queda disponible para separarlas el día que convenga, sin tocar código.
 *
 * ── Modo tolerante, y por qué ─────────────────────────────────────────────
 *
 * Arranca SIN rechazar. Verifica, deja constancia en el log y deja pasar.
 *
 * Cerrar de una sería apostar a que sabemos quién nos llama, y no lo sabemos:
 * si quedó un cron viejo apuntando desde otro lado, los recordatorios de esa
 * clínica dejan de salir y nos enteramos por el reclamo de un paciente que no
 * recibió el suyo. Con el modo tolerante, durante unos días el log dice
 * exactamente qué llamadas llegan sin llave y de dónde, y recién con eso a la
 * vista se cierra.
 *
 * El cierre NO necesita un deploy: es la variable de entorno
 * `EXIGIR_LLAVE_DE_ENTRADA=1`. Se prende cuando el log esté limpio y se apaga
 * en diez segundos si algo salió mal.
 */

import { timingSafeEqual } from "crypto"

import { configDeLaClave } from "./pausa-claves"
import { getWhatsAppConfig } from "./db"

export type EstadoDeLaLlave =
  /** Vino una clave del cliente y corresponde al `Cliente_Id` del cuerpo. */
  | "ok_por_cliente"
  /** Vino la clave compartida. No distingue entre clínicas. */
  | "ok_compartida"
  /** No vino ninguna clave. */
  | "sin_llave"
  /** Vino una clave que no reconocemos. */
  | "desconocida"
  /** La clave es de otra clínica distinta a la del `Cliente_Id` del cuerpo. */
  | "otro_cliente"

export interface Verificacion {
  estado: EstadoDeLaLlave
  /** `true` sólo si la llamada quedaría aceptada con la puerta cerrada. */
  valida: boolean
  /** El cliente al que pertenece la clave, cuando se pudo resolver. */
  clienteDeLaClave?: string
}

function coincide(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida)
  const b = Buffer.from(esperada)
  // timingSafeEqual exige el mismo largo; si difieren, ya no coinciden. Y la
  // comparación de largo constante evita que se adivine la clave midiendo
  // cuánto tarda en fallar.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verifica la llave. No rechaza: eso lo decide el llamador.
 *
 * `clienteId` es el `Cliente_Id` del cuerpo. Cuando la clave es de un cliente
 * y el cuerpo dice otro, se devuelve `otro_cliente`: es el caso que una clave
 * compartida no puede detectar —una clínica mandando mensajes en nombre de
 * otra— y es la razón principal para preferir la clave por cliente.
 */
/**
 * La clave, venga por donde venga.
 *
 * Se aceptan los dos encabezados a propósito: `/api/clients` —el alta de
 * clientes, que el sistema externo ya usa— espera `Authorization: Bearer`, y
 * `/api/envios/pausa` espera `x-api-key`. Pedirle a quien llama que use uno
 * distinto según la ruta es una forma de que alguien se equivoque un martes a
 * las tres de la mañana. Que mande el que ya tiene escrito.
 *
 * Por query string NO se acepta, y eso no es negociable: las URLs quedan en
 * los logs de Vercel, en los del proxy del cliente y en cualquier
 * intermediario.
 */
function claveDelPedido(request: Request): string | null {
  const porHeader = request.headers.get("x-api-key")
  if (porHeader) return porHeader

  // El esquema, sin mirar mayúsculas: la norma HTTP dice que `Bearer`,
  // `bearer` y `BEARER` son lo mismo, y varios clientes lo escriben en
  // minúscula. Una llave correcta rechazada por eso se vería exactamente
  // igual que una llave equivocada, y nos llevaría medio día encontrarlo. El
  // valor sí se compara tal cual.
  const autorizacion = request.headers.get("authorization") || ""
  const [esquema, ...resto] = autorizacion.split(" ")
  if (esquema.toLowerCase() === "bearer") {
    const valor = resto.join(" ").trim()
    if (valor) return valor
  }

  return null
}

/**
 * La clave compartida que se acepta hoy.
 *
 * Es la misma con la que el sistema externo da de alta clientes: fue la
 * decisión del 18/11, para que no tenga que distribuir ni recordar una
 * segunda. `PROXYLISTENER_API_KEY` existe para el día que se quieran separar
 * —se define y ésta deja de aceptarse, sin tocar código—, que es lo que
 * conviene si alguna vez la de alta llega a más manos que las de hoy.
 */
function claveCompartida(): string | undefined {
  return process.env.PROXYLISTENER_API_KEY || process.env.CLIENTS_API_KEY
}

export async function verificarLlaveDeEntrada(
  request: Request,
  clienteId?: string | null,
): Promise<Verificacion> {
  const clave = claveDelPedido(request)
  if (!clave) return { estado: "sin_llave", valida: false }

  // ── Camino 1: la clave compartida ──────────────────────────────────────
  //
  // Va PRIMERO porque es el camino normal y no toca Redis. Al revés, cada
  // recordatorio —que son miles por día— pagaría una lectura extra para
  // terminar cayendo acá igual.
  const compartida = claveCompartida()
  if (compartida && coincide(clave, compartida)) {
    return { estado: "ok_compartida", valida: true }
  }

  // ── Camino 2: una clave por cliente ────────────────────────────────────
  //
  // Hoy no se usa —se eligió la compartida— pero el índice ya existe para
  // /api/envios/pausa y reconocerla no cuesta nada. Si algún día se migra,
  // esto ya distingue a una clínica de otra sin tocar nada.
  try {
    const configId = await configDeLaClave(clave)
    if (configId) {
      const config = await getWhatsAppConfig(configId)
      const duenoDeLaClave = config?.cliente_id || ""
      if (!clienteId || !duenoDeLaClave || duenoDeLaClave === clienteId) {
        return { estado: "ok_por_cliente", valida: true, clienteDeLaClave: duenoDeLaClave }
      }
      return { estado: "otro_cliente", valida: false, clienteDeLaClave: duenoDeLaClave }
    }
  } catch (error) {
    // Un problema para leer el índice no puede hacerse pasar por una clave
    // inválida: se registra y se devuelve desconocida.
    console.warn("[LLAVE] No se pudo resolver la clave del cliente:", error)
  }

  return { estado: "desconocida", valida: false }
}

/** ¿Está cerrada la puerta? Ver la nota del encabezado. */
export function exigeLlave(): boolean {
  return process.env.EXIGIR_LLAVE_DE_ENTRADA === "1"
}

/**
 * Deja constancia, con lo que hace falta para rastrear al llamador y nada más.
 *
 * La clave NO se registra, ni enmascarada: este log existe para encontrar
 * quién llama sin credencial, no para auditar cuál usó.
 */
export function registrarLlave(params: {
  ruta: string
  verificacion: Verificacion
  clienteId?: string | null
  request: Request
}): void {
  const { ruta, verificacion, clienteId, request } = params
  if (verificacion.valida) return

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "desconocida"

  const detalle =
    verificacion.estado === "otro_cliente"
      ? `la clave es del cliente ${verificacion.clienteDeLaClave} y el cuerpo dice ${clienteId}`
      : verificacion.estado === "desconocida"
        ? "la clave no corresponde a ningún cliente ni a la compartida"
        : "no vino el encabezado x-api-key"

  console.warn(
    `[LLAVE] ${ruta} ${exigeLlave() ? "RECHAZADA" : "aceptada en modo tolerante"}: ${detalle}. ` +
      `Cliente_Id: ${clienteId || "—"} · IP: ${ip}`,
  )
}
