/**
 * Pausar y reanudar TODOS los envíos de WhatsApp de un cliente (1/10/2026).
 *
 * Pensado para que el sistema del cliente lo llame solo —"cortá el gasto
 * ahora"— sin depender de que alguien entre al dashboard.
 *
 *   GET  /api/envios/pausa        → estado actual
 *   POST /api/envios/pausa        → { "pausado": true | false, "motivo": "..." }
 *
 * En los dos casos, la clave va en el encabezado `x-api-key`. No se acepta por
 * query string: las URLs quedan escritas en los logs de Vercel, en los del
 * proxy del cliente y en cualquier intermediario, y una credencial en un log es
 * una credencial filtrada.
 *
 * Dos claves posibles —la del cliente o la compartida de `PAUSA_API_KEY`—, y
 * con la compartida hay que agregar `cliente_id`. Ver `autorizar`.
 *
 * Mientras está pausado no sale NADA hacia Meta por ese número: ni respuestas
 * del bot, ni recordatorios, ni confirmaciones del portal, ni lo que escriba un
 * agente desde el panel de soporte. Recibir sigue funcionando: los mensajes del
 * paciente se guardan y se ven en el monitor, porque Meta cobra lo que se
 * manda, no lo que entra.
 *
 * La pausa NO vence sola. Dura hasta que alguien la levante.
 */

import { timingSafeEqual } from "crypto"

import { type NextRequest, NextResponse } from "next/server"

import { configDeLaClave } from "@/lib/pausa-claves"
import { estadoDePausa, pausarEnvios, reanudarEnvios } from "@/lib/pausa-de-envios"
import { getWhatsAppConfig, getConfigByClienteId } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Resuelve a qué cuenta se refiere el pedido.
 *
 * Dos formas de autenticarse, y la diferencia entre ellas es quién dice de qué
 * cliente se trata:
 *
 *  1. **Clave por cliente** (`pausa:clave:…`). La clave YA identifica la
 *     cuenta, así que el pedido no necesita decir nada más. Es la más segura:
 *     quien la tenga sólo puede pausar lo suyo.
 *
 *  2. **Clave compartida** (`PAUSA_API_KEY`). Una sola para todos, en una
 *     variable de entorno. Como no identifica a nadie, el pedido TIENE que
 *     traer `cliente_id`.
 *
 * La segunda es más simple de repartir y tiene un costo que conviene tener
 * presente: cualquiera que la tenga puede pausar a cualquier cliente, y una
 * filtración obliga a rotarla para todos a la vez. Por eso se intenta primero
 * la clave por cliente: si un cliente tiene la suya, sigue funcionando y sigue
 * estando acotado a su cuenta.
 *
 * Devuelve el `phoneNumberId`, que es con lo que trabaja la pausa: quien llama
 * habla de su cuenta, no de un número de Meta, así que la traducción se hace
 * una sola vez acá. Ver lib/pausa-de-envios.ts.
 */
async function autorizar(request: NextRequest, clienteId?: string) {
  const clave = request.headers.get("x-api-key")
  if (!clave) return null

  // ── Camino 1: la clave identifica al cliente ──────────────────────────
  const configId = await configDeLaClave(clave)
  if (configId) {
    const config = await getWhatsAppConfig(configId)
    if (!config?.phoneNumberId) return null
    return { configId, phoneNumberId: config.phoneNumberId, nombre: config.displayName }
  }

  // ── Camino 2: la clave compartida ─────────────────────────────────────
  //
  // Comparación de largo constante. Un `===` sobre cadenas corta en el primer
  // carácter distinto, y esa diferencia de tiempo —medible a través de la red
  // con suficientes intentos— deja adivinar la clave carácter por carácter.
  const compartida = process.env.PAUSA_API_KEY
  if (!compartida || !claveCoincide(clave, compartida)) return null

  if (!clienteId) return { faltaClienteId: true as const }

  const config = await getConfigByClienteId(clienteId)
  if (!config?.phoneNumberId) return null

  return { configId: config.id, phoneNumberId: config.phoneNumberId, nombre: config.displayName }
}

function claveCoincide(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida)
  const b = Buffer.from(esperada)
  // timingSafeEqual exige el mismo largo; si difieren, ya no coinciden.
  return a.length === b.length && timingSafeEqual(a, b)
}

const NO_AUTORIZADO = NextResponse.json(
  { exito: false, error: "Clave inválida o ausente. Enviá tu clave en el encabezado x-api-key." },
  { status: 401 },
)

const FALTA_CLIENTE = NextResponse.json(
  {
    exito: false,
    error: 'Con la clave compartida hay que indicar "cliente_id" (en el cuerpo, o como parámetro en el GET).',
  },
  { status: 400 },
)

export async function GET(request: NextRequest) {
  const clienteId = new URL(request.url).searchParams.get("cliente_id") || undefined
  const cuenta = await autorizar(request, clienteId)
  if (!cuenta) return NO_AUTORIZADO
  if ("faltaClienteId" in cuenta) return FALTA_CLIENTE

  const estado = await estadoDePausa(cuenta.phoneNumberId)
  return NextResponse.json({ exito: true, cliente: cuenta.nombre, ...estado })
}

export async function POST(request: NextRequest) {
  // El cuerpo se lee ANTES de autorizar porque puede traer el `cliente_id` que
  // la clave compartida no identifica por sí sola.
  let cuerpo: any = {}
  try {
    cuerpo = await request.json()
  } catch {
    // Cuerpo ilegible: se trata como falta el campo, abajo.
  }

  const cuenta = await autorizar(
    request,
    typeof cuerpo?.cliente_id === "string" ? cuerpo.cliente_id : undefined,
  )
  if (!cuenta) return NO_AUTORIZADO
  if ("faltaClienteId" in cuenta) return FALTA_CLIENTE

  // Se exige el booleano explícito. Un endpoint que alterna el estado según
  // cómo estaba —un "toggle"— es peligroso acá: un reintento automático por
  // timeout, que el cliente no controla, reanudaría los envíos que acababa de
  // cortar. Con un valor explícito, repetir el pedido no cambia el resultado.
  if (typeof cuerpo?.pausado !== "boolean") {
    return NextResponse.json(
      { exito: false, error: 'Falta el campo "pausado" (true para pausar, false para reanudar).' },
      { status: 400 },
    )
  }

  const motivo = typeof cuerpo.motivo === "string" ? cuerpo.motivo.slice(0, 200) : undefined

  const ok = cuerpo.pausado
    ? await pausarEnvios(cuenta.phoneNumberId, { por: "api", motivo })
    : await reanudarEnvios(cuenta.phoneNumberId, "api")

  if (!ok) {
    return NextResponse.json(
      { exito: false, error: "No se pudo guardar el estado. Reintentá en unos segundos." },
      { status: 503 },
    )
  }

  return NextResponse.json({
    exito: true,
    cliente: cuenta.nombre,
    pausado: cuerpo.pausado,
    mensaje: cuerpo.pausado
      ? "Envíos pausados. No se va a enviar ningún mensaje hasta que se reanude."
      : "Envíos reanudados.",
  })
}
