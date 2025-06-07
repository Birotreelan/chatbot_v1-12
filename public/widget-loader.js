;(() => {
  // Verificar si ya se cargó el widget
  if (window.TreelanChatWidget) {
    console.log("[WIDGET] Widget ya cargado")
    return
  }

  // Configuración por defecto del widget
  const defaultConfig = {
    position: "bottom-right",
    width: "380px",
    height: "600px",
    marginBottom: "20px",
    marginSide: "20px",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: 9999,
    buttonSize: "60px",
    buttonBorderRadius: "50%",
    buttonBackgroundColor: "#0ea5e9",
    buttonBoxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    buttonIconColor: "#ffffff",
    buttonPosition: "20px",
  }

  // Obtener el script actual y el cliente_id
  const currentScript = document.currentScript
  const clienteId = currentScript ? currentScript.getAttribute("data-client-id") : null

  if (!clienteId) {
    console.error("[WIDGET] El atributo data-client-id es obligatorio para el widget de chat")
    return
  }

  console.log(`[WIDGET] Inicializando widget para cliente_id: ${clienteId}`)

  // Variables globales del widget
  let isOpen = false
  let iframe = null
  let chatButton = null
  let widgetContainer = null

  // Función para crear el contenedor del widget
  function createWidgetContainer() {
    if (widgetContainer) return widgetContainer

    widgetContainer = document.createElement("div")
    widgetContainer.id = "treelan-chat-widget-container"
    widgetContainer.style.position = "fixed"
    widgetContainer.style.bottom = "0"
    widgetContainer.style.right = defaultConfig.position === "bottom-right" ? "0" : "auto"
    widgetContainer.style.left = defaultConfig.position === "bottom-left" ? "0" : "auto"
    widgetContainer.style.zIndex = defaultConfig.zIndex
    widgetContainer.style.pointerEvents = "none" // Permitir clics a través del contenedor

    document.body.appendChild(widgetContainer)
    return widgetContainer
  }

  // Función para crear el botón de chat
  function createChatButton() {
    if (chatButton) return chatButton

    chatButton = document.createElement("div")
    chatButton.id = "treelan-chat-widget-button"
    chatButton.style.position = "fixed"
    chatButton.style.bottom = defaultConfig.buttonPosition
    chatButton.style.right = defaultConfig.position === "bottom-right" ? defaultConfig.buttonPosition : "auto"
    chatButton.style.left = defaultConfig.position === "bottom-left" ? defaultConfig.buttonPosition : "auto"
    chatButton.style.width = defaultConfig.buttonSize
    chatButton.style.height = defaultConfig.buttonSize
    chatButton.style.borderRadius = defaultConfig.buttonBorderRadius
    chatButton.style.backgroundColor = defaultConfig.buttonBackgroundColor
    chatButton.style.boxShadow = defaultConfig.buttonBoxShadow
    chatButton.style.cursor = "pointer"
    chatButton.style.display = "flex"
    chatButton.style.alignItems = "center"
    chatButton.style.justifyContent = "center"
    chatButton.style.transition = "transform 0.3s ease, box-shadow 0.3s ease"
    chatButton.style.zIndex = defaultConfig.zIndex + 1
    chatButton.style.pointerEvents = "auto" // Permitir clics en el botón

    // Icono del botón (usando SVG inline)
    chatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${defaultConfig.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `

    // Efectos hover
    chatButton.addEventListener("mouseenter", function () {
      this.style.transform = "scale(1.1)"
      this.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)"
    })

    chatButton.addEventListener("mouseleave", function () {
      this.style.transform = "scale(1)"
      this.style.boxShadow = defaultConfig.buttonBoxShadow
    })

    // Evento de clic
    chatButton.addEventListener("click", toggleChat)

    document.body.appendChild(chatButton)
    return chatButton
  }

  // Función para alternar el chat
  function toggleChat() {
    if (isOpen) {
      closeChat()
    } else {
      openChat()
    }
  }

  // Función para abrir el chat
  function openChat() {
    if (isOpen || !chatButton) return

    console.log(`[WIDGET] Abriendo chat para cliente_id: ${clienteId}`)

    // Crear iframe del chat
    iframe = document.createElement("iframe")
    iframe.src = `${window.location.protocol}//${window.location.host}/api/widget?cliente_id=${encodeURIComponent(
      clienteId,
    )}`
    iframe.style.position = "fixed"
    iframe.style.bottom = defaultConfig.marginBottom
    iframe.style.right = defaultConfig.position === "bottom-right" ? defaultConfig.marginSide : "auto"
    iframe.style.left = defaultConfig.position === "bottom-left" ? defaultConfig.marginSide : "auto"
    iframe.style.width = defaultConfig.width
    iframe.style.height = defaultConfig.height
    iframe.style.border = "none"
    iframe.style.borderRadius = defaultConfig.borderRadius
    iframe.style.boxShadow = defaultConfig.boxShadow
    iframe.style.zIndex = defaultConfig.zIndex - 1
    iframe.style.opacity = "0"
    iframe.style.transform = "translateY(20px)"
    iframe.style.transition = "opacity 0.3s ease, transform 0.3s ease"
    iframe.style.pointerEvents = "auto"

    const container = createWidgetContainer()
    container.appendChild(iframe)

    // Animar la apertura
    setTimeout(() => {
      if (iframe) {
        iframe.style.opacity = "1"
        iframe.style.transform = "translateY(0)"
      }
    }, 10)

    // Cambiar el icono a cerrar
    chatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${defaultConfig.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `

    isOpen = true
  }

  // Función para cerrar el chat
  function closeChat() {
    if (!isOpen || !iframe || !chatButton) return

    console.log(`[WIDGET] Cerrando chat`)

    // Animar el cierre
    iframe.style.opacity = "0"
    iframe.style.transform = "translateY(20px)"

    setTimeout(() => {
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
        iframe = null
      }
    }, 300)

    // Cambiar el icono a chat
    chatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${defaultConfig.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `

    isOpen = false
  }

  // Función para destruir el widget
  function destroyWidget() {
    console.log(`[WIDGET] Destruyendo widget`)

    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe)
      iframe = null
    }

    if (chatButton && chatButton.parentNode) {
      chatButton.parentNode.removeChild(chatButton)
      chatButton = null
    }

    if (widgetContainer && widgetContainer.parentNode) {
      widgetContainer.parentNode.removeChild(widgetContainer)
      widgetContainer = null
    }

    isOpen = false
  }

  // Inicializar el widget cuando el DOM esté listo
  function initWidget() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initWidget)
      return
    }

    console.log(`[WIDGET] DOM listo, creando widget`)

    // Crear el contenedor y el botón
    createWidgetContainer()
    createChatButton()

    console.log(`[WIDGET] Widget inicializado correctamente para cliente_id: ${clienteId}`)
  }

  // Exponer API global del widget
  window.TreelanChatWidget = {
    open: openChat,
    close: closeChat,
    toggle: toggleChat,
    destroy: destroyWidget,
    isOpen: () => isOpen,
    clienteId: clienteId,
  }

  // Inicializar el widget
  initWidget()

  console.log(`[WIDGET] Widget cargado y listo para cliente_id: ${clienteId}`)
})()
