import { NextResponse } from "next/server"
import { handleMessage } from "@/lib/whatsapp"
import { logError, incrementMetric } from "@/lib/monitoring"

export const maxDuration = 300

// Función para procesar mensajes
async function processMessage(req: Request) {
  console.log("[PROCESS-MESSAGE] 🚀 Iniciando procesamiento de mensaje")

  try {
    // Obtener el cuerpo de la solicitud
    const body = await req.json()
    console.log("[PROCESS-MESSAGE] 📦 Datos recibidos:", JSON.stringify(body, null, 2))

    // Incrementar métrica de mensajes procesados
    await incrementMetric("messages_processed_async")

    // Procesar el mensaje
    console.log("[PROCESS-MESSAGE] 🔄 Llamando a handleMessage...")
    await handleMessage(body)

    console.log("[PROCESS-MESSAGE] ✅ Mensaje procesado exitosamente")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[PROCESS-MESSAGE] ❌ Error al procesar mensaje:", error)
    if (error instanceof Error) {
      console.error("[PROCESS-MESSAGE] - Error message:", error.message)
      console.error("[PROCESS-MESSAGE] - Error stack:", error.stack)
    }
    await logError("process_message", error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}

// Función para verificar si QStash está configurado
function isQStashConfigured() {
  const configured = !!(
    process.env.QSTASH_TOKEN &&
    process.env.QSTASH_CURRENT_SIGNING_KEY &&
    process.env.QSTASH_NEXT_SIGNING_KEY
  )
  console.log("[PROCESS-MESSAGE] QStash configurado:", configured)
  return configured
}

// Exportar la función POST
export async function POST(req: Request) {
  console.log("[PROCESS-MESSAGE] 📨 Recibida solicitud POST")
  console.log("[PROCESS-MESSAGE] - URL:", req.url)
  console.log("[PROCESS-MESSAGE] - Method:", req.method)

  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })
  console.log("[PROCESS-MESSAGE] - Headers:", JSON.stringify(headers, null, 2))

  const skipVerification =
    process.env.QSTASH_SKIP_SIGNATURE_VERIFICATION === "true" || process.env.VERCEL_ENV !== "production"

  // Si QStash está configurado y no estamos en modo skip, intentar verificar la firma
  if (isQStashConfigured() && !skipVerification) {
    try {
      console.log("[PROCESS-MESSAGE] 🔐 Verificando firma QStash...")

      // Importar dinámicamente la función de verificación
      const { verifySignature } = await import("@upstash/qstash/nextjs")

      // Obtener los headers necesarios
      const signature = req.headers.get("upstash-signature")
      const timestamp = req.headers.get("upstash-timestamp")

      console.log("[PROCESS-MESSAGE] - Signature presente:", !!signature)
      console.log("[PROCESS-MESSAGE] - Timestamp presente:", !!timestamp)

      if (!signature || !timestamp) {
        console.log("[PROCESS-MESSAGE] ⚠️ Headers de QStash faltantes, procesando sin verificación")
        return processMessage(req)
      }

      // Verificar la firma manualmente
      const body = await req.text()
      const isValid = await verifySignature({
        signature,
        body,
        timestamp,
        signingKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
      })

      if (!isValid) {
        console.error("[PROCESS-MESSAGE] ❌ Firma QStash inválida")
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }

      console.log("[PROCESS-MESSAGE] ✅ Firma verificada exitosamente")

      // Recrear el request con el body parseado
      const newReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: body,
      })

      return processMessage(newReq)
    } catch (error) {
      console.error("[PROCESS-MESSAGE] ❌ Error al verificar firma QStash:", error)
      console.log("[PROCESS-MESSAGE] ⚠️ Procesando mensaje sin verificación como fallback")
      return processMessage(req)
    }
  } else {
    console.log("[PROCESS-MESSAGE] ⚠️ Procesando mensaje sin verificación de firma")
    console.log("[PROCESS-MESSAGE] - Skip verification:", skipVerification)
    console.log("[PROCESS-MESSAGE] - Environment:", process.env.VERCEL_ENV)
    return processMessage(req)
  }
}
