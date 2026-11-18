/**
 * El valor por unidad de Servicio. Guarda de super_admin, no la de Facturación:
 * ver la nota en app/api/servicio/observaciones/route.ts.
 */

import { NextResponse } from "next/server"
import { requireAuthFromRequest } from "@/lib/auth"
import { exigirSuperAdmin, esDenegado } from "@/lib/conversations-auth"
import { getAllPreciosServicio, setPrecioServicio } from "@/lib/servicio-precios"

export const dynamic = "force-dynamic"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * Datos comerciales: lo que se le cobra a cada cliente. El panel gemelo
 * —Facturación— ya exigía `requireBillingAgent` desde siempre; Servicio no.
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

    const precios = await getAllPreciosServicio()
    return NextResponse.json({ exito: true, precios })
  } catch (error) {
    console.error("[SERVICIO_PRECIOS] Error leyendo:", error)
    return NextResponse.json({ error: "Error al obtener los precios" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const acceso = await exigirSuperAdmin(request)
    if (esDenegado(acceso)) return acceso.respuesta

    const body = await request.json().catch(() => null)
    const clienteId = body?.clienteId
    const valor = Number(body?.valor)

    if (!clienteId || typeof clienteId !== "string") {
      return NextResponse.json({ error: "clienteId es obligatorio" }, { status: 400 })
    }
    // Se rechaza el negativo además del no-numérico: un precio por unidad
    // negativo daría totales en rojo que la tabla mostraría como si nada.
    if (!Number.isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: "valor debe ser un número ≥ 0" }, { status: 400 })
    }

    await setPrecioServicio(clienteId, valor)
    return NextResponse.json({ exito: true, clienteId, valor })
  } catch (error) {
    console.error("[SERVICIO_PRECIOS] Error guardando:", error)
    return NextResponse.json({ error: "Error al guardar el precio" }, { status: 500 })
  }
}
