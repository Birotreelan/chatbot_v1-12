/**
 * El estado de la integración con el sistema de la clínica.
 *
 *   GET    ?clienteId=…   → el tablero de un cliente
 *   PUT                   → guarda los nombres de plantilla propios del cliente
 *   DELETE ?clienteId=…   → borra lo observado, para medir desde cero
 *
 * El DELETE existe para una situación concreta: después de arreglar algo del
 * lado de la clínica, el tablero sigue mostrando el "incompleto" viejo hasta
 * que llegue uno bueno. Poder reiniciar la medición es lo que permite
 * comprobar el arreglo en vez de esperar a que el tiempo lo tape.
 */

import { type NextRequest, NextResponse } from "next/server"

import { requireAuthForApi } from "@/lib/auth"
import { getConfigByClienteId, updateWhatsAppConfig } from "@/lib/db"
import { estadoDeIntegracion } from "@/lib/integracion-externa/estado"
import { olvidarObservaciones } from "@/lib/integracion-externa/registro"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const clienteId = new URL(request.url).searchParams.get("clienteId")
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })

  const config = await getConfigByClienteId(clienteId).catch(() => null)
  const estado = await estadoDeIntegracion(
    clienteId,
    config?.tiposNoAplicables || [],
    config?.nombresDePlantilla || {},
  )

  return NextResponse.json({ exito: true, cliente: config?.displayName, ...estado })
}

/**
 * Guarda los nombres de plantilla propios de un cliente.
 *
 * Un nombre vacío borra la excepción y vuelve al del catálogo. Es la salida
 * para quien se equivocó al cargarlo: sin eso, un typo acá se arregla sólo
 * editando Redis a mano.
 */
export async function PUT(request: NextRequest) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  let cuerpo: any = {}
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const clienteId = String(cuerpo?.clienteId || "")
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })

  const config = await getConfigByClienteId(clienteId).catch(() => null)
  if (!config) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

  const entradas = cuerpo?.nombresDePlantilla
  if (!entradas || typeof entradas !== "object") {
    return NextResponse.json({ error: "nombresDePlantilla requerido" }, { status: 400 })
  }

  const limpio: Record<string, string> = {}
  for (const [clave, valor] of Object.entries(entradas)) {
    const nombre = String(valor ?? "").trim()
    // Sólo se guarda la excepción. Si coincide con el del catálogo no hace
    // falta anotarla, y guardarla sería un dato que después hay que mantener
    // sincronizado con el código.
    if (nombre) limpio[clave] = nombre
  }

  await updateWhatsAppConfig(config.id, { nombresDePlantilla: limpio })

  return NextResponse.json({ exito: true, nombresDePlantilla: limpio })
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireAuthForApi()
  if (!session) return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })

  const clienteId = new URL(request.url).searchParams.get("clienteId")
  if (!clienteId) return NextResponse.json({ error: "clienteId requerido" }, { status: 400 })

  await olvidarObservaciones(clienteId)
  return NextResponse.json({ exito: true })
}
