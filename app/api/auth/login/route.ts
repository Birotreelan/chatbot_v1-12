import { type NextRequest, NextResponse } from "next/server"
import { verifyCredentials, createSession } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: "Usuario y contraseña son requeridos" }, { status: 400 })
    }

    const isValid = await verifyCredentials(username, password)

    if (isValid) {
      await createSession(username)
      return NextResponse.json({
        success: true,
        username,
        message: "Inicio de sesión exitoso",
      })
    } else {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 })
    }
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
