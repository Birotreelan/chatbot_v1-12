import { type NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (session) {
      return NextResponse.json({
        username: session,
        isAuthenticated: true,
      })
    } else {
      return NextResponse.json(
        {
          isAuthenticated: false,
        },
        { status: 401 },
      )
    }
  } catch (error) {
    console.error("Session check error:", error)
    return NextResponse.json(
      {
        error: "Error al verificar la sesión",
        isAuthenticated: false,
      },
      { status: 500 },
    )
  }
}
