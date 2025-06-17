;(() => {
  const scriptElement = document.currentScript
  const clienteId = scriptElement.getAttribute("data-cliente-id")

  console.log("[WIDGET-LOADER] Cliente ID obtenido:", clienteId)
  console.log("[WIDGET-LOADER] Script URL:", scriptElement.src)

  const config = {
    position: scriptElement.getAttribute("data-position") || "bottom-right",
    apiUrl: scriptElement.getAttribute("data-api-url") || "https://api.example.com", // Replace with your actual API URL
    widgetUrl: scriptElement.getAttribute("data-widget-url") || "https://widget.example.com", // Replace with your actual Widget URL
  }

  function createIframe() {
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.zIndex = "9999" // Ensure it's on top
    iframe.style.border = "none"
    iframe.style.width = "350px"
    iframe.style.height = "500px"
    iframe.src = `${config.widgetUrl}?clienteId=${clienteId}&position=${config.position}`

    switch (config.position) {
      case "bottom-right":
        iframe.style.bottom = "20px"
        iframe.style.right = "20px"
        break
      case "bottom-left":
        iframe.style.bottom = "20px"
        iframe.style.left = "20px"
        break
      case "top-right":
        iframe.style.top = "20px"
        iframe.style.right = "20px"
        break
      case "top-left":
        iframe.style.top = "20px"
        iframe.style.left = "20px"
        break
      default:
        iframe.style.bottom = "20px"
        iframe.style.right = "20px"
    }

    console.log("[WIDGET-LOADER] Widget iframe creado:", {
      src: iframe.src,
      clienteId: clienteId,
      position: config.position,
    })

    document.body.appendChild(iframe)
  }

  createIframe()
})()
