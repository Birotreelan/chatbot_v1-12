import type { NextRequest } from "next/server"

export function isAuthenticated(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization")

  if (!authHeader) {
    return false
  }

  // Verificar si es Basic Auth
  if (authHeader.startsWith("Basic ")) {
    const base64Credentials = authHeader.slice(6)
    const credentials = Buffer.from(base64Credentials, "base64").toString("ascii")
    const [username, password] = credentials.split(":")

    return username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD
  }

  return false
}

export function requireAuth(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Dashboard"',
      },
    })
  }
  return null
}
