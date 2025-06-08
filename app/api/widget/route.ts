import { type NextRequest, NextResponse } from "next/server"
import { getConfigByClienteId } from "@/lib/db"
import { processWebChatMessage } from "@/lib/web-chat-final"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const clienteId = searchParams.get("cliente_id")
    const configOnly = searchParams.get("config_only") === "true"

    console.log(`[WIDGET] GET request - cliente_id: ${clienteId}, config_only: ${configOnly}`)

    if (!clienteId) {
      console.error("[WIDGET] cliente_id es requerido")
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    // Obtener configuración
    const config = await getConfigByClienteId(clienteId)
    if (!config) {
      console.error(`[WIDGET] No se encontró configuración para cliente_id: ${clienteId}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    // Si solo se solicita la configuración, devolverla como JSON
    if (configOnly) {
      console.log(`[WIDGET] Devolviendo solo configuración para cliente_id: ${clienteId}`)
      return NextResponse.json({
        widgetEnabled: config.widgetEnabled,
        widgetTitle: config.widgetTitle,
        widgetPrimaryColor: config.widgetPrimaryColor,
        widgetSecondaryColor: config.widgetSecondaryColor,
        widgetPosition: config.widgetPosition,
        widgetWelcomeMessage: config.widgetWelcomeMessage,
        widgetPlaceholder: config.widgetPlaceholder,
        widgetButtonText: config.widgetButtonText,
        widgetHeaderText: config.widgetHeaderText,
        widgetSubtitle: config.widgetSubtitle,
        widgetBrandingEnabled: config.widgetBrandingEnabled,
        widgetBrandingText: config.widgetBrandingText,
        widgetMaxHeight: config.widgetMaxHeight,
        widgetMaxWidth: config.widgetMaxWidth,
        widgetBorderRadius: config.widgetBorderRadius,
        widgetShadow: config.widgetShadow,
        widgetAnimation: config.widgetAnimation,
        widgetSoundEnabled: config.widgetSoundEnabled,
        widgetTheme: config.widgetTheme,
        widgetFloatingButtonText: config.widgetFloatingButtonText,
        widgetShowFloatingText: config.widgetShowFloatingText,
      })
    }

    console.log(`[WIDGET] Generando HTML del widget para cliente_id: ${clienteId}`)

    // Aplicar configuración del tema
    const isDarkTheme =
      config.widgetTheme === "dark" ||
      (config.widgetTheme === "auto" && request.headers.get("sec-ch-prefers-color-scheme") === "dark")

    const themeColors = isDarkTheme
      ? {
          background: "#1f2937",
          surface: "#374151",
          text: "#f9fafb",
          textSecondary: "#d1d5db",
          border: "#4b5563",
          inputBg: "#374151",
          inputBorder: "#6b7280",
        }
      : {
          background: "#ffffff",
          surface: "#f9fafb",
          text: "#111827",
          textSecondary: "#6b7280",
          border: "#e5e7eb",
          inputBg: "#ffffff",
          inputBorder: "#d1d5db",
        }

    // Generar HTML del widget
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.widgetTitle || "Chat"}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: ${themeColors.background};
            color: ${themeColors.text};
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-header {
            background: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            padding: 16px;
            text-align: center;
            position: relative;
            ${config.widgetShadow !== false ? "box-shadow: 0 2px 4px rgba(0,0,0,0.1);" : ""}
        }
        
        .chat-header h1 {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }
        
        .chat-header p {
            font-size: 14px;
            opacity: 0.9;
            margin: 4px 0 0 0;
        }
        
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            background: ${themeColors.background};
        }
        
        .message {
            margin-bottom: 16px;
            ${config.widgetAnimation !== false ? "animation: fadeIn 0.3s ease;" : ""}
        }
        
        .message.bot {
            text-align: left;
        }
        
        .message.user {
            text-align: right;
        }
        
        .message-bubble {
            display: inline-block;
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
            position: relative;
        }
        
        .message.bot .message-bubble {
            background: ${themeColors.surface};
            color: ${themeColors.text};
            border-bottom-left-radius: 4px;
        }
        
        .message.user .message-bubble {
            background: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .welcome-message {
            text-align: center;
            padding: 20px;
            color: ${themeColors.textSecondary};
            font-style: italic;
        }
        
        .input-container {
            padding: 16px;
            background: ${themeColors.surface};
            border-top: 1px solid ${themeColors.border};
        }
        
        .input-form {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }
        
        .message-input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid ${themeColors.inputBorder};
            border-radius: 24px;
            background: ${themeColors.inputBg};
            color: ${themeColors.text};
            font-size: 14px;
            resize: none;
            min-height: 44px;
            max-height: 120px;
            outline: none;
            transition: border-color 0.2s ease;
        }
        
        .message-input:focus {
            border-color: ${config.widgetPrimaryColor || "#0ea5e9"};
        }
        
        .message-input::placeholder {
            color: ${themeColors.textSecondary};
        }
        
        .send-button {
            background: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            border: none;
            border-radius: 50%;
            width: 44px;
            height: 44px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }
        
        .send-button:hover {
            transform: scale(1.05);
            ${config.widgetShadow !== false ? "box-shadow: 0 4px 8px rgba(0,0,0,0.2);" : ""}
        }
        
        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .typing-indicator {
            display: none;
            padding: 8px 16px;
            color: ${themeColors.textSecondary};
            font-style: italic;
            font-size: 14px;
        }
        
        .typing-indicator.show {
            display: block;
        }
        
        .branding {
            text-align: center;
            padding: 8px;
            font-size: 12px;
            color: ${themeColors.textSecondary};
            background: ${themeColors.surface};
            border-top: 1px solid ${themeColors.border};
        }
        
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .loading-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid ${themeColors.border};
            border-top: 2px solid ${config.widgetPrimaryColor || "#0ea5e9"};
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        ${
          config.widgetAnimation !== false
            ? `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        `
            : ""
        }
        
        /* Scrollbar personalizado */
        .messages-container::-webkit-scrollbar {
            width: 6px;
        }
        
        .messages-container::-webkit-scrollbar-track {
            background: ${themeColors.surface};
        }
        
        .messages-container::-webkit-scrollbar-thumb {
            background: ${themeColors.border};
            border-radius: 3px;
        }
        
        .messages-container::-webkit-scrollbar-thumb:hover {
            background: ${themeColors.textSecondary};
        }
    </style>
</head>
<body>
    <div class="chat-header">
        <h1>${config.widgetHeaderText || "Chat de Soporte"}</h1>
        <p>${config.widgetSubtitle || "Estamos aquí para ayudarte"}</p>
    </div>
    
    <div class="chat-container">
        <div class="messages-container" id="messages">
            <div class="welcome-message">
                ${config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?"}
            </div>
        </div>
        
        <div class="typing-indicator" id="typing">
            El asistente está escribiendo...
        </div>
        
        <div class="input-container">
            <form class="input-form" id="messageForm">
                <textarea 
                    id="messageInput" 
                    class="message-input" 
                    placeholder="${config.widgetPlaceholder || "Escribe tu mensaje..."}"
                    rows="1"
                ></textarea>
                <button type="submit" class="send-button" id="sendButton">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22,2 15,22 11,13 2,9"></polygon>
                    </svg>
                </button>
            </form>
        </div>
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
        const messagesContainer = document.getElementById('messages');
        const messageForm = document.getElementById('messageForm');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const typingIndicator = document.getElementById('typing');
        
        let isProcessing = false;
        
        // Auto-resize textarea
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
        
        // Handle form submission
        messageForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const message = messageInput.value.trim();
            if (!message || isProcessing) return;
            
            // Add user message
            addMessage(message, 'user');
            messageInput.value = '';
            messageInput.style.height = 'auto';
            
            // Show typing indicator
            showTyping();
            isProcessing = true;
            sendButton.disabled = true;
            
            try {
                const response = await fetch('/api/widget', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: message,
                        cliente_id: '${clienteId}'
                    })
                });
                
                const data = await response.json();
                
                if (data.success && data.response) {
                    addMessage(data.response, 'bot');
                    ${
                      config.widgetSoundEnabled !== false
                        ? `
                    // Play notification sound
                    try {
                        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
                        audio.volume = 0.3;
                        audio.play().catch(() => {});
                    } catch (e) {}
                    `
                        : ""
                    }
                } else {
                    addMessage('Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.', 'bot');
                }
            } catch (error) {
                console.error('Error:', error);
                addMessage('Lo siento, ha ocurrido un error de conexión. Por favor, intenta nuevamente.', 'bot');
            } finally {
                hideTyping();
                isProcessing = false;
                sendButton.disabled = false;
                messageInput.focus();
            }
        });
        
        function addMessage(text, sender) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${sender}\`;
            
            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = 'message-bubble';
            bubbleDiv.textContent = text;
            
            messageDiv.appendChild(bubbleDiv);
            messagesContainer.appendChild(messageDiv);
            
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function showTyping() {
            typingIndicator.classList.add('show');
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        function hideTyping() {
            typingIndicator.classList.remove('show');
        }
        
        // Focus input on load
        messageInput.focus();
        
        // Handle Enter key (submit) and Shift+Enter (new line)
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                messageForm.dispatchEvent(new Event('submit'));
            }
        });
    </script>
</body>
</html>
    `

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    })
  } catch (error) {
    console.error("[WIDGET] Error en GET:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, cliente_id } = body

    console.log(`[WIDGET] POST request - cliente_id: ${cliente_id}, message: ${message}`)

    if (!message || !cliente_id) {
      return NextResponse.json({ error: "Mensaje y cliente_id son requeridos" }, { status: 400 })
    }

    // Procesar el mensaje usando el sistema de chat web
    const response = await processWebChatMessage(message, cliente_id)

    return NextResponse.json({
      success: true,
      response: response,
    })
  } catch (error) {
    console.error("[WIDGET] Error en POST:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Error al procesar el mensaje",
      },
      { status: 500 },
    )
  }
}
