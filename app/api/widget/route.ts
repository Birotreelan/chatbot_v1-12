import { NextResponse } from "next/server"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cliente_id = searchParams.get("cliente_id")

  if (!cliente_id) {
    return NextResponse.json({ message: "Missing cliente_id parameter" }, { status: 400 })
  }

  // Si solo se solicita la configuración, devolverla sin el HTML
  const configOnly = searchParams.get("config_only")
  if (configOnly === "true") {
    const config = {
      cliente_id: cliente_id,
      // Add other configuration parameters here as needed
    }
    return NextResponse.json(config)
  }

  const config = {
    cliente_id: cliente_id,
    // Add other configuration parameters here as needed
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Widget</title>
    </head>
    <body>
      <h1>Widget for Cliente ID: ${cliente_id}</h1>
      <p>This is a sample widget.</p>
    </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}
