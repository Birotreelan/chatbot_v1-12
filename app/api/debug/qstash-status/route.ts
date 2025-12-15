import { NextResponse } from "next/server"

export async function GET() {
  try {
    const qstashConfig = {
      token: !!process.env.QSTASH_TOKEN,
      currentSigningKey: !!process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: !!process.env.QSTASH_NEXT_SIGNING_KEY,
      useQStash: process.env.USE_QSTASH === "true",
      vercelUrl: process.env.VERCEL_URL,
      appUrl: process.env.APP_URL,
    }

    const isFullyConfigured = qstashConfig.token && qstashConfig.currentSigningKey && qstashConfig.nextSigningKey

    return NextResponse.json({
      configured: isFullyConfigured,
      config: qstashConfig,
      processMessageUrl: qstashConfig.vercelUrl
        ? `https://${qstashConfig.vercelUrl}/api/process-message`
        : qstashConfig.appUrl
          ? `${qstashConfig.appUrl}/api/process-message`
          : "http://localhost:3000/api/process-message",
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
