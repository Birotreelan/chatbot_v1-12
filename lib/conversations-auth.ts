/**
 * Quién puede leer las conversaciones desde el dashboard (16/10/2026).
 *
 * ── El agujero que esto cierra ─────────────────────────────────────────────
 *
 * Las rutas de `/api/conversations/*` no verificaban nada. Las PÁGINAS del
 * dashboard sí —`requireSuperAdmin()` en `app/dashboard/layout.tsx`—, pero las
 * APIs que están detrás, no, y el middleware sólo les pone cabeceras CORS.
 *
 * Con eso, sabiendo un `configId` y un `phoneNumber` —dos valores que viajan en
 * la URL de cualquier captura de pantalla del panel— se obtenía la conversación
 * completa de un paciente desde `/messages`, sus notas de voz desde `/audio`, y
 * la exportación de todos los contactos desde `/export`.
 *
 * Apareció al ir a sumar el preview de los archivos que mandan los pacientes:
 * no corresponde poner imágenes y PDF clínicos detrás de una puerta abierta.
 *
 * ── Por qué super_admin y no cualquier sesión ──────────────────────────────
 *
 * Porque estas rutas no están acotadas por cliente: `/contacts` lista los
 * contactos de cualquier `configId` que se le pida. Pedir "una sesión
 * cualquiera" dejaría que el agente de una clínica leyera las conversaciones de
 * otra. El Monitor es una herramienta nuestra, y super_admin es exactamente
 * quien ve esas páginas.
 *
 * Si algún día una clínica tiene que ver su propio monitor, el cambio no es
 * aflojar esto: es filtrar por `tenantId` como hace el panel de atención.
 */

import { NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import type { SessionData } from "@/lib/types"

export interface AccesoDenegado {
  /** La respuesta ya armada. El llamador hace `return acceso.respuesta`. */
  respuesta: NextResponse
}

/**
 * Comprueba la sesión. Devuelve la sesión, o la respuesta de error a devolver.
 *
 * Se devuelve la respuesta en vez de lanzar porque estas rutas contestan JSON:
 * `requireSuperAdmin()` hace `redirect()`, que sirve para una página y no para
 * un `fetch` —el cliente recibiría el HTML del login con status 200 y lo
 * intentaría parsear como JSON—.
 */
export async function exigirSuperAdmin(
  request: Request,
): Promise<{ sesion: SessionData } | AccesoDenegado> {
  const sesion = await getSessionFromRequest(request)

  if (!sesion) {
    return {
      respuesta: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    }
  }

  if (sesion.role !== "super_admin") {
    // Se registra: un agente de clínica pegándole a estas rutas es, o un enlace
    // mal armado, o alguien probando. Las dos cosas conviene verlas.
    console.warn(
      `[CONVERSATIONS] Acceso denegado a ${new URL(request.url).pathname} — rol "${sesion.role}"`,
    )
    return {
      respuesta: NextResponse.json({ error: "No autorizado" }, { status: 403 }),
    }
  }

  return { sesion }
}

/** `true` cuando `exigirSuperAdmin` devolvió un rechazo. */
export function esDenegado(
  resultado: { sesion: SessionData } | AccesoDenegado,
): resultado is AccesoDenegado {
  return "respuesta" in resultado
}
