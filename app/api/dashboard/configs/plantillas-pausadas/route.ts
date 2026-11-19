/**
 * Pausar y reanudar una plantilla de WhatsApp para un cliente.
 *
 * Reemplaza a `pausa-recordatorios`, que pausaba "los recordatorios" como
 * categoría con la lista escrita en el código. La unidad ahora es la
 * plantilla. Ver lib/plantillas-pausadas.ts.
 *
 *   GET  ?configId=…                  → las pausadas de ese cliente
 *   POST { configId, plantilla }      → alterna esa plantilla
 */

import { NextResponse } from "next/server"

import { requireAuthForApi } from "@/lib/auth"
import {
  plantillasPausadas,
  pausarPlantilla,
  reanudarPlantilla,
  advertenciaDePlantilla,
} from "@/lib/plantillas-pausadas"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) {
    return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
  }

  const configId = new URL(request.url).searchParams.get("configId") || ""
  if (!configId) return NextResponse.json({ error: "Falta configId" }, { status: 400 })

  return NextResponse.json({ success: true, pausadas: await plantillasPausadas(configId) })
}

export async function POST(request: Request) {
  const { session, error } = await requireAuthForApi()
  if (!session) {
    return NextResponse.json({ error: error || "No autorizado" }, { status: 401 })
  }

  const cuerpo = await request.json().catch(() => null)
  const configId = String(cuerpo?.configId || "")
  const plantilla = String(cuerpo?.plantilla || "")
  if (!configId || !plantilla) {
    return NextResponse.json({ error: "Faltan configId o plantilla" }, { status: 400 })
  }

  const pausadas = await plantillasPausadas(configId)
  const estaba = Boolean(pausadas[plantilla.trim().toLowerCase()])
  const quien = session.username || "dashboard"

  const ok = estaba
    ? await reanudarPlantilla(configId, plantilla, quien)
    : await pausarPlantilla(configId, plantilla, quien)

  if (!ok) return NextResponse.json({ error: "No se pudo cambiar el estado" }, { status: 500 })

  return NextResponse.json({
    success: true,
    plantilla,
    paused: !estaba,
    advertencia: !estaba ? advertenciaDePlantilla(plantilla) : undefined,
    message: estaba
      ? `«${plantilla}» vuelve a enviarse`
      : `«${plantilla}» no se va a enviar hasta que la reanudes`,
  })
}
