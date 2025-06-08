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
    buttonTextColor: "#333333",
    buttonTextBackground: "#ffffff",
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
  let isMinimized = false
  let iframe = null
  let chatButton = null
  let widgetContainer = null
  let buttonTextElement = null
  let widgetConfig = null

  // Función para obtener la configuración del widget
  async function fetchWidgetConfig() {
    try {
      const response = await fetch(
        `${window.location.protocol}//${window.location.host}/api/widget?cliente_id=${encodeURIComponent(clienteId)}&config_only=true`,
      )
      if (response.ok) {
        const config = await response.json()
        widgetConfig = config
        console.log("[WIDGET] Configuración obtenida:", config)
        return config
      }
    } catch (error) {
      console.error("[WIDGET] Error al obtener configuración:", error)
    }
    return null
  }

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
    widgetContainer.style.pointerEvents = "none"

    document.body.appendChild(widgetContainer)
    return widgetContainer
  }

  // Función para crear el texto del botón
  function createButtonText() {
    if (!widgetConfig?.widgetShowButtonText || !widgetConfig?.widgetButtonSubtext) return null

    buttonTextElement = document.createElement("div")
    buttonTextElement.style.position = "fixed"
    buttonTextElement.style.bottom = `${Number.parseInt(defaultConfig.buttonPosition) + Number.parseInt(defaultConfig.buttonSize) + 10}px`
    buttonTextElement.style.right = defaultConfig.position === "bottom-right" ? defaultConfig.buttonPosition : "auto"
    buttonTextElement.style.left = defaultConfig.position === "bottom-left" ? defaultConfig.buttonPosition : "auto"
    buttonTextElement.style.backgroundColor = defaultConfig.buttonTextBackground
    buttonTextElement.style.color = defaultConfig.buttonTextColor
    buttonTextElement.style.padding = "8px 12px"
    buttonTextElement.style.borderRadius = "8px"
    buttonTextElement.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"
    buttonTextElement.style.fontSize = "14px"
    buttonTextElement.style.fontFamily = "system-ui, -apple-system, sans-serif"
    buttonTextElement.style.maxWidth = "200px"
    buttonTextElement.style.textAlign = "center"
    buttonTextElement.style.zIndex = defaultConfig.zIndex + 1
    buttonTextElement.style.pointerEvents = "auto"
    buttonTextElement.style.cursor = "pointer"
    buttonTextElement.style.transition = "opacity 0.3s ease, transform 0.3s ease"
    buttonTextElement.style.transform = "translateY(10px)"
    buttonTextElement.style.opacity = "0"

    buttonTextElement.textContent = widgetConfig.widgetButtonSubtext

    // Agregar evento de clic
    buttonTextElement.addEventListener("click", toggleChat)

    // Mostrar con animación después de un delay
    setTimeout(() => {
      if (buttonTextElement) {
        buttonTextElement.style.opacity = "1"
        buttonTextElement.style.transform = "translateY(0)"
      }
    }, 1000)

    document.body.appendChild(buttonTextElement)
    return buttonTextElement
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
    chatButton.style.backgroundColor = widgetConfig?.widgetPrimaryColor || defaultConfig.buttonBackgroundColor
    chatButton.style.boxShadow = defaultConfig.buttonBoxShadow
    chatButton.style.cursor = "pointer"
    chatButton.style.display = "flex"
    chatButton.style.alignItems = "center"
    chatButton.style.justifyContent = "center"
    chatButton.style.transition = "transform 0.3s ease, box-shadow 0.3s ease"
    chatButton.style.zIndex = defaultConfig.zIndex + 1
    chatButton.style.pointerEvents = "auto"

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

  // Función para crear el header del chat con controles
  function createChatHeader() {
    const header = document.createElement("div")
    header.style.position = "absolute"
    header.style.top = "0"
    header.style.right = "0"
    header.style.padding = "8px"
    header.style.display = "flex"
    header.style.gap = "4px"
    header.style.zIndex = "10"
    header.style.backgroundColor = "rgba(255, 255, 255, 0.9)"
    header.style.borderRadius = "0 12px 0 8px"

    // Botón minimizar
    const minimizeButton = document.createElement("button")
    minimizeButton.style.width = "24px"
    minimizeButton.style.height = "24px"
    minimizeButton.style.border = "none"
    minimizeButton.style.borderRadius = "4px"
    minimizeButton.style.backgroundColor = "transparent"
    minimizeButton.style.cursor = "pointer"
    minimizeButton.style.display = "flex"
    minimizeButton.style.alignItems = "center"
    minimizeButton.style.justifyContent = "center"
    minimizeButton.style.transition = "background-color 0.2s ease"
    minimizeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `
    minimizeButton.addEventListener("click", minimizeChat)
    minimizeButton.addEventListener("mouseenter", function () {
      this.style.backgroundColor = "#f0f0f0"
    })
    minimizeButton.addEventListener("mouseleave", function () {
      this.style.backgroundColor = "transparent"
    })

    // Botón cerrar
    const closeButton = document.createElement("button")
    closeButton.style.width = "24px"
    closeButton.style.height = "24px"
    closeButton.style.border = "none"
    closeButton.style.borderRadius = "4px"
    closeButton.style.backgroundColor = "transparent"
    closeButton.style.cursor = "pointer"
    closeButton.style.display = "flex"
    closeButton.style.alignItems = "center"
    closeButton.style.justifyContent = "center"
    closeButton.style.transition = "background-color 0.2s ease"
    closeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `
    closeButton.addEventListener("click", closeChat)
    closeButton.addEventListener("mouseenter", function () {
      this.style.backgroundColor = "#fee"
    })
    closeButton.addEventListener("mouseleave", function () {
      this.style.backgroundColor = "transparent"
    })

    header.appendChild(minimizeButton)
    header.appendChild(closeButton)
    return header
  }

  // Función para alternar el chat
  function toggleChat() {
    if (isOpen) {
      closeChat()
    } else {
      openChat()
    }
  }

  // Función para minimizar el chat
  function minimizeChat() {
    if (!iframe) return

    isMinimized = !isMinimized

    if (isMinimized) {
      iframe.style.height = "60px"
      iframe.style.overflow = "hidden"
    } else {
      iframe.style.height = defaultConfig.height
      iframe.style.overflow = "visible"
    }
  }

  // Función para abrir el chat
  function openChat() {
    if (isOpen || !chatButton) return

    console.log(`[WIDGET] Abriendo chat para cliente_id: ${clienteId}`)

    // Ocultar el texto del botón
    if (buttonTextElement) {
      buttonTextElement.style.opacity = "0"
      buttonTextElement.style.transform = "translateY(10px)"
      setTimeout(() => {
        if (buttonTextElement && buttonTextElement.parentNode) {
          buttonTextElement.parentNode.removeChild(buttonTextElement)
          buttonTextElement = null
        }
      }, 300)
    }

    // Crear iframe del chat
    iframe = document.createElement("iframe")
    iframe.src = `${window.location.protocol}//${window.location.host}/api/widget?cliente_id=${encodeURIComponent(clienteId)}`
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

    // Agregar header con controles
    const header = createChatHeader()
    container.appendChild(header)

    // Animar la apertura
    setTimeout(() => {
      if (iframe) {
        iframe.style.opacity = "1"
        iframe.style.transform = "translateY(0)"
      }
    }, 10)

    isOpen = true
    isMinimized = false
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
      // Remover header también
      const header = document.querySelector("#treelan-chat-widget-container > div")
      if (header && header.parentNode) {
        header.parentNode.removeChild(header)
      }
    }, 300)

    isOpen = false
    isMinimized = false

    // Recrear el texto del botón si está habilitado
    if (widgetConfig?.widgetShowButtonText) {
      setTimeout(() => {
        createButtonText()
      }, 500)
    }
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

    if (buttonTextElement && buttonTextElement.parentNode) {
      buttonTextElement.parentNode.removeChild(buttonTextElement)
      buttonTextElement = null
    }

    if (widgetContainer && widgetContainer.parentNode) {
      widgetContainer.parentNode.removeChild(widgetContainer)
      widgetContainer = null
    }

    isOpen = false
    isMinimized = false
  }

  // Inicializar el widget cuando el DOM esté listo
  async function initWidget() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initWidget)
      return
    }

    console.log(`[WIDGET] DOM listo, obteniendo configuración`)

    // Obtener configuración del widget
    await fetchWidgetConfig()

    console.log(`[WIDGET] Creando widget`)

    // Crear el contenedor y el botón
    createWidgetContainer()
    createChatButton()

    // Crear texto del botón si está habilitado
    if (widgetConfig?.widgetShowButtonText) {
      createButtonText()
    }

    console.log(`[WIDGET] Widget inicializado correctamente para cliente_id: ${clienteId}`)
  }

  // Exponer API global del widget
  window.TreelanChatWidget = {
    open: openChat,
    close: closeChat,
    toggle: toggleChat,
    minimize: minimizeChat,
    destroy: destroyWidget,
    isOpen: () => isOpen,
    isMinimized: () => isMinimized,
    clienteId: clienteId,
  }

  // Inicializar el widget
  initWidget()

  console.log(`[WIDGET] Widget cargado y listo para cliente_id: ${clienteId}`)
})()
