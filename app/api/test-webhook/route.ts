import { NextResponse } from "next/server"

export async function GET() {
  console.log("[TEST-WEBHOOK] ========== PRUEBA DE WEBHOOK ==========")
  console.log("[TEST-WEBHOOK] Timestamp:", new Date().toISOString())
  console.log("[TEST-WEBHOOK] Sistema funcionando correctamente")

  return NextResponse.json({
    success: true,
    message: "Webhook system is working",
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      hasOpenAI: !!process.env.OPENAI_API_KEY,
      hasWhatsAppToken: !!process.env.WHATSAPP_TOKEN,
      hasVerifyToken: !!process.env.WHATSAPP_VERIFY_TOKEN,
      useQStash: process.env.USE_QSTASH === "true",
    },
  })
}

export async function POST(req: Request) {
  console.log("[TEST-WEBHOOK] ========== PRUEBA POST ==========")
  console.log("[TEST-WEBHOOK] Timestamp:", new Date().toISOString())

  try {
    const body = await req.json()
    console.log("[TEST-WEBHOOK] Body recibido:", JSON.stringify(body, null, 2))

    return NextResponse.json({
      success: true,
      message: "POST test successful",
      receivedBody: body,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[TEST-WEBHOOK] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
