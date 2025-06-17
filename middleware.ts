import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  console.log("[MIDDLEWARE] Procesando ruta:", pathname)

  // Permitir CORS y embedding para rutas del widget
  if (pathname.startsWith("/widget") || pathname.startsWith("/api/chat") || pathname.startsWith("/api/widget")) {
    const response = NextResponse.next()

    // Headers CORS permisivos
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
    response.headers.set("Access-Control-Allow-Credentials", "false")

    // Headers para permitir embedding en iframes
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")

    // Headers adicionales para compatibilidad
    response.headers.set("X-Content-Type-Options", "nosniff")
    response.headers.set("Referrer-Policy", "no-referrer-when-downgrade")

    console.log("[MIDDLEWARE] Headers CORS aplicados para:", pathname)
    return response
  }

  // Manejar preflight requests
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      },
    })
  }

  // Para otras rutas, continuar normalmente
  return NextResponse.next()
}

export const config = {
  matcher: ["/widget/:path*", "/api/chat/:path*", "/api/widget/:path*", "/widget-loader.js"],
}
