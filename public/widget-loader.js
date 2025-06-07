;(() => {
  // Configuración del widget
  const config = {
    position: "bottom-right", // bottom-right o bottom-left
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

  // Obtener el script actual
  const currentScript = document.currentScript
  const clientId = currentScript.getAttribute("data-client-id")

  if (!clientId) {
    console.error("El atributo data-client-id es obligatorio para el widget de chat")
    return
  }

  // Crear el contenedor del widget
  const widgetContainer = document.createElement("div")
  widgetContainer.id = "treelan-chat-widget-container"
  widgetContainer.style.position = "fixed"
  widgetContainer.style.bottom = "0"
  widgetContainer.style.right = config.position === "bottom-right" ? "0" : "auto"
  widgetContainer.style.left = config.position === "bottom-left" ? "0" : "auto"
  widgetContainer.style.zIndex = config.zIndex
  document.body.appendChild(widgetContainer)

  // Estado inicial: cerrado
  let isOpen = false
  let iframe = null

  // Crear el botón de chat
  const chatButton = document.createElement("div")
  chatButton.id = "treelan-chat-widget-button"
  chatButton.style.position = "fixed"
  chatButton.style.bottom = config.buttonPosition
  chatButton.style.right = config.position === "bottom-right" ? config.buttonPosition : "auto"
  chatButton.style.left = config.position === "bottom-left" ? config.buttonPosition : "auto"
  chatButton.style.width = config.buttonSize
  chatButton.style.height = config.buttonSize
  chatButton.style.borderRadius = config.buttonBorderRadius
  chatButton.style.backgroundColor = config.buttonBackgroundColor
  chatButton.style.boxShadow = config.buttonBoxShadow
  chatButton.style.cursor = "pointer"
  chatButton.style.display = "flex"
  chatButton.style.alignItems = "center"
  chatButton.style.justifyContent = "center"
  chatButton.style.transition = "transform 0.3s ease"
  chatButton.style.zIndex = config.zIndex

  // Icono del botón (usando SVG inline para evitar cargar imágenes)
  chatButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `

  // Añadir efecto hover
  chatButton.onmouseover = function () {
    this.style.transform = "scale(1.1)"
  }
  chatButton.onmouseout = function () {
    this.style.transform = "scale(1)"
  }

  // Función para abrir/cerrar el chat
  chatButton.onclick = function () {
    if (isOpen) {
      // Cerrar el chat
      if (iframe) {
        iframe.style.opacity = "0"
        iframe.style.transform = "translateY(20px)"

        setTimeout(() => {
          iframe.remove()
          iframe = null
        }, 300)
      }

      // Cambiar el icono a chat
      this.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `
    } else {
      // Abrir el chat
      iframe = document.createElement("iframe")
      iframe.src = `${window.location.protocol}//${window.location.host}/api/widget?cliente_id=${encodeURIComponent(clientId)}`
      iframe.style.position = "fixed"
      iframe.style.bottom = config.marginBottom
      iframe.style.right = config.position === "bottom-right" ? config.marginSide : "auto"
      iframe.style.left = config.position === "bottom-left" ? config.marginSide : "auto"
      iframe.style.width = config.width
      iframe.style.height = config.height
      iframe.style.border = "none"
      iframe.style.borderRadius = config.borderRadius
      iframe.style.boxShadow = config.boxShadow
      iframe.style.zIndex = config.zIndex - 1
      iframe.style.opacity = "0"
      iframe.style.transform = "translateY(20px)"
      iframe.style.transition = "opacity 0.3s ease, transform 0.3s ease"

      widgetContainer.appendChild(iframe)

      // Animar la apertura
      setTimeout(() => {
        iframe.style.opacity = "1"
        iframe.style.transform = "translateY(0)"
      }, 10)

      // Cambiar el icono a cerrar
      this.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${config.buttonIconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `
    }

    isOpen = !isOpen
  }

  document.body.appendChild(chatButton)
})()
