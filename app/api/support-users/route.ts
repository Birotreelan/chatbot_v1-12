import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import { getAllSupportUsers, createSupportUser } from "@/lib/support-users"

export async function GET() {
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
