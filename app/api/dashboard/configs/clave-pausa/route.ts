/**
 * Emitir la clave con la que el cliente pausa sus propios envíos.
 *
 * La clave en claro se devuelve UNA sola vez, acá. Después queda sólo su hash,
 * así que no hay forma de volver a mostrarla: si el cliente la pierde, se emite
 * otra. Ver lib/pausa-claves.ts.
 *
 *   GET  → ¿tiene clave?, de cuándo es (sin poder usarla)
 *   POST → emite una nueva y revoca la anterior
 */

import { NextResponse } from "next/server"

import { requireAuthForApi } from "@/lib/auth"
import { datosDeLaClave, emitirClave, revocarClave } from "@/lib/pausa-claves"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const configId = new URL(request.url).searchParams.get("configId")
  if (!configId) return NextResponse.json({ error: "configId requerido" }, { status: 400 })

  return NextResponse.json({ exito: true, clave: await datosDeLaClave(configId) })
}

export async function POST(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const { configId } = await request.json()
  if (!configId) return NextResponse.json({ error: "configId requerido" }, { status: 400 })

  const emitida = await emitirClave(configId, session.username)
  if (!emitida) {
    return NextResponse.json({ error: "No se pudo emitir la clave" }, { status: 503 })
  }

  return NextResponse.json({
    exito: true,
    // Única vez que viaja en claro. El cliente la guarda o la pierde.
    clave: emitida.clave,
    datos: emitida.datos,
    aviso: "Guardala ahora: no se puede volver a mostrar.",
  })
}

export async function DELETE(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const configId = new URL(request.url).searchParams.get("configId")
  if (!configId) return NextResponse.json({ error: "configId requerido" }, { status: 400 })

  await revocarClave(configId)
  return NextResponse.json({ exito: true })
}
