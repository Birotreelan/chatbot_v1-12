import { NextResponse } from "next/server"
import { Client } from "@upstash/qstash"

export async function GET() {
  try {
    // Verificar si QStash está configurado
    const token = process.env.QSTASH_TOKEN
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

    if (!token || !currentSigningKey || !nextSigningKey) {
      return NextResponse.json(
        {
          success: false,
          error: "QStash no está completamente configurado",
          config: {
            token: !!token,
            currentSigningKey: !!currentSigningKey,
            nextSigningKey: !!nextSigningKey,
          },
        },
        { status: 400 },
      )
    }

    // Crear cliente QStash
    const client = new Client({ token })

    // Usar explícitamente la URL de producción
    const baseUrl = "https://treelan-bot.vercel.app"

    // Enviar un mensaje de prueba
    const response = await client.publishJSON({
      url: `${baseUrl}/api/debug/qstash-echo`,
      body: {
        test: true,
        timestamp: new Date().toISOString(),
        message: "Este es un mensaje de prueba de QStash",
      },
    })

    return NextResponse.json({
      success: true,
      messageId: response.messageId,
      message: "Mensaje de prueba enviado a QStash",
      endpoint: `${baseUrl}/api/debug/qstash-echo`,
    })
  } catch (error) {
    console.error("Error al probar QStash:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}
