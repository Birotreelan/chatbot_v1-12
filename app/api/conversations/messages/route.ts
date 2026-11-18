import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { getConversationMessages, getAllConversationMessages } from "@/lib/conversations"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Conversaciones de pacientes: teléfonos, nombres y contenido clínico.
 *
 * Se protegen sólo las lecturas críticas —credenciales, conversaciones de
 * pacientes, datos personales y comerciales—. Las estadísticas agregadas
 * quedan abiertas a propósito: no identifican a nadie.
 *
 * La consumen pantallas del dashboard desde el navegador, que mandan la
 * cookie de sesión sola: no hubo que tocar ningún `fetch`.
 */
export async function GET(request: Request) {
  // Lectura crítica: exige sesión. Ver la nota de arriba.
  const { session: sesion, error: errorDeSesion } = await requireAuthFromRequest(request)
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

  try {
    // Sin esto, con un configId y un teléfono se leía la conversación de
    // cualquier paciente. Ver lib/conversations-auth.ts.
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)

    console.log("[API] GET /api/conversations/messages")
    console.log("[API]   - configId:", configId)
    console.log("[API]   - phoneNumber:", phoneNumber)
    console.log("[API]   - limit:", limit, "offset:", offset)

    if (!configId || !phoneNumber) {
      console.log("[API] Parametros faltantes")
      return NextResponse.json({ error: "configId y phoneNumber son requeridos" }, { status: 400 })
    }

    console.log("[API] Llamando a getConversationMessages...")
    const { messages, total, hasMore } = await getConversationMessages(configId, phoneNumber, limit, offset)

    console.log("[API] Mensajes obtenidos:", messages.length, "de", total, "total")

    return NextResponse.json({ messages, total, hasMore })
  } catch (error) {
    console.error("[API] Error obteniendo mensajes:", error)
    return NextResponse.json({ error: "Error obteniendo mensajes" }, { status: 500 })
  }
}

export const dynamic = "force-dynamic"
