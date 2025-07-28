import { NextResponse } from "next/server"
import { processWhatsAppMessage } from "@/lib/whatsapp-processor"

export async function POST(req: Request) {
  try {
    const body = await req.json()

    if (!body || !body.entry || !Array.isArray(body.entry) || body.entry.length === 0) {
      console.error("Invalid webhook body:", body)
      return new NextResponse("Invalid body", { status: 400 })
    }

    const entry = body.entry[0]

    if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
      console.error("No changes found in entry:", entry)
      return new NextResponse("No changes found", { status: 200 }) // Not an error, just no relevant data
    }

    const change = entry.changes[0]

    if (
      !change.value ||
      !change.value.messages ||
      !Array.isArray(change.value.messages) ||
      change.value.messages.length === 0
    ) {
      console.log("No messages found in change:", change)
      return new NextResponse("No messages found", { status: 200 }) // Not an error, just no messages
    }

    const message = change.value.messages[0]
    const messageText = message.text.body
    const from = message.from
    const whatsappConfig = {
      // Replace with your actual configuration values
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
      version: "v17.0", // Or your desired version
    }

    if (!whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
      console.error("WhatsApp configuration missing. Check environment variables.")
      return new NextResponse("WhatsApp configuration missing", { status: 500 })
    }

    const response = await processWhatsAppMessage({
      message: messageText,
      phoneNumber: from,
      config: whatsappConfig,
    })

    return NextResponse.json({ received: true }, { status: 200 })
  } catch (error: any) {
    console.error("Webhook error:", error)
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 })
  }
}

export async function GET(req: Request) {
  const mode = req.nextUrl.searchParams.get("hub.mode")
  const token = req.nextUrl.searchParams.get("hub.verify_token")
  const challenge = req.nextUrl.searchParams.get("hub.challenge")

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED")
    return new NextResponse(challenge, { status: 200 })
  } else {
    return new NextResponse("Error, invalid token", { status: 403 })
  }
}
