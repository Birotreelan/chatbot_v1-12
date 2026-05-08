import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Log extensivo para rutas del widget
  if (pathname.startsWith("/widget") || pathname.includes("widget")) {
    console.log("[MIDDLEWARE] 🚀 === PETICIÓN WIDGET ===")
    console.log("[MIDDLEWARE] 📅 Timestamp:", new Date().toISOString())
    console.log("[MIDDLEWARE] 🌐 URL completa:", request.url)
    console.log("[MIDDLEWARE] 📍 Pathname:", pathname)
    console.log("[MIDDLEWARE] 🔍 Search params:", request.nextUrl.searchParams.toString())
    console.log("[MIDDLEWARE] 📋 Headers:")
    request.headers.forEach((value, key) => {
      console.log(`[MIDDLEWARE] - ${key}: ${value}`)
    })
    console.log("[MIDDLEWARE] 🌍 Origin:", request.headers.get("origin"))
    console.log("[MIDDLEWARE] 🔗 Referer:", request.headers.get("referer"))
    console.log("[MIDDLEWARE] 👤 User-Agent:", request.headers.get("user-agent"))
    console.log("[MIDDLEWARE] ===============================")
  }

  // Aplicar CORS para todas las rutas del widget
  if (pathname.startsWith("/widget") || pathname.startsWith("/api/chat")) {
    const response = NextResponse.next()

    // Headers CORS completos
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
    response.headers.set("Access-Control-Allow-Credentials", "false")
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")

    console.log("[MIDDLEWARE] ✅ Headers CORS aplicados para:", pathname)
    return response
  }

  // Permitir embebido en iframe para el panel de soporte y login
  if (pathname.startsWith("/support") || pathname.startsWith("/login") || pathname.startsWith("/api/support")) {
    const response = NextResponse.next()
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
