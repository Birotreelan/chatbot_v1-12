/**
 * El estado de la integración con el sistema de la clínica.
 *
 *   GET    ?clienteId=…   → el tablero de un cliente
 *   DELETE ?clienteId=…   → borra lo observado, para medir desde cero
 *
 * El DELETE existe para una situación concreta: después de arreglar algo del
 * lado de la clínica, el tablero sigue mostrando el "incompleto" viejo hasta
 * que llegue uno bueno. Poder reiniciar la medición es lo que permite
 * comprobar el arreglo en vez de esperar a que el tiempo lo tape.
 */

import { type NextRequest, NextResponse } from "next/server"

import { requireAuthForApi } from "@/lib/auth"
import { getConfigByClienteId } from "@/lib/db"
import { estadoDeIntegracion } from "@/lib/integracion-externa/estado"
import { olvidarObservaciones } from "@/lib/integracion-externa/registro"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const clienteId = new URL(request.url).searchParams.get("clienteId")
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })

  const config = await getConfigByClienteId(clienteId).catch(() => null)
  const estado = await estadoDeIntegracion(clienteId, config?.tiposNoAplicables || [])

  return NextResponse.json({ exito: true, cliente: config?.displayName, ...estado })
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const clienteId = new URL(request.url).searchParams.get("clienteId")
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })

  await olvidarObservaciones(clienteId)
  return NextResponse.json({ exito: true })
}
