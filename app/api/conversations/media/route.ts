/**
 * GET /api/conversations/media — el archivo de un mensaje, para el Monitor
 * de Conversaciones del dashboard (16/10/2026).
 *
 * ── Por qué no alcanzaba con el que ya existía ─────────────────────────────
 *
 * `/api/support/media` sirve lo mismo, pero pide el `sessionId` de una sesión
 * de atención humana y autoriza por el `tenantId` de esa sesión. La mayoría de
 * las conversaciones del Monitor nunca se escalan a un humano, así que no hay
 * sesión que pasarle: para esas, el archivo no se podía ver por ningún lado.
 *
 * Acá la conversación se identifica como en el resto del Monitor —`configId` +
 * `phoneNumber`— y quien autoriza es `super_admin`, que es quien ve esas
 * páginas. Ver lib/conversations-auth.ts.
 *
 * Lo que pasa después —que el archivo sea de ESA conversación, bajarlo de
 * WhatsApp, con qué tipo se sirve— es idéntico en los dos endpoints y vive una
 * sola vez, en lib/media-de-conversacion.ts.
 *
 * ── Lo que no hace ─────────────────────────────────────────────────────────
 *
 * No sube archivos. El Monitor es de lectura: desde el dashboard no se le
 * escribe al paciente, eso es del panel de atención de cada clínica.
 */

import { NextResponse } from "next/server"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { servirMediaDeLaConversacion } from "@/lib/media-de-conversacion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const { searchParams } = new URL(request.url)
    const configId = searchParams.get("configId")
    const phoneNumber = searchParams.get("phoneNumber")
    const mediaId = searchParams.get("mediaId")

    if (!configId || !phoneNumber || !mediaId) {
      return NextResponse.json(
        { success: false, error: "configId, phoneNumber y mediaId son requeridos" },
        { status: 400 },
      )
    }

    return await servirMediaDeLaConversacion({
      configId,
      phoneNumber,
      mediaId,
      forzarDescarga: searchParams.get("descargar") === "1",
      etiqueta: "CONVERSATIONS_MEDIA",
    })
  } catch (error: any) {
    console.error("[CONVERSATIONS_MEDIA] Error en GET:", error)
    return NextResponse.json({ success: false, error: "Error obteniendo el archivo" }, { status: 500 })
  }
}
