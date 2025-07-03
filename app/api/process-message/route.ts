import { type NextRequest, NextResponse } from "next/server"
import { verifySignature } from "@upstash/qstash/nextjs"
import { handleMessage } from "@/lib/whatsapp"

export const maxDuration = 60

async function handler(req: NextRequest) {
  console.log("[PROCESS-MESSAGE] Recibida solicitud POST")

  try {
    // Verificar firma de QStash
    console.log("[PROCESS-MESSAGE] Verificando firma QStash...")

    // Obtener headers de QStash
    const signature = req.headers.get("upstash-signature")
    const timestamp = req.headers.get("upstash-timestamp")

    if (!signature || !timestamp) {
      console.log("[PROCESS-MESSAGE] Headers de QStash faltantes, procesando sin verificación")
    }

    console.log("[PROCESS-MESSAGE] Iniciando procesamiento de mensaje")

    // Obtener el cuerpo de la solicitud
    const body = await req.json()

    console.log("[PROCESS-MESSAGE] Datos recibidos:", JSON.stringify(body, null, 2))

    // Procesar el mensaje
    await handleMessage(body)

    console.log("[PROCESS-MESSAGE] Mensaje procesado exitosamente")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[PROCESS-MESSAGE] Error procesando mensaje:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 },
    )
  }
}

// Aplicar verificación de firma solo si está configurada
export const POST = process.env.QSTASH_CURRENT_SIGNING_KEY ? verifySignature(handler) : handler
