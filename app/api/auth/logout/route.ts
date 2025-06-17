import { type NextRequest, NextResponse } from "next/server"
import { logout } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    await logout()
    return NextResponse.json({
      success: true,
      message: "Sesión cerrada exitosamente",
    })
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "Error al cerrar sesión" }, { status: 500 })
  }
}
