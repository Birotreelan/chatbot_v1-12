import { NextRequest, NextResponse } from "next/server"
import { verifyEmbedToken, createEmbedSession } from "@/lib/embed-auth"

/**
 * POST /api/support/embed/auth
 * 
 * Autentica un token JWT de embed y crea una sesión
 * 
 * Body: { token: string }
 * Response: { success: boolean; sessionId?: string; error?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      console.log("[EMBED_AUTH_API] Token no proporcionado")
      return NextResponse.json({ success: false, error: "Token requerido" }, { status: 400 })
    }

    console.log("[EMBED_AUTH_API] Verificando token JWT...")

    // Verificar y decodificar el token
    const payload = await verifyEmbedToken(token)

    if (!payload) {
      console.log("[EMBED_AUTH_API] Token inválido o expirado")
      return NextResponse.json(
        { success: false, error: "Token inválido, expirado o ya fue usado" },
        { status: 401 }
      )
    }

    console.log("[EMBED_AUTH_API] Token verificado para:", payload.name)

    // Crear sesión embed
    const sessionId = await createEmbedSession(payload)

    // Establecer cookie con el ID de sesión
    const response = NextResponse.json({
      success: true,
      sessionId,
      user: {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role: payload.role,
      },
    })

    // Configurar cookie HttpOnly para máxima seguridad
    response.cookies.set("embed_session_id", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none", // Requerido para iframe
      maxAge: 8 * 60 * 60, // 8 horas
      path: "/support",
    })

    console.log("[EMBED_AUTH_API] ✅ Sesión embed autenticada y cookie establecida")
    return response
  } catch (error) {
    console.error("[EMBED_AUTH_API] Error:", error)
    return NextResponse.json(
      { success: false, error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
