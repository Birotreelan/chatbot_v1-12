import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const fullUrl = request.url
  
  // Log para TODAS las requests que pasan por el middleware
  console.log("[MIDDLEWARE] ========== REQUEST ==========")
  console.log("[MIDDLEWARE] Pathname:", pathname)
  console.log("[MIDDLEWARE] Full URL:", fullUrl)
  console.log("[MIDDLEWARE] Search params:", request.nextUrl.searchParams.toString())

  // Manejar OPTIONS requests (CORS preflight)
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin")
    if (origin) {
      const response = new NextResponse(null, { status: 204 })
      response.headers.set("Access-Control-Allow-Origin", origin)
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
      response.headers.set("Access-Control-Allow-Credentials", "true")
      response.headers.set("Vary", "Origin")
      return response
    }
  }

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

  // Permitir embebido en iframe para estadísticas de citas (consumo externo)
  if (pathname.startsWith("/stats") || pathname.startsWith("/api/stats")) {
    const response = NextResponse.next()
    
    // Headers para iframe embebido
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")
    
    // Headers CORS para permitir requests desde cualquier origen
    response.headers.set("Access-Control-Allow-Origin", "*")
    response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type")
    
    return response
  }

  // Permitir embebido en iframe para el panel de soporte y login
  if (pathname.startsWith("/support") || pathname.startsWith("/login") || pathname.startsWith("/api/support")) {
    // SSO: Si viene un sso_token, redirigir a /api/auth/sso ANTES de verificar autenticación
    const ssoToken = request.nextUrl.searchParams.get("sso_token")
    // _sid: sessionId pasado por URL desde /api/auth/sso (workaround cookies Safari en iframe)
    const sidParam = request.nextUrl.searchParams.get("_sid")
    
    console.log("[MIDDLEWARE] Support/Login route - pathname:", pathname)
    console.log("[MIDDLEWARE] Support/Login route - sso_token presente:", !!ssoToken)
    console.log("[MIDDLEWARE] Support/Login route - _sid presente:", !!sidParam)
    console.log("[MIDDLEWARE] Support/Login route - cookies:", JSON.stringify(request.cookies.getAll()))
    
    if (ssoToken) {
      console.log("[MIDDLEWARE] SSO: Token detectado, redirigiendo a /api/auth/sso")
      const ssoUrl = new URL("/api/auth/sso", request.url)
      ssoUrl.searchParams.set("sso_token", ssoToken)
      return NextResponse.redirect(ssoUrl)
    }

    // Si viene _sid, establecer la cookie y redirigir a /support limpio
    if (sidParam && pathname.startsWith("/support")) {
      console.log("[MIDDLEWARE] SSO: _sid detectado, estableciendo cookie y redirigiendo")
      const cleanUrl = new URL("/support", request.url)
      const response = NextResponse.redirect(cleanUrl)
      response.cookies.set("session_id", sidParam, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 60 * 60 * 24, // 24 horas
        path: "/",
      })
      console.log("[MIDDLEWARE] SSO: Cookie session_id establecida:", sidParam)
      return response
    }

    const response = NextResponse.next()
    
    // Headers para iframe embebido
    response.headers.set("X-Frame-Options", "ALLOWALL")
    response.headers.set("Content-Security-Policy", "frame-ancestors *")
    
    // Headers CORS para permitir requests desde iframes de cross-origin
    const origin = request.headers.get("origin")
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin)
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
      response.headers.set("Access-Control-Allow-Credentials", "true")
      response.headers.set("Vary", "Origin")
    }
    
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
