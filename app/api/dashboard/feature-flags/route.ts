import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import {
  getGlobalFeatureFlags,
  setGlobalFeatureFlags,
  resetGlobalFeatureFlags,
} from "@/lib/conversation-state/feature-flags"

export const dynamic = "force-dynamic"

// GET: Obtener flags globales actuales
export async function GET() {
  try {
    await requireSuperAdmin()
    const flags = await getGlobalFeatureFlags()
    console.log("[v0] GET feature-flags - flags leidos de Redis:", JSON.stringify(flags))
    return NextResponse.json({ flags })
  } catch (error) {
    console.log("[v0] GET feature-flags - error:", error)
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}

// POST: Actualizar un flag global
export async function POST(request: Request) {
  try {
    await requireSuperAdmin()
    const body = await request.json()
    console.log("[v0] POST feature-flags - body recibido:", JSON.stringify(body))
    const { flags } = body as { flags: Record<string, boolean> }

    if (!flags || typeof flags !== "object") {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 })
    }

    console.log("[v0] POST feature-flags - flags a guardar:", JSON.stringify(flags))
    await setGlobalFeatureFlags(flags)
    const updated = await getGlobalFeatureFlags()
    console.log("[v0] POST feature-flags - flags DESPUÉS de guardar:", JSON.stringify(updated))
    return NextResponse.json({ success: true, flags: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.log("[v0] POST feature-flags - error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE: Resetear todos los flags globales a defaults
export async function DELETE() {
  try {
    await requireSuperAdmin()
    await resetGlobalFeatureFlags()
    const flags = await getGlobalFeatureFlags()
    return NextResponse.json({ success: true, flags })
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}
