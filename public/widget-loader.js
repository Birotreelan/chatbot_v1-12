;(() => {
  // Verificar si ya se cargó el widget
  if (window.TreelanChatWidget) {
    console.log("[WIDGET] Widget ya cargado")
    return
  }

  // Configuración por defecto que se sobrescribirá con la del servidor
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
  let headerControls = null
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

  // Función para obtener la configuración aplicada
  function getAppliedConfig() {
    if (!widgetConfig) return defaultConfig

    return {
      position: widgetConfig.widgetPosition || defaultConfig.position,
      width: `${widgetConfig.widgetMaxWidth || 380}px`,
      height: `${widgetConfig.widgetMaxHeight || 600}px`,
      marginBottom: defaultConfig.marginBottom,
      marginSide: defaultConfig.marginSide,
      borderRadius: `${widgetConfig.widgetBorderRadius || 12}px`,
      boxShadow: widgetConfig.widgetShadow !== false ? defaultConfig.boxShadow : "none",
      zIndex: defaultConfig.zIndex,
      buttonSize: defaultConfig.buttonSize,
      buttonBorderRadius: defaultConfig.buttonBorderRadius,
      buttonBackgroundColor: widgetConfig.widgetPrimaryColor || defaultConfig.buttonBackgroundColor,
      buttonBoxShadow: defaultConfig.buttonBoxShadow,
      buttonIconColor: defaultConfig.buttonIconColor,
      buttonPosition: defaultConfig.buttonPosition,
      buttonTextColor: defaultConfig.buttonTextColor,
      buttonTextBackground: defaultConfig.buttonTextBackground,
    }
  }

  // Función para crear el contenedor del widget
  function createWidgetContainer() {
    if (widgetContainer) return widgetContainer

    const config = getAppliedConfig()

    widgetContainer = document.createElement("div")
    widgetContainer.id = "treelan-chat-widget-container"
    widgetContainer.style.position = "fixed"
    widgetContainer.style.bottom = "0"
    widgetContainer.style.right = config.position.includes("right") ? "0" : "auto"
    widgetContainer.style.left = config.position.includes("left") ? "0" : "auto"
    widgetContainer.style.zIndex = config.zIndex
    widgetContainer.style.pointerEvents = "none"
    widgetContainer.style.width = "100%" // Asegurar que el contenedor ocupe todo el ancho

    document.body.appendChild(widgetContainer)
    return widgetContainer
  }

  // Función para crear el texto del botón (al costado)
  function createButtonText() {
    if (!widgetConfig?.widgetShowFloatingText || !widgetConfig?.widgetFloatingButtonText) return null

    const config = getAppliedConfig()

    buttonTextElement = document.createElement("div")
    buttonTextElement.style.position = "fixed"
    // Cambiar la línea de posicionamiento bottom para dar más espacio
    buttonTextElement.style.bottom = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 25}px` // Más espacio vertical

    // Y ajustar el posicionamiento horizontal para que no interfiera con el chat
    if (config.position.includes("right")) {
      // Si el botón está a la derecha, el texto va más a la izquierda para no pisar el chat
      buttonTextElement.style.right = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 25}px`
      buttonTextElement.style.left = "auto"
    } else {
      // Si el botón está a la izquierda, el texto va más a la derecha
      buttonTextElement.style.left = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 25}px`
      buttonTextElement.style.right = "auto"
    }

    buttonTextElement.style.backgroundColor = config.buttonTextBackground
    buttonTextElement.style.color = config.buttonTextColor
    buttonTextElement.style.padding = "8px 12px"
    buttonTextElement.style.borderRadius = "8px"
    buttonTextElement.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"
    buttonTextElement.style.fontSize = "14px"
    buttonTextElement.style.fontFamily = "system-ui, -apple-system, sans-serif"
    buttonTextElement.style.maxWidth = "200px"
    buttonTextElement.style.textAlign = "center"
    buttonTextElement.style.zIndex = config.zIndex - 1 // Asegurar que esté por debajo del botón
    buttonTextElement.style.pointerEvents = "auto"
    buttonTextElement.style.cursor = "pointer"
    buttonTextElement.style.whiteSpace = "nowrap"
    buttonTextElement.style.overflow = "hidden"
    buttonTextElement.style.textOverflow = "ellipsis" // Añadir puntos suspensivos si el texto es muy largo

    // Animaciones si están habilitadas
    if (widgetConfig.widgetAnimation !== false) {
      buttonTextElement.style.transition = "opacity 0.3s ease, transform 0.3s ease"
      buttonTextElement.style.transform = config.position.includes("right") ? "translateX(10px)" : "translateX(-10px)"
      buttonTextElement.style.opacity = "0"
    }

    buttonTextElement.textContent = widgetConfig.widgetFloatingButtonText

    // Agregar evento de clic
    buttonTextElement.addEventListener("click", toggleChat)

    // Mostrar con animación después de un delay
    setTimeout(() => {
      if (buttonTextElement && widgetConfig.widgetAnimation !== false) {
        buttonTextElement.style.opacity = "1"
        buttonTextElement.style.transform = "translateX(0)"
      } else if (buttonTextElement) {
        buttonTextElement.style.opacity = "1"
      }
    }, 1000)

    document.body.appendChild(buttonTextElement)
    return buttonTextElement
  }

  // Función para crear el botón de chat
  function createChatButton() {
    if (chatButton) return chatButton

    const config = getAppliedConfig()

    chatButton = document.createElement("div")
    chatButton.id = "treelan-chat-widget-button"
    chatButton.style.position = "fixed"
    chatButton.style.bottom = config.buttonPosition
    chatButton.style.right = config.position.includes("right") ? config.buttonPosition : "auto"
    chatButton.style.left = config.position.includes("left") ? config.buttonPosition : "auto"
    chatButton.style.width = config.buttonSize
    chatButton.style.height = config.buttonSize
    chatButton.style.borderRadius = config.buttonBorderRadius
    chatButton.style.backgroundColor = config.buttonBackgroundColor
    chatButton.style.boxShadow = config.buttonBoxShadow
    chatButton.style.cursor = "pointer"
    chatButton.style.display = "flex"
    chatButton.style.alignItems = "center"
    chatButton.style.justifyContent = "center"
    chatButton.style.zIndex = config.zIndex // Asegurar que esté por encima del texto
    chatButton.style.pointerEvents = "auto"

    // Animaciones si están habilitadas
    if (widgetConfig?.widgetAnimation !== false) {
      chatButton.style.transition = "transform 0.3s ease, box-shadow 0.3s ease"
    }

    // Icono del botón (usando SVG inline)
    chatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `

    // Efectos hover si las animaciones están habilitadas
    if (widgetConfig?.widgetAnimation !== false) {
      chatButton.addEventListener("mouseenter", function () {
        this.style.transform = "scale(1.1)"
        this.style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)"
      })

      chatButton.addEventListener("mouseleave", function () {
        this.style.transform = "scale(1)"
        this.style.boxShadow = config.buttonBoxShadow
      })
    }

    // Evento de clic
    chatButton.addEventListener("click", toggleChat)

    document.body.appendChild(chatButton)
    return chatButton
  }

  // Función para crear los controles del header
  function createHeaderControls() {
    const config = getAppliedConfig()

    headerControls = document.createElement("div")
    headerControls.id = "treelan-chat-widget-controls"
    headerControls.style.position = "absolute"
    headerControls.style.top = "12px"
    headerControls.style.right = "12px"
    headerControls.style.display = "flex"
    headerControls.style.gap = "6px"
    headerControls.style.zIndex = (Number.parseInt(config.zIndex) + 10).toString()
    headerControls.style.pointerEvents = "auto"

    // Botón minimizar
    const minimizeButton = document.createElement("button")
    minimizeButton.id = "treelan-chat-widget-minimize"
    minimizeButton.style.width = "32px"
    minimizeButton.style.height = "32px"
    minimizeButton.style.border = "none"
    minimizeButton.style.borderRadius = "6px"
    minimizeButton.style.backgroundColor = "rgba(255, 255, 255, 0.95)"
    minimizeButton.style.backdropFilter = "blur(4px)"
    minimizeButton.style.cursor = "pointer"
    minimizeButton.style.display = "flex"
    minimizeButton.style.alignItems = "center"
    minimizeButton.style.justifyContent = "center"
    minimizeButton.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)"
    minimizeButton.style.transition = "background-color 0.2s ease, transform 0.1s ease"
    minimizeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `

    minimizeButton.addEventListener("click", (e) => {
      e.stopPropagation()
      minimizeChat()
    })

    minimizeButton.addEventListener("mouseenter", function () {
      this.style.backgroundColor = "#f0f0f0"
      this.style.transform = "scale(1.05)"
    })

    minimizeButton.addEventListener("mouseleave", function () {
      this.style.backgroundColor = "rgba(255, 255, 255, 0.95)"
      this.style.transform = "scale(1)"
    })

    // Botón cerrar
    const closeButton = document.createElement("button")
    closeButton.id = "treelan-chat-widget-close"
    closeButton.style.width = "32px"
    closeButton.style.height = "32px"
    closeButton.style.border = "none"
    closeButton.style.borderRadius = "6px"
    closeButton.style.backgroundColor = "rgba(255, 255, 255, 0.95)"
    closeButton.style.backdropFilter = "blur(4px)"
    closeButton.style.cursor = "pointer"
    closeButton.style.display = "flex"
    closeButton.style.alignItems = "center"
    closeButton.style.justifyContent = "center"
    closeButton.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)"
    closeButton.style.transition = "background-color 0.2s ease, transform 0.1s ease"
    closeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `

    closeButton.addEventListener("click", (e) => {
      e.stopPropagation()
      closeChat()
    })

    closeButton.addEventListener("mouseenter", function () {
      this.style.backgroundColor = "#fee"
      this.style.transform = "scale(1.05)"
    })

    closeButton.addEventListener("mouseleave", function () {
      this.style.backgroundColor = "rgba(255, 255, 255, 0.95)"
      this.style.transform = "scale(1)"
    })

    headerControls.appendChild(minimizeButton)
    headerControls.appendChild(closeButton)

    return headerControls
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
    const config = getAppliedConfig()

    if (isMinimized) {
      iframe.style.height = "60px"
      iframe.style.overflow = "hidden"
      // Actualizar el icono de minimizar para mostrar "restaurar"
      const minimizeButton = headerControls?.querySelector("#treelan-chat-widget-minimize")
      if (minimizeButton) {
        minimizeButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect>
          </svg>
        `
      }
    } else {
      iframe.style.height = config.height
      iframe.style.overflow = "visible"
      // Restaurar el icono de minimizar
      const minimizeButton = headerControls?.querySelector("#treelan-chat-widget-minimize")
      if (minimizeButton) {
        minimizeButton.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        `
      }
    }
  }

  // Función para abrir el chat
  function openChat() {
    if (isOpen || !chatButton) return

    console.log(`[WIDGET] Abriendo chat para cliente_id: ${clienteId}`)

    const config = getAppliedConfig()

    // Ocultar el texto del botón con animación
    if (buttonTextElement) {
      if (widgetConfig?.widgetAnimation !== false) {
        buttonTextElement.style.opacity = "0"
        buttonTextElement.style.transform = config.position.includes("right") ? "translateX(10px)" : "translateX(-10px)"
      }
      setTimeout(() => {
        if (buttonTextElement && buttonTextElement.parentNode) {
          buttonTextElement.parentNode.removeChild(buttonTextElement)
          buttonTextElement = null
        }
      }, 300)
    }

    // Crear iframe del chat
    iframe = document.createElement("iframe")
    iframe.id = "treelan-chat-widget-iframe"
    iframe.src = `${window.location.protocol}//${window.location.host}/api/widget?cliente_id=${encodeURIComponent(clienteId)}`
    iframe.style.position = "fixed"
    iframe.style.bottom = config.marginBottom
    iframe.style.right = config.position.includes("right") ? config.marginSide : "auto"
    iframe.style.left = config.position.includes("left") ? config.marginSide : "auto"
    iframe.style.width = config.width
    iframe.style.height = config.height
    iframe.style.border = "none"
    iframe.style.borderRadius = config.borderRadius
    iframe.style.boxShadow = config.boxShadow
    iframe.style.zIndex = config.zIndex - 1
    iframe.style.pointerEvents = "auto"
    iframe.style.backgroundColor = "#ffffff" // Asegurar fondo blanco

    // Animaciones de apertura si están habilitadas
    if (widgetConfig?.widgetAnimation !== false) {
      iframe.style.opacity = "0"
      iframe.style.transform = "translateY(20px)"
      iframe.style.transition = "opacity 0.3s ease, transform 0.3s ease"
    }

    const container = createWidgetContainer()
    container.appendChild(iframe)

    // Agregar controles del header
    const controls = createHeaderControls()
    container.appendChild(controls)

    // Animar la apertura
    if (widgetConfig?.widgetAnimation !== false) {
      setTimeout(() => {
        if (iframe) {
          iframe.style.opacity = "1"
          iframe.style.transform = "translateY(0)"
        }
      }, 10)
    } else {
      iframe.style.opacity = "1"
    }

    isOpen = true
    isMinimized = false
  }

  // Función para cerrar el chat
  function closeChat() {
    if (!isOpen || !iframe || !chatButton) return

    console.log(`[WIDGET] Cerrando chat`)

    const config = getAppliedConfig()

    // Animar el cierre si las animaciones están habilitadas
    if (widgetConfig?.widgetAnimation !== false) {
      iframe.style.opacity = "0"
      iframe.style.transform = "translateY(20px)"
    }

    setTimeout(
      () => {
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe)
          iframe = null
        }
        // Remover controles del header
        if (headerControls && headerControls.parentNode) {
          headerControls.parentNode.removeChild(headerControls)
          headerControls = null
        }
      },
      widgetConfig?.widgetAnimation !== false ? 300 : 0,
    )

    isOpen = false
    isMinimized = false

    // Recrear el texto del botón si está habilitado
    if (widgetConfig?.widgetShowFloatingText) {
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

    if (headerControls && headerControls.parentNode) {
      headerControls.parentNode.removeChild(headerControls)
      headerControls = null
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

    console.log(`[WIDGET] Creando widget con configuración:`, getAppliedConfig())

    // Crear el contenedor y el botón
    createWidgetContainer()
    createChatButton()

    // Crear texto del botón si está habilitado
    if (widgetConfig?.widgetShowFloatingText) {
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
    getConfig: () => widgetConfig,
  }

  // Inicializar el widget
  initWidget()

  console.log(`[WIDGET] Widget cargado y listo para cliente_id: ${clienteId}`)
})()
