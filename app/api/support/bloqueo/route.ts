/**
 * Bloquear y desbloquear un contacto desde el panel de atención (19/10/2026).
 *
 * GET    — estado del contacto (y la lista de bloqueados del cliente).
 * POST   — bloquear.
 * DELETE — desbloquear.
 *
 * ── Qué hace el bloqueo ────────────────────────────────────────────────────
 *
 * Corta en los dos sentidos: no se le responde y no le sale nada, tampoco
 * recordatorios. No es el bloqueo de WhatsApp —el mensaje nos llega igual— pero
 * sí elimina el costo, porque lo que se paga son los salientes. Ver
 * lib/contactos-bloqueados.ts.
 *
 * ── Quién puede ────────────────────────────────────────────────────────────
 *
 * Cualquier usuario del panel de ESA clínica, con la misma comprobación de
 * tenant que el resto de /api/support: la sesión tiene que pertenecer al mismo
 * `cliente_id` que la config. Un agente que ve la conversación tiene que poder
 * cortarla sin pedirle permiso a nadie — si hiciera falta un super_admin, en la
 * práctica nadie bloquearía.
 */

import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { getWhatsAppConfigById } from "@/lib/db"
import {
  bloquearContacto,
  desbloquearContacto,
  leerBloqueo,
  listarBloqueados,
} from "@/lib/contactos-bloqueados"

export const dynamic = "force-dynamic"

/** La sesión, la config y el permiso sobre ese cliente. */
async function autorizar(request: Request, configId: string | null) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return { error: NextResponse.json({ success: false, error: "No autenticado" }, { status: 401 }) }
  }
  if (!configId) {
    return { error: NextResponse.json({ success: false, error: "Falta configId" }, { status: 400 }) }
  }

  const config = await getWhatsAppConfigById(configId)
  if (!config) {
    return { error: NextResponse.json({ success: false, error: "Configuración no encontrada" }, { status: 404 }) }
  }
  if (session.tenantId && config.cliente_id !== session.tenantId) {
    return { error: NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 }) }
  }

  return { session, config }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    const acceso = await autorizar(request, configId)
    if ("error" in acceso) return acceso.error

    // Sin teléfono se devuelve la lista entera: es lo que necesita una pantalla
    // de bloqueados para poder desbloquear a alguien cuya conversación ya no
    // aparece en ninguna lista.
    if (!phoneNumber) {
      return NextResponse.json({ success: true, bloqueados: await listarBloqueados(configId!) })
    }

    const bloqueo = await leerBloqueo(configId!, phoneNumber)
    return NextResponse.json({ success: true, bloqueado: Boolean(bloqueo), bloqueo })
  } catch (error) {
    console.error("[BLOQUEO_API] Error consultando:", error)
    return NextResponse.json({ success: false, error: "Error consultando el bloqueo" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const configId = body?.configId as string | undefined
    const phoneNumber = body?.phoneNumber as string | undefined

    const acceso = await autorizar(request, configId ?? null)
    if ("error" in acceso) return acceso.error

    if (!phoneNumber) {
      return NextResponse.json({ success: false, error: "Falta phoneNumber" }, { status: 400 })
    }

    const bloqueo = await bloquearContacto({
      configId: configId!,
      phoneNumber,
      // Queda registrado quién lo hizo: el desbloqueo es una decisión que
      // alguien va a tener que explicar, y "estaba bloqueado" sin autor no se
      // puede revisar.
      bloqueadoPor: acceso.session.displayName || acceso.session.username || undefined,
      motivo: typeof body?.motivo === "string" ? body.motivo : undefined,
    })

    return NextResponse.json({ success: true, bloqueo })
  } catch (error) {
    console.error("[BLOQUEO_API] Error bloqueando:", error)
    return NextResponse.json({ success: false, error: "Error al bloquear el contacto" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")

    const acceso = await autorizar(request, configId)
    if ("error" in acceso) return acceso.error

    if (!phoneNumber) {
      return NextResponse.json({ success: false, error: "Falta phoneNumber" }, { status: 400 })
    }

    await desbloquearContacto(configId!, phoneNumber)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[BLOQUEO_API] Error desbloqueando:", error)
    return NextResponse.json({ success: false, error: "Error al desbloquear el contacto" }, { status: 500 })
  }
}
