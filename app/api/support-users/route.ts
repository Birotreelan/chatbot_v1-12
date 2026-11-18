import { NextResponse } from "next/server"
import { requireAuthForApi } from "@/lib/auth"
import { requireSuperAdmin } from "@/lib/auth"
import { getAllSupportUsers, createSupportUser } from "@/lib/support-users"

/**
 * ── Por qué esta lectura exige sesión (18/11/2026) ─────────────────────────
 *
 * Auditoría del 18/11: de 113 rutas, 84 no verificaban identidad. El
 * middleware hace CORS y la cookie del SSO, pero no autentica, así que cada
 * ruta se defiende sola y la mayoría no lo hacía.
 *
 * El padrón de usuarios del panel de atención.
 *
 * Se protegen sólo las lecturas críticas —credenciales, conversaciones de
 * pacientes, datos personales y comerciales—. Las estadísticas agregadas
 * quedan abiertas a propósito: no identifican a nadie.
 *
 * La consumen pantallas del dashboard desde el navegador, que mandan la
 * cookie de sesión sola: no hubo que tocar ningún `fetch`.
 */
export async function GET() {
  // Lectura crítica: exige sesión. Ver la nota de arriba.
  const { session: sesion, error: errorDeSesion } = await requireAuthForApi()
  if (!sesion) {
    return NextResponse.json({ error: errorDeSesion || "No autorizado" }, { status: 401 })
  }

  try {
    await requireSuperAdmin()
    const users = await getAllSupportUsers()
    return NextResponse.json(users)
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}

export async function POST(request: Request) {
  try {
    await requireSuperAdmin()

    const body = await request.json()
    const { username, password, tenantId, displayName, email, role } = body

    if (!username || !password || !displayName) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 })
    }

    const user = await createSupportUser({
      username,
      password,
      tenantId: tenantId || null,
      displayName,
      email,
      role: role || "support_agent",
    })

    // No devolver el hash de contraseña
    const { passwordHash, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "El nombre de usuario ya existe") {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    console.error("[API] Error creando usuario:", error)
    return NextResponse.json({ error: "Error al crear usuario" }, { status: 500 })
  }
}
