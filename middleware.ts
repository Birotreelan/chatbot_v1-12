import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Obtener la ruta solicitada
  const path = request.nextUrl.pathname

  // Si es una solicitud a la API de webhook, permitir
  if (path === "/api/webhook") {
    return NextResponse.next()
  }

  // Para otras rutas de API, verificar la autenticación si es necesario
  if (path.startsWith("/api/")) {
    // Aquí podrías implementar autenticación para endpoints de API privados
    // Por ahora, simplemente permitimos todas las solicitudes
    return NextResponse.next()
  }

  // Para rutas normales, continuar
  return NextResponse.next()
}

export const config = {
  matcher: ["/api/:path*"],
}
