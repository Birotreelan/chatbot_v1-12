/**
 * Las observaciones de la pestaña Servicio (16/10/2026).
 *
 * ── Por qué super_admin y no la guarda de Facturación ──────────────────────
 *
 * Los endpoints de `/api/facturacion/*` usan `requireBillingAgentForApi`, que
 * deja pasar a `billing_agent` además de a `super_admin`. Acá no corresponde:
 * Servicio vive dentro de /dashboard justamente para que un Agente de
 * Facturación no la vea, y dejar sus datos detrás de la guarda de Facturación
 * haría que la pestaña esté cerrada y el contenido no.
 *
 * Es la misma trampa que dejé anotada al crear la pestaña: la página protegida
 * no protege nada si los datos salen por otra puerta.
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import {
  getAllObservaciones,
  setObservacion,
  OBSERVACION_MAX,
} from "@/lib/servicio-observaciones"

export const dynamic = "force-dynamic"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Notas internas de la facturación del servicio.
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

    const observaciones = await getAllObservaciones()
    return NextResponse.json({ exito: true, observaciones })
  } catch (error) {
    console.error("[SERVICIO_OBSERVACIONES] Error leyendo:", error)
    return NextResponse.json({ error: "Error al obtener las observaciones" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const body = await request.json().catch(() => null)
    const clienteId = body?.clienteId
    const observacion = body?.observacion

    if (!clienteId || typeof clienteId !== "string") {
      return NextResponse.json({ error: "clienteId es obligatorio" }, { status: 400 })
    }
    if (typeof observacion !== "string") {
      return NextResponse.json({ error: "observacion debe ser un string" }, { status: 400 })
    }

    await setObservacion(clienteId, observacion)

    // Se devuelve lo que QUEDÓ guardado, no lo que llegó: el servidor recorta a
    // OBSERVACION_MAX y hace trim. Si devolviera el original, la tabla
    // mostraría un texto que no es el que está en Redis hasta la próxima carga.
    return NextResponse.json({
      exito: true,
      clienteId,
      observacion: observacion.trim().slice(0, OBSERVACION_MAX),
    })
  } catch (error) {
    console.error("[SERVICIO_OBSERVACIONES] Error guardando:", error)
    return NextResponse.json({ error: "Error al guardar la observación" }, { status: 500 })
  }
}
