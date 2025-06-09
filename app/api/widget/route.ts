"use client"

import { type NextRequest, NextResponse } from "next/server"
import { getWhatsappConfigByClienteId } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const clienteId = searchParams.get("cliente_id")
    const configOnly = searchParams.get("config_only") === "true"

    if (!clienteId) {
      return NextResponse.json({ error: "cliente_id es requerido" }, { status: 400 })
    }

    console.log(`[WIDGET] Solicitud para cliente_id: ${clienteId}, config_only: ${configOnly}`)

    // Obtener la configuración del cliente
    const config = await getWhatsappConfigByClienteId(clienteId)

    if (!config) {
      console.log(`[WIDGET] Configuración no encontrada para cliente_id: ${clienteId}`)
      return NextResponse.json({ error: "Configuración no encontrada" }, { status: 404 })
    }

    console.log(`[WIDGET] Configuración encontrada: ${config.displayName}`)

    // Si solo se solicita la configuración, devolver solo eso
    if (configOnly) {
      const widgetConfig = {
        widgetPosition: config.widgetPosition || "bottom-right",
        widgetMaxWidth: config.widgetMaxWidth || 380,
        widgetMaxHeight: config.widgetMaxHeight || 600,
        widgetBorderRadius: config.widgetBorderRadius || 12,
        widgetShadow: config.widgetShadow !== false,
        widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
        widgetAnimation: config.widgetAnimation !== false,
        widgetShowFloatingText: config.widgetShowFloatingText !== false,
        widgetFloatingButtonText: config.widgetFloatingButtonText || "Chatea con nosotros",
        widgetTitle: config.widgetTitle || "Asistente Virtual",
        widgetSubtitle: config.widgetSubtitle || "Estamos aquí para ayudarte",
        widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
        widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
      }
      console.log(`[WIDGET] Devolviendo configuración:`, widgetConfig)
      return NextResponse.json(widgetConfig)
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
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            padding: 16px 60px 16px 20px;
            text-align: left;
            border-radius: ${config.widgetBorderRadius || 12}px ${config.widgetBorderRadius || 12}px 0 0;
            position: relative;
          }
          
          .header h1 {
            font-size: 18px;
            margin-bottom: 4px;
            font-weight: 600;
            text-align: left;
          }
          
          .header p {
            font-size: 14px;
            opacity: 0.9;
            text-align: left;
          }

          .header-controls {
            position: absolute;
            top: 12px;
            right: 12px;
            display: flex;
            gap: 6px;
            z-index: 10;
          }

          .control-btn {
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 6px;
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(4px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.2s ease;
          }

          .control-btn:hover {
            background-color: #f0f0f0;
            transform: scale(1.05);
          }

          .control-btn.close:hover {
            background-color: #fee;
          }
          
          .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            background-color: #f9f9f9;
          }
          
          .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.4;
            word-wrap: break-word;
          }
          
          .bot-message {
            background-color: #ffffff;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            border: 1px solid #e5e5e5;
            text-align: left;
          }
          
          .user-message {
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            text-align: left;
          }
          
          .input-container {
            padding: 16px;
            border-top: 1px solid #e5e5e5;
            display: flex;
            gap: 12px;
            background-color: #ffffff;
          }
          
          .input-container input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #e5e5e5;
            border-radius: 24px;
            outline: none;
            font-size: 14px;
            background-color: #f8f9fa;
          }

          .input-container input:focus {
            border-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            background-color: #ffffff;
          }
          
          .input-container button {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            border: none;
            background-color: ${config.widgetPrimaryColor || "#0ea5e9"};
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .input-container button:hover {
            transform: scale(1.05);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }

          .input-container button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }
          
          .footer {
            padding: 8px;
            text-align: center;
            font-size: 11px;
            color: #999;
            border-top: 1px solid #f0f0f0;
            background-color: #ffffff;
          }
          
          .typing-indicator {
            display: none;
            align-self: flex-start;
            padding: 12px 16px;
            background-color: #ffffff;
            border-radius: 18px;
            border-bottom-left-radius: 4px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            border: 1px solid #e5e5e5;
          }
          
          .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            background-color: #999;
            border-radius: 50%;
            margin: 0 2px;
            animation: typing 1.4s infinite ease-in-out;
          }
          
          .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
          }
          
          .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
          }
          
          @keyframes typing {
            0%, 80%, 100% {
              transform: scale(0.8);
              opacity: 0.5;
            }
            40% {
              transform: scale(1);
              opacity: 1;
            }
          }

          .welcome-message {
            background-color: #ffffff;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            border: 1px solid #e5e5e5;
          }

          .timestamp {
            font-size: 11px;
            opacity: 0.7;
            margin-top: 4px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${config.widgetTitle || "¡Hola! ¿Cómo puedo ayudarte?"}</h1>
          <p>${config.widgetSubtitle || "Estamos aquí para responder tus preguntas."}</p>
          <div class="header-controls">
            <button class="control-btn minimize" onclick="minimizeWidget()" title="Minimizar">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button class="control-btn close" onclick="closeWidget()" title="Cerrar">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        
        <div class="chat-container" id="chatContainer">
          <div class="message bot-message welcome-message">
            ${config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?"}
            <div class="timestamp">${new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
          
          <div class="typing-indicator" id="typingIndicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        
        <div class="input-container">
          <input type="text" id="messageInput" placeholder="${config.widgetPlaceholder || "Escribe tu mensaje..."}" />
          <button id="sendButton" title="Enviar mensaje">
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
          
          // Generar session_id único
          const sessionId = 'web_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          console.log('[WIDGET-CHAT] Session ID generado:', sessionId);
          
          // Función para agregar un mensaje al chat
          function addMessage(text, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = isUser ? 'message user-message' : 'message bot-message';
            
            const textDiv = document.createElement('div');
            textDiv.textContent = text;
            messageDiv.appendChild(textDiv);
            
            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'timestamp';
            timestampDiv.textContent = new Date().toLocaleTimeString('es-ES', { 
              hour: '2-digit', 
              minute: '2-digit' 
            });
            messageDiv.appendChild(timestampDiv);
            
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
            
            console.log('[WIDGET-CHAT] Enviando mensaje:', message);
            
            // Deshabilitar input y botón
            messageInput.disabled = true;
            sendButton.disabled = true;
            
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
                  message: message,
                  cliente_id: clienteId,
                  session_id: sessionId,
                  source: 'widget'
                }),
              });
              
              console.log('[WIDGET-CHAT] Respuesta del servidor:', response.status);
              
              if (!response.ok) {
                throw new Error('Error en la respuesta del servidor: ' + response.status);
              }
              
              const data = await response.json();
              console.log('[WIDGET-CHAT] Datos recibidos:', data);
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Agregar respuesta del bot
              if (data.success && data.response) {
                addMessage(data.response);
              } else if (data.response) {
                addMessage(data.response);
              } else {
                addMessage('Lo siento, no pude procesar tu mensaje.');
              }
              
            } catch (error) {
              console.error('[WIDGET-CHAT] Error:', error);
              
              // Ocultar indicador de escritura
              hideTypingIndicator();
              
              // Mostrar mensaje de error
              addMessage('Lo siento, ha ocurrido un error. Por favor, intenta de nuevo más tarde.');
            } finally {
              // Rehabilitar input y botón
              messageInput.disabled = false;
              sendButton.disabled = false;
              messageInput.focus();
            }
          }

          // Funciones para los controles del header
          function minimizeWidget() {
            console.log('[WIDGET-CHAT] Minimizar solicitado');
            if (window.parent && window.parent.TreelanChatWidget) {
              window.parent.TreelanChatWidget.minimize();
            }
          }

          function closeWidget() {
            console.log('[WIDGET-CHAT] Cerrar solicitado');
            if (window.parent && window.parent.TreelanChatWidget) {
              window.parent.TreelanChatWidget.close();
            }
          }
          
          // Event listeners
          sendButton.addEventListener('click', sendMessage);
          
          messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          });
          
          // Enfocar el input al cargar
          setTimeout(() => {
            messageInput.focus();
          }, 100);
          
          console.log('[WIDGET-CHAT] Widget cargado correctamente');
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
    console.error("[WIDGET] Error en widget route:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
