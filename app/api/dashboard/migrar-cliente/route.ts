/**
 * Mover los datos de un `cliente_id` viejo a uno nuevo (26/10/2026).
 *
 * GET    — qué hay guardado bajo cada uno de los dos ids. No toca nada.
 * POST   — el ensayo, o la migración de verdad con `ensayo: false`.
 * DELETE — borra lo que quedó bajo el id viejo, una vez verificado el nuevo.
 *
 * ── Por qué una ruta y no un script ────────────────────────────────────────
 *
 * Porque las credenciales de Redis viven en Vercel y el que necesita correr
 * esto no las tiene en la máquina. Una ruta protegida con la sesión del panel
 * evita copiar credenciales de producción a una terminal, que es la parte
 * peligrosa de un script suelto.
 *
 * ── Por qué super_admin y no el dueño del cliente ──────────────────────────
 *
 * Esto reescribe las estadísticas y la facturación de una clínica entera. No
 * es una operación de uso, es una de mantenimiento.
 */

import { NextResponse } from "next/server"

import { requireAuthFromRequest } from "@/lib/auth"
import {
  borrarElViejo,
  clavesDelCliente,
  idsHuerfanos,
  migrarClienteId,
} from "@/lib/migracion-cliente-id"
import { getAllWhatsAppConfigs } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function autorizar(request: Request) {
  const { session, error } = await requireAuthFromRequest(request)
  if (!session) {
    return { error: NextResponse.json({ error: error || "No autenticado" }, { status: 401 }) }
  }
  if (session.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Se requiere rol de super admin" }, { status: 403 }) }
  }
  return { session }
}

/** Qué hay de cada lado, para mirar antes y después. */
export async function GET(request: Request) {
  const acceso = await autorizar(request)
  if ("error" in acceso) return acceso.error

  const { searchParams } = new URL(request.url)

  // ── Sin parámetros: qué ids quedaron sueltos ─────────────────────────────
  //
  // Es la pregunta que no se podía hacer antes. El síntoma de un cliente que
  // cambió de id —factura en cero, estadísticas vacías— se nota semanas
  // después, cuando ya nadie sabe cuál era el id viejo.
  if (!searchParams.get("viejo") && !searchParams.get("nuevo")) {
    const configs = await getAllWhatsAppConfigs()
    const huerfanos = await idsHuerfanos(configs.map((c) => c.cliente_id || ""))
    return NextResponse.json({
      huerfanos,
      clientes: configs
        .filter((c) => c.cliente_id)
        .map((c) => ({
          clienteId: c.cliente_id,
          nombre: c.alias || c.displayName,
          activo: c.active !== false,
        }))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    })
  }

  const viejo = searchParams.get("viejo") || ""
  const nuevo = searchParams.get("nuevo") || ""
  if (!viejo || !nuevo) {
    return NextResponse.json({ error: "Faltan viejo y nuevo" }, { status: 400 })
  }

  const [clavesViejo, clavesNuevo] = await Promise.all([
    clavesDelCliente(viejo),
    clavesDelCliente(nuevo),
  ])

  return NextResponse.json({
    viejo: { id: viejo, claves: clavesViejo.length, listado: clavesViejo },
    nuevo: { id: nuevo, claves: clavesNuevo.length, listado: clavesNuevo },
  })
}

export async function POST(request: Request) {
  const acceso = await autorizar(request)
  if ("error" in acceso) return acceso.error

  let cuerpo: any
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const viejo = String(cuerpo?.viejo || "")
  const nuevo = String(cuerpo?.nuevo || "")
  if (!viejo || !nuevo) {
    return NextResponse.json({ error: "Faltan viejo y nuevo" }, { status: 400 })
  }
  if (viejo === nuevo) {
    return NextResponse.json({ error: "Son el mismo id" }, { status: 400 })
  }

  // Escribir exige decirlo. Si el campo falta, es un ensayo: ver la cabecera
  // de lib/migracion-cliente-id.ts.
  const ensayo = cuerpo?.ensayo !== false

  const resultado = await migrarClienteId({
    viejo,
    nuevo,
    ensayo,
    // Repetir una migración ya hecha duplica los contadores. Hay que pedirlo.
    forzar: cuerpo?.forzar === true,
  })

  console.log(
    `[MIGRACION_API] ${acceso.session.displayName || acceso.session.username} ` +
      `${ensayo ? "ensayó" : "ejecutó"} la migración ${viejo} → ${nuevo}`,
  )

  return NextResponse.json(resultado)
}

/** El borrado del id viejo, cuando ya se verificó que el nuevo quedó bien. */
export async function DELETE(request: Request) {
  const acceso = await autorizar(request)
  if ("error" in acceso) return acceso.error

  const { searchParams } = new URL(request.url)
  const viejo = searchParams.get("viejo") || ""
  if (!viejo) return NextResponse.json({ error: "Falta viejo" }, { status: 400 })

  const ensayo = searchParams.get("ensayo") !== "false"
  const resultado = await borrarElViejo({ viejo, ensayo })

  console.log(
    `[MIGRACION_API] ${acceso.session.displayName || acceso.session.username} ` +
      `${ensayo ? "ensayó el borrado" : "borró"} ${viejo}`,
  )

  return NextResponse.json(resultado)
}
