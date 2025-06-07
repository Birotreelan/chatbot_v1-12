import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    console.log("[QSTASH-ECHO] Mensaje recibido:", JSON.stringify(body, null, 2))

    // Guardar en Redis para verificación
    try {
      const { Redis } = await import("@upstash/redis")
      const redis = Redis.fromEnv()
      await redis.set(
        "qstash:last-echo",
        JSON.stringify({
          timestamp: new Date().toISOString(),
          body,
        }),
      )
      await redis.expire("qstash:last-echo", 60 * 60) // Expira en 1 hora
    } catch (redisError) {
      console.error("[QSTASH-ECHO] Error al guardar en Redis:", redisError)
    }

    return NextResponse.json({
      success: true,
      message: "Mensaje recibido correctamente",
      receivedAt: new Date().toISOString(),
      body,
    })
  } catch (error) {
    console.error("[QSTASH-ECHO] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  try {
    // Obtener el último mensaje de eco
    const { Redis } = await import("@upstash/redis")
    const redis = Redis.fromEnv()
    const lastEcho = await redis.get("qstash:last-echo")

    return NextResponse.json({
      success: true,
      lastEcho: lastEcho || null,
    })
  } catch (error) {
    console.error("[QSTASH-ECHO] Error al obtener último eco:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
