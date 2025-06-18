;(() => {
  console.log("[WIDGET-LOADER] 🚀 === INICIANDO WIDGET LOADER ===")
  console.log("[WIDGET-LOADER] 📅 Timestamp:", new Date().toISOString())
  console.log("[WIDGET-LOADER] 🌐 URL actual:", window.location.href)
  console.log("[WIDGET-LOADER] 📋 User Agent:", navigator.userAgent)

  const scriptElement = document.currentScript
  console.log("[WIDGET-LOADER] 📜 Script element:", scriptElement)

  // Buscar tanto data-cliente-id como data-client-id para compatibilidad
  const clienteId = scriptElement.getAttribute("data-cliente-id") || scriptElement.getAttribute("data-client-id")
  console.log("[WIDGET-LOADER] 🔍 Atributos del script:")
  console.log("[WIDGET-LOADER] - data-cliente-id:", scriptElement.getAttribute("data-cliente-id"))
  console.log("[WIDGET-LOADER] - data-client-id:", scriptElement.getAttribute("data-client-id"))
  console.log("[WIDGET-LOADER] - clienteId final:", clienteId)

  // Agregar verificación de interferencias
  console.log("[WIDGET-LOADER] 🔍 Verificando interferencias...")
  const existingStyles = document.querySelectorAll("style")
  existingStyles.forEach((style, index) => {
    if (style.textContent.includes("iframe") && style.textContent.includes("widget")) {
      console.warn(`[WIDGET-LOADER] ⚠️ Estilo ${index} puede interferir:`, style.textContent.substring(0, 100))
    }
  })

  const existingScripts = document.querySelectorAll("script")
  existingScripts.forEach((script, index) => {
    if (script.textContent.includes("iframe") && script.textContent.includes("widget")) {
      console.warn(`[WIDGET-LOADER] ⚠️ Script ${index} puede interferir con iframes`)
    }
  })

  if (!clienteId) {
    console.error("[WIDGET-LOADER] ❌ Error: data-cliente-id o data-client-id es requerido")
    console.error("[WIDGET-LOADER] 📋 Todos los atributos disponibles:")
    for (let i = 0; i < scriptElement.attributes.length; i++) {
      const attr = scriptElement.attributes[i]
      console.error(`[WIDGET-LOADER] - ${attr.name}: ${attr.value}`)
    }
    return
  }

  console.log("[WIDGET-LOADER] Cliente ID obtenido:", clienteId)
  console.log("[WIDGET-LOADER] Script URL:", scriptElement.src)

  // Obtener el dominio base del script
  const scriptUrl = new URL(scriptElement.src)
  const baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`

  const config = {
    position: scriptElement.getAttribute("data-position") || "bottom-right",
    widgetUrl: `${baseUrl}/widget`,
  }

  console.log("[WIDGET-LOADER] Configuración:", config)

  let isWidgetVisible = false
  let widgetContainer = null
  let floatingButton = null
  let widgetConfig = null

  // Función para obtener la configuración del widget
  async function fetchWidgetConfig() {
    try {
      console.log("[WIDGET-LOADER] 🔄 Obteniendo configuración del widget...")
      const response = await fetch(`${baseUrl}/api/widget?cliente_id=${encodeURIComponent(clienteId)}`)

      if (!response.ok) {
        console.warn("[WIDGET-LOADER] ⚠️ No se pudo obtener la configuración:", response.status)
        return null
      }

      const config = await response.json()
      console.log("[WIDGET-LOADER] ✅ Configuración obtenida:", {
        displayName: config.displayName,
        widgetFloatingButtonText: config.widgetFloatingButtonText,
        widgetEnabled: config.widgetEnabled,
      })

      return config
    } catch (error) {
      console.warn("[WIDGET-LOADER] ⚠️ Error obteniendo configuración:", error)
      return null
    }
  }

  function createFloatingButton(buttonText = "Obtené tu turno con nuestro asistente virtual") {
    // Verificar si ya existe
    if (document.getElementById("chat-widget-button")) {
      console.log("[WIDGET-LOADER] Botón ya existe")
      return document.getElementById("chat-widget-button")
    }

    const button = document.createElement("div")
    button.id = "chat-widget-button"
    button.style.cssText = `
  position: fixed;
  z-index: 9998;
  min-height: 56px;
  padding: 12px 24px;
  border-radius: 28px;
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  cursor: pointer;
  box-shadow: 0 8px 32px rgba(14, 165, 233, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  ${config.position === "bottom-left" ? "left: 20px;" : "right: 20px;"}
  bottom: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: white;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  max-width: 340px;
  border: 0;
  outline: none;
  text-decoration: none;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
`

    // Contenido del botón con icono y texto personalizado
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="flex-shrink: 0;">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
      </svg>
      <span>${buttonText}</span>
    `

    button.addEventListener("click", toggleWidget)
    button.addEventListener("mouseenter", () => {
      button.style.transform = "translateY(-2px) scale(1.02)"
      button.style.boxShadow = "0 12px 40px rgba(14, 165, 233, 0.4)"
    })
    button.addEventListener("mouseleave", () => {
      button.style.transform = "translateY(0) scale(1)"
      button.style.boxShadow = "0 8px 32px rgba(14, 165, 233, 0.3)"
    })

    document.body.appendChild(button)
    console.log("[WIDGET-LOADER] Botón flotante creado con texto:", buttonText)
    return button
  }

  function createWidget() {
    // Verificar si ya existe
    if (document.getElementById("chat-widget-container")) {
      console.log("[WIDGET-LOADER] Container ya existe")
      return document.getElementById("chat-widget-container")
    }

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

    // URL del widget con parámetros correctos
    const widgetUrl = `${config.widgetUrl}?clienteId=${encodeURIComponent(clienteId)}&position=${encodeURIComponent(config.position)}&embedded=true`
    iframe.src = widgetUrl

    console.log("[WIDGET-LOADER] URL del iframe:", widgetUrl)

    // Timeout para detectar problemas de carga
    const loadTimeout = setTimeout(() => {
      console.error("[WIDGET-LOADER] ⏰ Timeout: Widget tardó más de 10 segundos en cargar")
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666; height: 100%; display: flex; flex-direction: column; justify-content: center; font-family: Arial, sans-serif;">
          <p style="margin-bottom: 10px; font-size: 14px;">⏰ Timeout cargando el chat</p>
          <p style="font-size: 12px; color: #999;">El widget tardó demasiado en cargar</p>
          <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer;">Reintentar</button>
        </div>
      `
    }, 10000)

    // Manejar carga exitosa
    iframe.onload = () => {
      clearTimeout(loadTimeout)
      console.log("[WIDGET-LOADER] ✅ Widget cargado exitosamente")
    }

    // Manejar errores de carga
    iframe.onerror = (error) => {
      clearTimeout(loadTimeout)
      console.error("[WIDGET-LOADER] ❌ Error cargando el widget:", error)
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666; height: 100%; display: flex; flex-direction: column; justify-content: center; font-family: Arial, sans-serif;">
          <p style="margin-bottom: 10px; font-size: 14px;">❌ Error cargando el chat</p>
          <p style="font-size: 12px; color: #999;">Intenta recargar la página</p>
          <p style="font-size: 10px; color: #ccc; margin-top: 10px;">ID: ${clienteId}</p>
          <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer;">Reintentar</button>
        </div>
      `
    }

    container.appendChild(iframe)
    document.body.appendChild(container)

    console.log("[WIDGET-LOADER] Widget container creado")
    return container
  }

  function toggleWidget() {
    console.log("[WIDGET-LOADER] Toggle widget, visible:", isWidgetVisible)

    if (!widgetContainer) {
      widgetContainer = createWidget()
    }

    if (isWidgetVisible) {
      widgetContainer.style.display = "none"
      isWidgetVisible = false
      console.log("[WIDGET-LOADER] Widget ocultado")
    } else {
      widgetContainer.style.display = "block"
      isWidgetVisible = true
      console.log("[WIDGET-LOADER] Widget mostrado")
    }
  }

  async function initWidget() {
    try {
      console.log("[WIDGET-LOADER] Inicializando widget...")

      // Obtener configuración del servidor
      widgetConfig = await fetchWidgetConfig()

      // Verificar si el widget está habilitado
      if (widgetConfig && widgetConfig.widgetEnabled === false) {
        console.log("[WIDGET-LOADER] ⚠️ Widget deshabilitado en la configuración")
        return
      }

      // Usar el texto personalizado o el por defecto
      const buttonText = widgetConfig?.widgetFloatingButtonText || "Obtené tu turno con nuestro asistente virtual"

      floatingButton = createFloatingButton(buttonText)
      console.log("[WIDGET-LOADER] ✅ Widget inicializado correctamente")
    } catch (error) {
      console.error("[WIDGET-LOADER] ❌ Error inicializando widget:", error)
      // En caso de error, crear el botón con texto por defecto
      floatingButton = createFloatingButton("Obtené tu turno con nuestro asistente virtual")
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget)
  } else {
    initWidget()
  }
})()
