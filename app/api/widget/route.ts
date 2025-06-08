import { type NextRequest, NextResponse } from "next/server"
import { adjustColor } from "@/lib/utils"

export async function GET(req: NextRequest) {
  const config = {
    widgetPrimaryColor: req.nextUrl.searchParams.get("widgetPrimaryColor") || "#0ea5e9",
    widgetTitle: req.nextUrl.searchParams.get("widgetTitle") || "¡Hola! ¿Cómo puedo ayudarte?",
    widgetSubtitle: req.nextUrl.searchParams.get("widgetSubtitle") || "Estamos aquí para responder tus preguntas.",
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Chat Widget</title>
      <style>
        body {
          margin: 0;
          font-family: sans-serif;
        }

        .chat-widget {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 360px;
          height: 600px;
          border-radius: 12px;
          box-shadow: 0 0 20px rgba(0, 0, 0, 0.15);
          overflow: hidden;
          z-index: 9999;
        }

        .chat-header {
          background: linear-gradient(135deg, ${config.widgetPrimaryColor || "#0ea5e9"} 0%, ${adjustColor(config.widgetPrimaryColor || "#0ea5e9", -20)} 100%);
          color: white;
          padding: 20px 60px 20px 20px;
          text-align: left;
          position: relative;
          border-radius: 12px 12px 0 0;
        }

        .chat-title {
          font-size: 20px;
          font-weight: 600;
          margin: 0 0 4px 0;
          text-align: left;
        }

        .chat-subtitle {
          font-size: 14px;
          opacity: 0.9;
          margin: 0;
          text-align: left;
        }

        .chat-body {
          height: calc(100% - 80px);
          background-color: #f9f9f9;
        }
      </style>
    </head>
    <body>
      <div class="chat-widget">
        <div class="chat-header">
          <h3 class="chat-title">${config.widgetTitle}</h3>
          <p class="chat-subtitle">${config.widgetSubtitle}</p>
        </div>
        <div class="chat-body">
          </div>
      </div>
    </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}
