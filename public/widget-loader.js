;(() => {
  // Verificar si ya se cargó el widget
  if (window.TreelanChatWidget) {
    console.log("[WIDGET] Widget ya cargado")
    return
  }

  // Configuración por defecto
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

  // Obtener la URL base del widget desde el script o usar una por defecto
  let widgetBaseUrl = currentScript ? currentScript.getAttribute("data-base-url") : null

  // Si no se especifica base-url, intentar detectarla desde el src del script
  if (!widgetBaseUrl && currentScript && currentScript.src) {
    try {
      const scriptUrl = new URL(currentScript.src)
      widgetBaseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`
    } catch (e) {
      console.error("[WIDGET] Error detectando URL base:", e)
    }
  }

  // Fallback a localhost para desarrollo
  if (!widgetBaseUrl) {
    widgetBaseUrl =
      window.location.protocol === "https:"
        ? "https://your-domain.vercel.app" // Reemplaza con tu dominio real
        : "http://localhost:3000"
  }

  console.log(`[WIDGET] URL base detectada: ${widgetBaseUrl}`)

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
      console.log(`[WIDGET] Obteniendo configuración para cliente_id: ${clienteId}`)
      const configUrl = `${widgetBaseUrl}/api/widget?cliente_id=${encodeURIComponent(clienteId)}&config_only=true`
      console.log(`[WIDGET] URL de configuración: ${configUrl}`)

      const response = await fetch(configUrl)
      if (response.ok) {
        const config = await response.json()
        widgetConfig = config
        console.log("[WIDGET] Configuración obtenida:", config)
        return config
      } else {
        console.error("[WIDGET] Error al obtener configuración:", response.status, response.statusText)
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

    document.body.appendChild(widgetContainer)
    return widgetContainer
  }

  // Función para crear el texto del botón flotante
  function createButtonText() {
    if (!widgetConfig?.widgetShowFloatingText || !widgetConfig?.widgetFloatingButtonText) return null

    const config = getAppliedConfig()

    buttonTextElement = document.createElement("div")
    buttonTextElement.style.position = "fixed"
    buttonTextElement.style.bottom = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 15}px`

    // Posicionar el texto siempre a la izquierda del botón
    if (config.position.includes("right")) {
      // Si el botón está a la derecha, el texto va a su izquierda
      buttonTextElement.style.right = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 15}px`
      buttonTextElement.style.left = "auto"
    } else {
      // Si el botón está a la izquierda, el texto va a su derecha
      buttonTextElement.style.left = `${Number.parseInt(config.buttonPosition) + Number.parseInt(config.buttonSize) + 15}px`
      buttonTextElement.style.right = "auto"
    }

    buttonTextElement.style.backgroundColor = config.buttonTextBackground
    buttonTextElement.style.color = config.buttonTextColor
    buttonTextElement.style.padding = "12px 16px"
    buttonTextElement.style.borderRadius = "12px"
    buttonTextElement.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"
    buttonTextElement.style.fontSize = "14px"
    buttonTextElement.style.fontFamily = "system-ui, -apple-system, sans-serif"
    buttonTextElement.style.maxWidth = "280px"
    buttonTextElement.style.minWidth = "fit-content"
    buttonTextElement.style.width = "auto"
    buttonTextElement.style.textAlign = "center"
    buttonTextElement.style.zIndex = config.zIndex - 1
    buttonTextElement.style.pointerEvents = "auto"
    buttonTextElement.style.cursor = "pointer"
    buttonTextElement.style.whiteSpace = "nowrap"
    buttonTextElement.style.overflow = "visible"
    buttonTextElement.style.textOverflow = "unset"
    buttonTextElement.style.display = "flex"
    buttonTextElement.style.alignItems = "center"
    buttonTextElement.style.justifyContent = "center"

    if (widgetConfig.widgetAnimation !== false) {
      buttonTextElement.style.transition = "opacity 0.3s ease, transform 0.3s ease"
      buttonTextElement.style.transform = "translateY(10px)"
      buttonTextElement.style.opacity = "0"
    }

    buttonTextElement.textContent = widgetConfig.widgetFloatingButtonText
    buttonTextElement.addEventListener("click", toggleChat)

    setTimeout(() => {
      if (buttonTextElement && widgetConfig.widgetAnimation !== false) {
        buttonTextElement.style.opacity = "1"
        buttonTextElement.style.transform = "translateY(0)"
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
    chatButton.style.zIndex = config.zIndex
    chatButton.style.pointerEvents = "auto"

    if (widgetConfig?.widgetAnimation !== false) {
      chatButton.style.transition = "transform 0.3s ease, box-shadow 0.3s ease"
    }

    chatButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    `

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

    chatButton.addEventListener("click", toggleChat)
    document.body.appendChild(chatButton)
    return chatButton
  }

  // Función para alternar el chat
  function toggleChat() {
    console.log(`[WIDGET] Toggle chat - isOpen: ${isOpen}`)
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

    console.log(`[WIDGET] Minimizar chat - isMinimized: ${isMinimized}`)

    if (isMinimized) {
      iframe.style.height = "60px"
      iframe.style.overflow = "hidden"
    } else {
      iframe.style.height = config.height
      iframe.style.overflow = "visible"
    }
  }

  // Función para abrir el chat
  function openChat() {
    if (isOpen || !chatButton) return

    console.log(`[WIDGET] Abriendo chat para cliente_id: ${clienteId}`)

    const config = getAppliedConfig()

    // Ocultar el texto del botón
    if (buttonTextElement) {
      if (widgetConfig?.widgetAnimation !== false) {
        buttonTextElement.style.opacity = "0"
        buttonTextElement.style.transform = "translateY(10px)"
      }
      setTimeout(() => {
        if (buttonTextElement && buttonTextElement.parentNode) {
          buttonTextElement.parentNode.removeChild(buttonTextElement)
          buttonTextElement = null
        }
      }, 300)
    }

    // Crear iframe del chat con URL absoluta
    iframe = document.createElement("iframe")
    iframe.id = "treelan-chat-widget-iframe"
    const iframeUrl = `${widgetBaseUrl}/api/widget?cliente_id=${encodeURIComponent(clienteId)}`
    console.log(`[WIDGET] URL del iframe: ${iframeUrl}`)
    iframe.src = iframeUrl
    // Posicionar el iframe al lado del botón, no encima
    iframe.style.position = "fixed"
    iframe.style.bottom = config.marginBottom

    // Posicionar el chat siempre a la izquierda del botón
    if (config.position.includes("right")) {
      // Si el botón está a la derecha, el chat va a su izquierda
      iframe.style.right = `${Number.parseInt(config.marginSide) + Number.parseInt(config.buttonSize) + 15}px`
      iframe.style.left = "auto"
    } else {
      // Si el botón está a la izquierda, el chat va a su derecha
      iframe.style.left = `${Number.parseInt(config.marginSide) + Number.parseInt(config.buttonSize) + 15}px`
      iframe.style.right = "auto"
    }

    iframe.style.width = config.width
    iframe.style.height = config.height
    iframe.style.border = "none"
    iframe.style.borderRadius = config.borderRadius
    iframe.style.boxShadow = config.boxShadow
    iframe.style.zIndex = config.zIndex - 1
    iframe.style.pointerEvents = "auto"
    iframe.style.backgroundColor = "#ffffff"

    // Animaciones de apertura
    if (widgetConfig?.widgetAnimation !== false) {
      iframe.style.opacity = "0"
      iframe.style.transform = "translateY(20px)"
      iframe.style.transition = "opacity 0.3s ease, transform 0.3s ease"
    }

    const container = createWidgetContainer()
    container.appendChild(iframe)

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

    // Manejar errores de carga del iframe
    iframe.addEventListener("load", () => {
      console.log("[WIDGET] Iframe cargado correctamente")
    })

    iframe.addEventListener("error", (e) => {
      console.error("[WIDGET] Error cargando iframe:", e)
    })

    isOpen = true
    isMinimized = false
  }

  // Función para cerrar el chat
  function closeChat() {
    if (!isOpen || !iframe) return

    console.log(`[WIDGET] Cerrando chat`)

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
      },
      widgetConfig?.widgetAnimation !== false ? 300 : 0,
    )

    isOpen = false
    isMinimized = false

    // Recrear el texto del botón
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

    if (widgetContainer && widgetContainer.parentNode) {
      widgetContainer.parentNode.removeChild(widgetContainer)
      widgetContainer = null
    }

    isOpen = false
    isMinimized = false
  }

  // Inicializar el widget
  async function initWidget() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initWidget)
      return
    }

    console.log(`[WIDGET] DOM listo, inicializando widget`)

    try {
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
    } catch (error) {
      console.error(`[WIDGET] Error inicializando widget:`, error)
    }
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
    getBaseUrl: () => widgetBaseUrl,
  }

  // Inicializar el widget
  initWidget()

  console.log(`[WIDGET] Widget loader ejecutado para cliente_id: ${clienteId}`)
})()
