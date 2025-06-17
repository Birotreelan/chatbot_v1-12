;(() => {
  console.log("[WIDGET-LOADER] Iniciando carga del widget...")

  const scriptElement = document.currentScript
  if (!scriptElement) {
    console.error("[WIDGET-LOADER] No se pudo obtener el elemento script")
    return
  }

  // Obtener cliente ID con compatibilidad para ambos formatos
  const clienteId = scriptElement.getAttribute("data-cliente-id") || scriptElement.getAttribute("data-client-id")

  console.log("[WIDGET-LOADER] Cliente ID obtenido:", clienteId)
  console.log("[WIDGET-LOADER] Script URL:", scriptElement.src)
  console.log("[WIDGET-LOADER] Todos los atributos:", {
    "data-cliente-id": scriptElement.getAttribute("data-cliente-id"),
    "data-client-id": scriptElement.getAttribute("data-client-id"),
    "data-position": scriptElement.getAttribute("data-position"),
    "data-widget-url": scriptElement.getAttribute("data-widget-url"),
  })

  if (!clienteId) {
    console.error("[WIDGET-LOADER] Error: No se encontró cliente ID. Usa data-cliente-id o data-client-id")
    return
  }

  // Obtener la URL base del script actual
  const scriptUrl = new URL(scriptElement.src)
  const baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`

  const config = {
    position: scriptElement.getAttribute("data-position") || "bottom-right",
    widgetUrl: scriptElement.getAttribute("data-widget-url") || `${baseUrl}/demo`,
    clienteId: clienteId,
  }

  console.log("[WIDGET-LOADER] Configuración final:", config)

  function createFloatingButton() {
    // Crear el botón flotante
    const button = document.createElement("div")
    button.id = "ai-chat-button"
    button.style.cssText = `
      position: fixed;
      z-index: 9998;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      border: none;
    `

    // Posicionar el botón
    switch (config.position) {
      case "bottom-right":
        button.style.bottom = "20px"
        button.style.right = "20px"
        break
      case "bottom-left":
        button.style.bottom = "20px"
        button.style.left = "20px"
        break
      case "top-right":
        button.style.top = "20px"
        button.style.right = "20px"
        break
      case "top-left":
        button.style.top = "20px"
        button.style.left = "20px"
        break
      default:
        button.style.bottom = "20px"
        button.style.right = "20px"
    }

    // Agregar ícono de chat
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `

    // Efectos hover
    button.addEventListener("mouseenter", () => {
      button.style.transform = "scale(1.1)"
      button.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)"
    })

    button.addEventListener("mouseleave", () => {
      button.style.transform = "scale(1)"
      button.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"
    })

    return button
  }

  function createIframe() {
    const iframe = document.createElement("iframe")
    iframe.id = "ai-chat-iframe"
    iframe.style.cssText = `
      position: fixed;
      z-index: 9999;
      border: none;
      width: 350px;
      height: 500px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: none;
      background: white;
    `

    // Posicionar el iframe
    switch (config.position) {
      case "bottom-right":
        iframe.style.bottom = "90px"
        iframe.style.right = "20px"
        break
      case "bottom-left":
        iframe.style.bottom = "90px"
        iframe.style.left = "20px"
        break
      case "top-right":
        iframe.style.top = "90px"
        iframe.style.right = "20px"
        break
      case "top-left":
        iframe.style.top = "90px"
        iframe.style.left = "20px"
        break
      default:
        iframe.style.bottom = "90px"
        iframe.style.right = "20px"
    }

    iframe.src = `${config.widgetUrl}?clienteId=${config.clienteId}&position=${config.position}&embedded=true`

    console.log("[WIDGET-LOADER] Widget iframe creado:", {
      src: iframe.src,
      clienteId: config.clienteId,
      position: config.position,
    })

    return iframe
  }

  function initWidget() {
    const button = createFloatingButton()
    const iframe = createIframe()
    let isOpen = false

    // Agregar elementos al DOM
    document.body.appendChild(button)
    document.body.appendChild(iframe)

    // Manejar click del botón
    button.addEventListener("click", () => {
      isOpen = !isOpen
      iframe.style.display = isOpen ? "block" : "none"

      if (isOpen) {
        iframe.style.animation = "slideIn 0.3s ease-out"
      }
    })

    // Cerrar al hacer click fuera
    document.addEventListener("click", (e) => {
      if (isOpen && !button.contains(e.target) && !iframe.contains(e.target)) {
        isOpen = false
        iframe.style.display = "none"
      }
    })

    console.log("[WIDGET-LOADER] Widget inicializado correctamente")
  }

  // Agregar estilos de animación
  const style = document.createElement("style")
  style.textContent = `
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `
  document.head.appendChild(style)

  // Inicializar cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget)
  } else {
    initWidget()
  }
})()
