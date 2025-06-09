"use client"

import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cliente_id = searchParams.get("cliente_id") || ""
  const widgetTitle = searchParams.get("widgetTitle") || ""
  const widgetSubtitle = searchParams.get("widgetSubtitle") || ""
  const widgetPrimaryColor = searchParams.get("widgetPrimaryColor") || ""
  const widgetWelcomeMessage = searchParams.get("widgetWelcomeMessage") || ""
  const widgetPlaceholder = searchParams.get("widgetPlaceholder") || ""

  const config = {
    cliente_id,
    widgetTitle,
    widgetSubtitle,
    widgetPrimaryColor,
    widgetWelcomeMessage,
    widgetPlaceholder,
  }

  // Generar el HTML del widget
  const widgetHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Widget</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    .chat-container { height: 100vh; display: flex; flex-direction: column; }
    .loading-dot { animation: bounce 1.4s ease-in-out infinite both; }
    .loading-dot:nth-child(1) { animation-delay: -0.32s; }
    .loading-dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
  </style>
</head>
<body>
  <div id="chat-root" class="chat-container"></div>
  
  <script>
    const { useState, useEffect, useRef } = React;
    
    function WidgetChat() {
      const [messages, setMessages] = useState([]);
      const [inputValue, setInputValue] = useState('');
      const [isLoading, setIsLoading] = useState(false);
      const [sessionId, setSessionId] = useState('');
      const messagesEndRef = useRef(null);
      
      const config = ${JSON.stringify(config)};
      const clienteId = '${config.cliente_id}';
      
      // Generar session_id único
      useEffect(() => {
        const newSessionId = 'web_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        setSessionId(newSessionId);
        console.log('[WIDGET-CHAT] Session ID generado:', newSessionId);
        
        // Agregar mensaje de bienvenida
        if (config.widgetWelcomeMessage) {
          setMessages([{
            id: 'welcome',
            content: config.widgetWelcomeMessage,
            isUser: false,
            timestamp: new Date()
          }]);
        }
      }, []);
      
      // Scroll automático
      useEffect(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }, [messages]);
      
      const sendMessage = async () => {
        if (!inputValue.trim() || isLoading || !sessionId) return;
        
        const userMessage = {
          id: Date.now().toString(),
          content: inputValue.trim(),
          isUser: true,
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsLoading(true);
        
        try {
          console.log('[WIDGET-CHAT] Enviando mensaje:', {
            message: userMessage.content,
            cliente_id: clienteId,
            session_id: sessionId
          });
          
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: userMessage.content,
              cliente_id: clienteId,
              session_id: sessionId
            })
          });
          
          if (!response.ok) {
            throw new Error('Error ' + response.status + ': ' + response.statusText);
          }
          
          const data = await response.json();
          
          if (data.success && data.response) {
            const botMessage = {
              id: (Date.now() + 1).toString(),
              content: data.response,
              isUser: false,
              timestamp: new Date()
            };
            setMessages(prev => [...prev, botMessage]);
          } else {
            throw new Error(data.error || 'Error desconocido');
          }
        } catch (error) {
          console.error('[WIDGET-CHAT] Error:', error);
          const errorMessage = {
            id: (Date.now() + 1).toString(),
            content: 'Lo siento, ha ocurrido un error. Por favor, intenta nuevamente.',
            isUser: false,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, errorMessage]);
        } finally {
          setIsLoading(false);
        }
      };
      
      const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      };
      
      const formatTime = (date) => {
        return new Date(date).toLocaleTimeString('es-ES', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
      };
      
      return React.createElement('div', { className: 'flex flex-col h-full bg-white' }, [
        // Header
        React.createElement('div', {
          key: 'header',
          className: 'p-4 text-white relative',
          style: { backgroundColor: config.widgetPrimaryColor || '#0ea5e9' }
        }, [
          React.createElement('div', { key: 'header-content', className: 'text-left' }, [
            React.createElement('h3', { 
              key: 'title', 
              className: 'font-semibold text-lg' 
            }, config.widgetTitle || 'Asistente Virtual'),
            React.createElement('p', { 
              key: 'subtitle', 
              className: 'text-sm opacity-90' 
            }, config.widgetSubtitle || 'Estamos aquí para ayudarte')
          ])
        ]),
        
        // Messages Area
        React.createElement('div', { 
          key: 'messages', 
          className: 'flex-1 overflow-y-auto p-4 space-y-4' 
        }, [
          ...messages.map((message) => 
            React.createElement('div', {
              key: message.id,
              className: 'flex ' + (message.isUser ? 'justify-end' : 'justify-start')
            }, [
              React.createElement('div', {
                key: 'message-content',
                className: 'max-w-[80%] rounded-lg p-3 ' + (message.isUser ? 'text-white' : 'bg-gray-100 text-gray-800'),
                style: message.isUser ? { backgroundColor: config.widgetPrimaryColor || '#0ea5e9' } : {}
              }, [
                React.createElement('p', { 
                  key: 'text', 
                  className: 'text-sm whitespace-pre-wrap text-left' 
                }, message.content),
                React.createElement('p', { 
                  key: 'time', 
                  className: 'text-xs mt-1 ' + (message.isUser ? 'text-white/70' : 'text-gray-500')
                }, formatTime(message.timestamp))
              ])
            ])
          ),
          
          // Loading indicator
          isLoading && React.createElement('div', { 
            key: 'loading', 
            className: 'flex justify-start' 
          }, [
            React.createElement('div', { 
              key: 'loading-bubble', 
              className: 'bg-gray-100 rounded-lg p-3' 
            }, [
              React.createElement('div', { 
                key: 'dots', 
                className: 'flex space-x-1' 
              }, [
                React.createElement('div', { key: 'dot1', className: 'w-2 h-2 bg-gray-400 rounded-full loading-dot' }),
                React.createElement('div', { key: 'dot2', className: 'w-2 h-2 bg-gray-400 rounded-full loading-dot' }),
                React.createElement('div', { key: 'dot3', className: 'w-2 h-2 bg-gray-400 rounded-full loading-dot' })
              ])
            ])
          ]),
          
          React.createElement('div', { key: 'scroll-anchor', ref: messagesEndRef })
        ]),
        
        // Input Area
        React.createElement('div', { 
          key: 'input-area', 
          className: 'p-4 border-t border-gray-200' 
        }, [
          React.createElement('div', { 
            key: 'input-container', 
            className: 'flex space-x-2' 
          }, [
            React.createElement('input', {
              key: 'input',
              type: 'text',
              value: inputValue,
              onChange: (e) => setInputValue(e.target.value),
              onKeyPress: handleKeyPress,
              placeholder: config.widgetPlaceholder || 'Escribe tu mensaje...',
              disabled: isLoading,
              className: 'flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
            }),
            React.createElement('button', {
              key: 'send-btn',
              onClick: sendMessage,
              disabled: !inputValue.trim() || isLoading,
              className: 'px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50',
              style: { backgroundColor: config.widgetPrimaryColor || '#0ea5e9' }
            }, '→')
          ])
        ]),
        
        // Footer
        React.createElement('div', { 
          key: 'footer', 
          className: 'p-2 text-center' 
        }, [
          React.createElement('p', { 
            key: 'powered', 
            className: 'text-xs text-gray-500' 
          }, 'Powered by Treelan')
        ])
      ]);
    }
    
    // Renderizar el componente
    ReactDOM.render(React.createElement(WidgetChat), document.getElementById('chat-root'));
  </script>
</body>
</html>
`

  return new NextResponse(widgetHtml, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}
