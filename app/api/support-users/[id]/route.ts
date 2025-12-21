import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth"
import { getSupportUser, updateSupportUser, deleteSupportUser, changeSupportUserPassword } from "@/lib/support-users"

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin()

    const user = await getSupportUser(params.id)

    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    const { passwordHash, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin()

    const body = await request.json()
    const { password, ...updates } = body

    // Si se está actualizando la contraseña
    if (password) {
      await changeSupportUserPassword(params.id, password)
    }

    // Actualizar otros campos
    const user = await updateSupportUser(params.id, updates)

    if (!user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    const { passwordHash, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    console.error("[API] Error actualizando usuario:", error)
    return NextResponse.json({ error: "Error al actualizar usuario" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSuperAdmin()

    const success = await deleteSupportUser(params.id)

    if (!success) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[API] Error eliminando usuario:", error)
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 })
  }
}
