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
import { requireAuthFromRequest } from "@/lib/auth"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { servirMediaDeLaConversacion } from "@/lib/media-de-conversacion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Archivos que mandaron los pacientes: fotos de estudios, recetas, documentos.
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
