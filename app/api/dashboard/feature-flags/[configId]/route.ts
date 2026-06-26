import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import {
  getClientFeatureFlags,
  setClientFeatureFlags,
  resetClientFeatureFlags,
} from "@/lib/conversation-state/feature-flags"

export const dynamic = "force-dynamic"

// GET: Obtener flags de un cliente específico
export async function GET(
  _request: Request,
  { params }: { params: { configId: string } }
) {
  try {
    await requireSuperAdmin()
    const { configId } = params
    if (!configId) {
      return NextResponse.json({ error: "configId requerido" }, { status: 400 })
    }
    const flags = await getClientFeatureFlags(configId)
    return NextResponse.json({ flags })
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}

// POST: Actualizar flags de un cliente específico
export async function POST(
  request: Request,
  { params }: { params: { configId: string } }
) {
  try {
    await requireSuperAdmin()
    const { configId } = params
    if (!configId) {
      return NextResponse.json({ error: "configId requerido" }, { status: 400 })
    }
    const body = await request.json()
    const { flags } = body as { flags: Record<string, boolean> }
    if (!flags || typeof flags !== "object") {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
    }
    await setClientFeatureFlags(configId, flags)
    const updated = await getClientFeatureFlags(configId)
    return NextResponse.json({ success: true, flags: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE: Resetear flags del cliente a defaults/globales
export async function DELETE(
  _request: Request,
  { params }: { params: { configId: string } }
) {
  try {
    await requireSuperAdmin()
    const { configId } = params
    await resetClientFeatureFlags(configId)
    const flags = await getClientFeatureFlags(configId)
    return NextResponse.json({ success: true, flags })
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}
