import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Permitir CORS para rutas del widget
  if (pathname.startsWith("/widget") || pathname.startsWith("/api/chat") || pathname.startsWith("/api/widget")) {
    const response = NextResponse.next()

    // Agregar headers CORS
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")

    return response
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
  matcher: ["/api/:path*", "/widget/:path*"],
}
