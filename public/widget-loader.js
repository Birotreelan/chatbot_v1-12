;(() => {
  const scriptElement = document.currentScript
  const clienteId = scriptElement.getAttribute("data-cliente-id")

  if (!clienteId) {
    console.error("[WIDGET-LOADER] Error: data-cliente-id es requerido")
    return
  }

  console.log("[WIDGET-LOADER] Cliente ID obtenido:", clienteId)
  console.log("[WIDGET-LOADER] Script URL:", scriptElement.src)

  // Obtener el dominio base del script
  const scriptUrl = new URL(scriptElement.src)
  const baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`

  const config = {
    position: scriptElement.getAttribute("data-position") || "bottom-right",
    widgetUrl: scriptElement.getAttribute("data-widget-url") || `${baseUrl}/widget`,
  }

  console.log("[WIDGET-LOADER] Configuración:", config)

  let isWidgetVisible = false
  let widgetContainer = null

  function createFloatingButton() {
    const button = document.createElement("div")
    button.id = "chat-widget-button"
    button.style.cssText = `
      position: fixed;
      z-index: 9998;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: linear-gradient(135deg, #25D366, #128C7E);
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      ${config.position === "bottom-left" ? "left: 20px;" : "right: 20px;"}
      bottom: 20px;
    `

    // Icono de chat
    button.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
    `

    button.addEventListener("click", toggleWidget)
    button.addEventListener("mouseenter", () => {
      button.style.transform = "scale(1.1)"
    })
    button.addEventListener("mouseleave", () => {
      button.style.transform = "scale(1)"
    })

    document.body.appendChild(button)
    return button
  }

  function createWidget() {
    const container = document.createElement("div")
    container.id = "chat-widget-container"
    container.style.cssText = `
      position: fixed;
      z-index: 9999;
      width: 350px;
      height: 500px;
      border: none;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      ${config.position === "bottom-left" ? "left: 20px;" : "right: 20px;"}
      bottom: 90px;
      display: none;
      background: white;
      overflow: hidden;
    `

    const iframe = document.createElement("iframe")
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 12px;
    `
    iframe.src = `${config.widgetUrl}?clienteId=${clienteId}&position=${config.position}&embedded=true`

    // Manejar errores de carga del iframe
    iframe.onerror = () => {
      console.error("[WIDGET-LOADER] Error cargando el widget")
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666;">
          <p>Error cargando el chat</p>
          <p style="font-size: 12px;">Intenta recargar la página</p>
        </div>
      `
    }

    container.appendChild(iframe)
    document.body.appendChild(container)

    console.log("[WIDGET-LOADER] Widget creado:", {
      src: iframe.src,
      clienteId: clienteId,
      position: config.position,
    })

    return container
  }

  function toggleWidget() {
    if (!widgetContainer) {
      widgetContainer = createWidget()
    }

    if (isWidgetVisible) {
      widgetContainer.style.display = "none"
      isWidgetVisible = false
    } else {
      widgetContainer.style.display = "block"
      isWidgetVisible = true
    }
  }

  function initWidget() {
    try {
      createFloatingButton()
      console.log("[WIDGET-LOADER] Widget inicializado correctamente")
    } catch (error) {
      console.error("[WIDGET-LOADER] Error inicializando widget:", error)
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget)
  } else {
    initWidget()
  }
})()
