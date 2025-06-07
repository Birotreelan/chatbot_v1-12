import { type NextRequest, NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"
import { DEMO_CONFIG, ensureDemoConfig } from "@/lib/demo-config"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    // Obtener el cliente_id de los parámetros de consulta
    const clienteId = request.nextUrl.searchParams.get("cliente_id")

    if (!clienteId) {
      return new NextResponse("Se requiere el parámetro cliente_id", { status: 400 })
    }

    // Buscar la configuración por cliente_id
    let config = await getConfigByClienteId(clienteId)

    // Si no se encuentra y es el cliente de demo, crear/usar configuración por defecto
    if (!config && clienteId === "demo-client") {
      await ensureDemoConfig()
      config = DEMO_CONFIG as any
    }

    if (!config) {
      return new NextResponse("Configuración no encontrada para el cliente_id proporcionado", { status: 404 })
    }

    // Para la demo, siempre permitir el widget
    if (clienteId === "demo-client" || !config.widgetEnabled) {
      if (clienteId !== "demo-client") {
        return new NextResponse("El widget no está habilitado para este cliente", { status: 403 })
      }
    }

    // Generar el HTML del widget
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${config.widgetTitle || "Chat Asistente"}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          }
          
          body {
            background-color: ${config.widgetSecondaryColor || "#f0f9ff"};
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .chat-header {
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
          }
          
          .chat-title {
            font-size: 16px;
            font-weight: 600;
          }
          
          .chat-subtitle {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 2px;
          }
          
          .chat-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          
          .message {
            max-width: 80%;
            padding: 10px 14px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.4;
          }
          
          .user-message {
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
          }
          
          .bot-message {
            background-color: #e5e7eb;
            color: #1f2937;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
          }
          
          .chat-input-container {
            padding: 12px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 8px;
            background-color: white;
          }
          
          .chat-input {
            flex: 1;
            padding: 10px 14px;
            border: 1px solid #d1d5db;
            border-radius: 24px;
            outline: none;
            font-size: 14px;
          }
          
          .chat-input:focus {
            border-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2);
          }
          
          .send-button {
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            border: none;
            border-radius: 24px;
            padding: 0 16px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          
          .send-button:hover {
            background-color: ${config.widgetPrimaryColor ? adjustColor(config.widgetPrimaryColor, -20) : "#0284c7"};
          }
          
          .send-button:disabled {
            background-color: #9ca3af;
            cursor: not-allowed;
          }
          
          .typing-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 8px 14px;
            background-color: #e5e7eb;
            border-radius: 18px;
            width: fit-content;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
          }
          
          .typing-dot {
            width: 8px;
            height: 8px;
            background-color: #6b7280;
            border-radius: 50%;
            animation: typing-animation 1.4s infinite ease-in-out both;
          }
          
          .typing-dot:nth-child(1) {
            animation-delay: -0.32s;
          }
          
          .typing-dot:nth-child(2) {
            animation-delay: -0.16s;
          }
          
          @keyframes typing-animation {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
          }
          
          .welcome-message {
            text-align: center;
            margin: 20px 0;
            color: #6b7280;
            font-size: 14px;
          }
          
          .branding {
            text-align: center;
            padding: 8px;
            font-size: 11px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <div class="chat-header">
          <div class="chat-title">${config.widgetHeaderText || "Chat en vivo"}</div>
          <div class="chat-subtitle">${config.widgetSubtitle || "Estamos aquí para ayudarte"}</div>
        </div>
        
        <div class="chat-messages" id="chat-messages">
          <div class="welcome-message">
            ${config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?"}
          </div>
        </div>
        
        <div class="chat-input-container">
          <input 
            type="text" 
            class="chat-input" 
            id="chat-input" 
            placeholder="${config.widgetPlaceholder || "Escribe tu mensaje..."}"
            aria-label="Mensaje"
          >
          <button class="send-button" id="send-button" disabled>
            ${config.widgetButtonText || "Enviar"}
          </button>
        </div>
        
        ${
          config.widgetBrandingEnabled !== false
            ? `
          <div class="branding">
            ${config.widgetBrandingText || "Powered by AI Assistant"}
          </div>
        `
            : ""
        }
        
        <script>
          // Variables globales
          const clienteId = "${clienteId}";
          const chatMessages = document.getElementById('chat-messages');
          const chatInput = document.getElementById('chat-input');
          const sendButton = document.getElementById('send-button');
          let isWaitingForResponse = false;
          
          // Habilitar/deshabilitar el botón de envío según el contenido del input
          chatInput.addEventListener('input', function() {
            sendButton.disabled = this.value.trim() === '' || isWaitingForResponse;
          });
          
          // Enviar mensaje al presionar Enter
          chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !sendButton.disabled) {
              sendMessage();
            }
          });
          
          // Enviar mensaje al hacer clic en el botón
          sendButton.addEventListener('click', sendMessage);
          
          // Función para enviar mensaje
          async function sendMessage() {
            const message = chatInput.value.trim();
            if (message === '' || isWaitingForResponse) return;
            
            // Añadir mensaje del usuario al chat
            addMessage(message, 'user');
            
            // Limpiar input y deshabilitar botón
            chatInput.value = '';
            isWaitingForResponse = true;
            sendButton.disabled = true;
            
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
                  session_id: getSessionId()
                }),
              });
              
              if (!response.ok) {
                throw new Error('Error al enviar el mensaje');
              }
              
              const data = await response.json();
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Añadir respuesta del bot al chat
              addMessage(data.response, 'bot');
            } catch (error) {
              console.error('Error:', error);
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Mostrar mensaje de error
              addMessage('Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.', 'bot');
            } finally {
              isWaitingForResponse = false;
            }
          }
          
          // Función para añadir un mensaje al chat
          function addMessage(text, sender) {
            const messageElement = document.createElement('div');
            messageElement.className = \`message \${sender}-message\`;
            messageElement.textContent = text;
            
            chatMessages.appendChild(messageElement);
            
            // Scroll al final
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          
          // Funciones para el indicador de escritura
          function showTypingIndicator() {
            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.id = 'typing-indicator';
            
            for (let i = 0; i < 3; i++) {
              const dot = document.createElement('div');
              dot.className = 'typing-dot';
              indicator.appendChild(dot);
            }
            
            chatMessages.appendChild(indicator);
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
          
          function hideTypingIndicator() {
            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
              indicator.remove();
            }
          }
          
          // Función para obtener o crear un ID de sesión
          function getSessionId() {
            let sessionId = localStorage.getItem('treelan_chat_session_id');
            
            if (!sessionId) {
              sessionId = 'web_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
              localStorage.setItem('treelan_chat_session_id', sessionId);
            }
            
            return sessionId;
          }
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
    console.error("Error al servir el widget:", error)
    return new NextResponse("Error interno del servidor", { status: 500 })
  }
}

// Función auxiliar para ajustar el color (oscurecer/aclarar)
function adjustColor(color: string, amount: number): string {
  // Eliminar el # si existe
  color = color.replace("#", "")

  // Convertir a RGB
  let r = Number.parseInt(color.substring(0, 2), 16)
  let g = Number.parseInt(color.substring(2, 4), 16)
  let b = Number.parseInt(color.substring(4, 6), 16)

  // Ajustar cada componente
  r = Math.max(0, Math.min(255, r + amount))
  g = Math.max(0, Math.min(255, g + amount))
  b = Math.max(0, Math.min(255, b + amount))

  // Convertir de nuevo a hex
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
