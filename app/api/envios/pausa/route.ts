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
 * Mientras está pausado no sale NADA hacia Meta por ese número: ni respuestas
 * del bot, ni recordatorios, ni confirmaciones del portal, ni lo que escriba un
 * agente desde el panel de soporte. Recibir sigue funcionando: los mensajes del
 * paciente se guardan y se ven en el monitor, porque Meta cobra lo que se
 * manda, no lo que entra.
 *
 * La pausa NO vence sola. Dura hasta que alguien la levante.
 */

import { type NextRequest, NextResponse } from "next/server"

import { configDeLaClave } from "@/lib/pausa-claves"
import { estadoDePausa, pausarEnvios, reanudarEnvios } from "@/lib/pausa-de-envios"
import { getWhatsAppConfig } from "@/lib/db"

export const runtime = "nodejs"

/**
 * Resuelve el cliente a partir de la clave.
 *
 * Devuelve también el `phoneNumberId`, que es con lo que trabaja la pausa: el
 * que llama habla de su cuenta, no de un número de Meta, así que la traducción
 * se hace una sola vez acá. Ver lib/pausa-de-envios.ts.
 */
async function autorizar(request: NextRequest) {
  const clave = request.headers.get("x-api-key")
  const configId = await configDeLaClave(clave)
  if (!configId) return null

  const config = await getWhatsAppConfig(configId)
  if (!config?.phoneNumberId) return null

  return { configId, phoneNumberId: config.phoneNumberId, nombre: config.displayName }
}

const NO_AUTORIZADO = NextResponse.json(
  { exito: false, error: "Clave inválida o ausente. Enviá tu clave en el encabezado x-api-key." },
  { status: 401 },
)

export async function GET(request: NextRequest) {
  const cuenta = await autorizar(request)
  if (!cuenta) return NO_AUTORIZADO

  const estado = await estadoDePausa(cuenta.phoneNumberId)
  return NextResponse.json({ exito: true, cliente: cuenta.nombre, ...estado })
}

export async function POST(request: NextRequest) {
  const cuenta = await autorizar(request)
  if (!cuenta) return NO_AUTORIZADO

  let cuerpo: any = {}
  try {
    cuerpo = await request.json()
  } catch {
    // Cuerpo ilegible: se trata como falta el campo, abajo.
  }

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
