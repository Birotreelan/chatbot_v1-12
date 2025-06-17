import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyAuth } from "@/lib/auth"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Permitir CORS para rutas del widget
  if (pathname.startsWith("/api/widget") || pathname.startsWith("/widget") || pathname.startsWith("/api/chat")) {
    const response = NextResponse.next()

    // Agregar headers CORS
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")

    return response
  }

  // Rutas protegidas del dashboard
  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("auth-token")?.value

    if (!token || !verifyAuth(token)) {
      return NextResponse.redirect(new URL("/login", request.url))
    }
  }

  // Si es una solicitud a la API de webhook, permitir
  if (pathname === "/api/webhook") {
    return NextResponse.next()
  }

  // Para otras rutas de API, verificar la autenticación si es necesario
  if (pathname.startsWith("/api/")) {
    // Aquí podrías implementar autenticación para endpoints de API privados
    // Por ahora, simplemente permitimos todas las solicitudes
    return NextResponse.next()
  }

  // Para rutas normales, continuar
  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/widget/:path*", "/widget/:path*", "/api/chat/:path*"],
}
