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
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import {
  getAllObservaciones,
  setObservacion,
  OBSERVACION_MAX,
} from "@/lib/servicio-observaciones"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
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
