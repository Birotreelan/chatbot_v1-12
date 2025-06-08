import { type NextRequest, NextResponse } from "next/server"
import { getWhatsappConfigByClienteId } from "@/lib/db"
import { processWebChatMessage } from "@/lib/web-chat-final"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clienteId = searchParams.get("cliente_id")
    const configOnly = searchParams.get("config_only") === "true"

    if (!clienteId) {
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    // Obtener la configuración del cliente
    const config = await getWhatsappConfigByClienteId(clienteId)

    if (!config) {
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Si solo se solicita la configuración, devolver solo eso
    if (configOnly) {
      return NextResponse.json({
        widgetPosition: config.widget_position || "bottom-right",
        widgetMaxWidth: config.widget_max_width || 380,
        widgetMaxHeight: config.widget_max_height || 600,
        widgetBorderRadius: config.widget_border_radius || 12,
        widgetShadow: config.widget_shadow !== false,
        widgetPrimaryColor: config.widget_primary_color || "#0ea5e9",
        widgetAnimation: config.widget_animation !== false,
        widgetShowFloatingText: config.widget_show_floating_text !== false,
        widgetFloatingButtonText: config.widget_floating_button_text || "Chatea con nosotros",
      })
    }

    // Si no es solo configuración, devolver el HTML del widget
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat Widget</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          }
          
          body {
            background-color: #ffffff;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .header {
            background-color: ${config.widget_primary_color || "#0ea5e9"};
            color: white;
            padding: 16px;
            text-align: center;
            border-radius: ${config.widget_border_radius || 12}px ${config.widget_border_radius || 12}px 0 0;
          }
          
          .header h1 {
            font-size: 20px;
            margin-bottom: 4px;
          }
          
          .header p {
            font-size: 14px;
            opacity: 0.9;
          }
          
          .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
          }
          
          .message {
            max-width: 80%;
            padding: 12px;
            border-radius: 12px;
            font-size: 14px;
            line-height: 1.4;
          }
          
          .bot-message {
            background-color: #f0f0f0;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
          }
          
          .user-message {
            background-color: ${config.widget_primary_color || "#0ea5e9"};
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
          }
          
          .input-container {
            padding: 12px;
            border-top: 1px solid #e5e5e5;
            display: flex;
            gap: 8px;
          }
          
          .input-container input {
            flex: 1;
            padding: 12px;
            border: 1px solid #e5e5e5;
            border-radius: 24px;
            outline: none;
            font-size: 14px;
          }
          
          .input-container button {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            border: none;
            background-color: ${config.widget_primary_color || "#0ea5e9"};
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .footer {
            padding: 8px;
            text-align: center;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #f0f0f0;
          }
          
          .typing-indicator {
            display: none;
            align-self: flex-start;
          }
          
          .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            background-color: #999;
            border-radius: 50%;
            margin: 0 2px;
            animation: typing 1s infinite ease-in-out;
          }
          
          .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
          }
          
          .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
          }
          
          @keyframes typing {
            0%, 100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-5px);
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${config.widget_title || "Asistente virtual"}</h1>
          <p>${config.widget_subtitle || "Estamos para ayudarte"}</p>
        </div>
        
        <div class="chat-container" id="chatContainer">
          <div class="message bot-message">
            ¡Hola! ¿En qué puedo ayudarte hoy?
          </div>
          
          <div class="typing-indicator" id="typingIndicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        
        <div class="input-container">
          <input type="text" id="messageInput" placeholder="Escribe tu mensaje..." />
          <button id="sendButton">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
        
        <div class="footer">
          Powered by Treelan
        </div>
        
        <script>
          const clienteId = "${clienteId}";
          const chatContainer = document.getElementById('chatContainer');
          const messageInput = document.getElementById('messageInput');
          const sendButton = document.getElementById('sendButton');
          const typingIndicator = document.getElementById('typingIndicator');
          
          // Función para agregar un mensaje al chat
          function addMessage(text, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = isUser ? 'message user-message' : 'message bot-message';
            messageDiv.textContent = text;
            
            // Insertar antes del indicador de escritura
            chatContainer.insertBefore(messageDiv, typingIndicator);
            
            // Scroll al final
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
          
          // Función para mostrar el indicador de escritura
          function showTypingIndicator() {
            typingIndicator.style.display = 'flex';
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
          
          // Función para ocultar el indicador de escritura
          function hideTypingIndicator() {
            typingIndicator.style.display = 'none';
          }
          
          // Función para enviar mensaje
          async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;
            
            // Limpiar input
            messageInput.value = '';
            
            // Agregar mensaje del usuario
            addMessage(message, true);
            
            // Mostrar indicador de escritura
            showTypingIndicator();
            
            try {
              // Enviar mensaje al servidor
              const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  message,
                  cliente_id: clienteId,
                  source: 'widget'
                }),
              });
              
              if (!response.ok) {
                throw new Error('Error en la respuesta del servidor');
              }
              
              const data = await response.json();
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Agregar respuesta del bot
              addMessage(data.response || 'Lo siento, no pude procesar tu mensaje.');
              
            } catch (error) {
              console.error('Error:', error);
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Mostrar mensaje de error
              addMessage('Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.');
            }
          }
          
          // Event listeners
          sendButton.addEventListener('click', sendMessage);
          
          messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              sendMessage();
            }
          });
          
          // Enfocar el input al cargar
          messageInput.focus();
        </script>
      </body>
      </html>
    `

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    })
  } catch (error) {
    console.error("Error en widget route:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, cliente_id } = body

    if (!message || !cliente_id) {
      return NextResponse.json({ error: "Mensaje y cliente_id son requeridos" }, { status: 400 })
    }

    const response = await processWebChatMessage(message, cliente_id)

    return NextResponse.json({ response })
  } catch (error) {
    console.error("Error en widget POST:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
