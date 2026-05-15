/**
 * Widget de Notificaciones Embebible
 * 
 * Un icono de campana con badge que muestra notificaciones en tiempo real
 * de conversaciones pendientes y activas para el Panel de Atención al Paciente.
 * 
 * USO:
 * <script>
 *   window.NotificationWidgetConfig = {
 *     ssoToken: 'TOKEN_SSO_AQUI',
 *     panelIframeSelector: '#support-panel',
 *     panelUrlBase: 'https://tu-dominio.com/support',
 *     position: 'top-right',  // 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
 *     theme: 'light'          // 'light' | 'dark'
 *   };
 * </script>
 * <script src="https://tu-dominio.com/notification-widget-loader.js"></script>
 */
;(() => {
  console.log("[NOTIFICATION-WIDGET] === INICIANDO WIDGET DE NOTIFICACIONES ===")
  console.log("[NOTIFICATION-WIDGET] Timestamp:", new Date().toISOString())

  // Obtener configuración global
  const config = window.NotificationWidgetConfig || {}
  
  // Obtener configuración del script element (alternativa)
  const scriptElement = document.currentScript
  if (scriptElement) {
    config.ssoToken = config.ssoToken || scriptElement.getAttribute("data-sso-token")
    config.panelIframeSelector = config.panelIframeSelector || scriptElement.getAttribute("data-panel-iframe-selector") || "#support-panel"
    config.panelUrlBase = config.panelUrlBase || scriptElement.getAttribute("data-panel-url-base")
    config.position = config.position || scriptElement.getAttribute("data-position") || "top-right"
    config.theme = config.theme || scriptElement.getAttribute("data-theme") || "light"
    
    // Obtener base URL del script
    if (scriptElement.src && !config.panelUrlBase) {
      const scriptUrl = new URL(scriptElement.src)
      config.baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`
      config.panelUrlBase = config.panelUrlBase || `${config.baseUrl}/support`
    }
  }

  console.log("[NOTIFICATION-WIDGET] Configuración:", {
    hasToken: !!config.ssoToken,
    panelIframeSelector: config.panelIframeSelector,
    panelUrlBase: config.panelUrlBase,
    position: config.position,
    theme: config.theme,
    baseUrl: config.baseUrl
  })

  // Validar configuración requerida
  if (!config.ssoToken) {
    console.error("[NOTIFICATION-WIDGET] Error: ssoToken es requerido")
    console.error("[NOTIFICATION-WIDGET] Configura window.NotificationWidgetConfig.ssoToken o usa data-sso-token")
    return
  }

  if (!config.baseUrl && !config.panelUrlBase) {
    console.error("[NOTIFICATION-WIDGET] Error: No se pudo determinar la URL base")
    return
  }

  // Estado del widget
  let state = {
    pendingCount: 0,
    activeCount: 0,
    total: 0,
    connected: false,
    eventSource: null,
    lastUpdate: null
  }

  // Colores por tema
  const themes = {
    light: {
      background: "#ffffff",
      text: "#1f2937",
      border: "#e5e7eb",
      badgeBg: "#ef4444",
      badgeText: "#ffffff",
      iconColor: "#6b7280",
      iconHover: "#374151",
      shadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
    },
    dark: {
      background: "#1f2937",
      text: "#f9fafb",
      border: "#374151",
      badgeBg: "#ef4444",
      badgeText: "#ffffff",
      iconColor: "#9ca3af",
      iconHover: "#f9fafb",
      shadow: "0 4px 12px rgba(0, 0, 0, 0.4)"
    }
  }

  const colors = themes[config.theme] || themes.light

  // Crear estilos
  function injectStyles() {
    const styleId = "notification-widget-styles"
    if (document.getElementById(styleId)) return

    const style = document.createElement("style")
    style.id = styleId
    style.textContent = `
      @keyframes notification-widget-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      
      @keyframes notification-widget-shake {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-10deg); }
        75% { transform: rotate(10deg); }
      }
      
      @keyframes notification-widget-fade-in {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }

      #notification-widget-container {
        position: fixed;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        animation: notification-widget-fade-in 0.3s ease-out;
      }

      #notification-widget-button {
        position: relative;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: ${colors.background};
        border: 1px solid ${colors.border};
        box-shadow: ${colors.shadow};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      #notification-widget-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      }

      #notification-widget-button:hover svg {
        color: ${colors.iconHover};
      }

      #notification-widget-button svg {
        width: 24px;
        height: 24px;
        color: ${colors.iconColor};
        transition: color 0.2s ease;
      }

      #notification-widget-button.has-notifications svg {
        animation: notification-widget-shake 0.5s ease-in-out;
      }

      #notification-widget-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 10px;
        background: ${colors.badgeBg};
        color: ${colors.badgeText};
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.4);
        animation: notification-widget-pulse 2s infinite;
      }

      #notification-widget-badge.hidden {
        display: none;
      }

      #notification-widget-tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        padding: 8px 12px;
        background: ${colors.background};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        box-shadow: ${colors.shadow};
        white-space: nowrap;
        font-size: 13px;
        color: ${colors.text};
        opacity: 0;
        visibility: hidden;
        transition: all 0.2s ease;
        pointer-events: none;
      }

      #notification-widget-button:hover #notification-widget-tooltip {
        opacity: 1;
        visibility: visible;
      }

      #notification-widget-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: ${colors.border};
      }

      #notification-widget-status {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #9ca3af;
        border: 2px solid ${colors.background};
      }

      #notification-widget-status.connected {
        background: #22c55e;
      }

      #notification-widget-status.disconnected {
        background: #ef4444;
      }
    `
    document.head.appendChild(style)
  }

  // Crear el widget
  function createWidget() {
    const containerId = "notification-widget-container"
    if (document.getElementById(containerId)) {
      console.log("[NOTIFICATION-WIDGET] Widget ya existe")
      return document.getElementById(containerId)
    }

    const container = document.createElement("div")
    container.id = containerId

    // Posicionamiento
    const positions = {
      "top-right": "top: 20px; right: 20px;",
      "top-left": "top: 20px; left: 20px;",
      "bottom-right": "bottom: 20px; right: 20px;",
      "bottom-left": "bottom: 20px; left: 20px;"
    }
    container.style.cssText = positions[config.position] || positions["top-right"]

    container.innerHTML = `
      <button id="notification-widget-button" type="button" aria-label="Notificaciones de atención al paciente">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span id="notification-widget-badge" class="hidden">0</span>
        <span id="notification-widget-status" title="Desconectado"></span>
        <div id="notification-widget-tooltip">
          <div>Pendientes: <strong id="tooltip-pending">0</strong></div>
          <div>Mis activas: <strong id="tooltip-active">0</strong></div>
        </div>
      </button>
    `

    document.body.appendChild(container)

    // Event listener para click
    const button = container.querySelector("#notification-widget-button")
    button.addEventListener("click", handleWidgetClick)

    console.log("[NOTIFICATION-WIDGET] Widget creado en posición:", config.position)
    return container
  }

  // Manejar click en el widget
  function handleWidgetClick() {
    console.log("[NOTIFICATION-WIDGET] Click detectado")

    // Buscar el iframe del panel
    const iframe = document.querySelector(config.panelIframeSelector)
    
    if (iframe) {
      // Construir URL con token SSO
      const panelUrl = `${config.panelUrlBase}?sso_token=${encodeURIComponent(config.ssoToken)}`
      console.log("[NOTIFICATION-WIDGET] Actualizando iframe a:", panelUrl)
      iframe.src = panelUrl
      
      // Opcional: hacer visible el iframe si está oculto
      if (iframe.style.display === "none") {
        iframe.style.display = "block"
      }
    } else {
      console.warn("[NOTIFICATION-WIDGET] No se encontró iframe con selector:", config.panelIframeSelector)
      // Fallback: abrir en nueva ventana
      const panelUrl = `${config.panelUrlBase}?sso_token=${encodeURIComponent(config.ssoToken)}`
      console.log("[NOTIFICATION-WIDGET] Abriendo en nueva ventana:", panelUrl)
      window.open(panelUrl, "_blank")
    }
  }

  // Actualizar UI del widget
  function updateUI() {
    const badge = document.getElementById("notification-widget-badge")
    const status = document.getElementById("notification-widget-status")
    const button = document.getElementById("notification-widget-button")
    const tooltipPending = document.getElementById("tooltip-pending")
    const tooltipActive = document.getElementById("tooltip-active")

    if (badge) {
      if (state.total > 0) {
        badge.textContent = state.total > 99 ? "99+" : state.total
        badge.classList.remove("hidden")
        button?.classList.add("has-notifications")
      } else {
        badge.classList.add("hidden")
        button?.classList.remove("has-notifications")
      }
    }

    if (status) {
      status.className = state.connected ? "connected" : "disconnected"
      status.title = state.connected ? "Conectado" : "Desconectado"
    }

    if (tooltipPending) {
      tooltipPending.textContent = state.pendingCount
    }

    if (tooltipActive) {
      tooltipActive.textContent = state.activeCount
    }
  }

  // Conectar al stream SSE
  function connectSSE() {
    if (state.eventSource) {
      state.eventSource.close()
    }

    const streamUrl = `${config.baseUrl}/api/notifications/stream?sso_token=${encodeURIComponent(config.ssoToken)}`
    console.log("[NOTIFICATION-WIDGET] Conectando a SSE:", streamUrl)

    try {
      state.eventSource = new EventSource(streamUrl)

      state.eventSource.onopen = () => {
        console.log("[NOTIFICATION-WIDGET] SSE conectado")
        state.connected = true
        updateUI()
      }

      state.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log("[NOTIFICATION-WIDGET] Datos recibidos:", data)

          const oldTotal = state.total

          state.pendingCount = data.pending_count || 0
          state.activeCount = data.active_count || 0
          state.total = data.total || 0
          state.lastUpdate = data.timestamp

          // Si aumentaron las notificaciones, triggear animación
          if (state.total > oldTotal) {
            triggerNewNotificationAnimation()
          }

          updateUI()
        } catch (error) {
          console.error("[NOTIFICATION-WIDGET] Error parseando datos SSE:", error)
        }
      }

      state.eventSource.onerror = (error) => {
        console.error("[NOTIFICATION-WIDGET] Error SSE:", error)
        state.connected = false
        updateUI()

        // Reconectar después de 5 segundos
        setTimeout(() => {
          console.log("[NOTIFICATION-WIDGET] Intentando reconectar...")
          connectSSE()
        }, 5000)
      }
    } catch (error) {
      console.error("[NOTIFICATION-WIDGET] Error creando EventSource:", error)
      state.connected = false
      updateUI()

      // Fallback a polling si SSE no funciona
      console.log("[NOTIFICATION-WIDGET] Usando fallback de polling")
      startPolling()
    }
  }

  // Animación de nueva notificación
  function triggerNewNotificationAnimation() {
    const button = document.getElementById("notification-widget-button")
    if (button) {
      button.classList.remove("has-notifications")
      // Force reflow
      void button.offsetWidth
      button.classList.add("has-notifications")
    }
  }

  // Fallback: Polling si SSE no funciona
  let pollingInterval = null

  function startPolling() {
    if (pollingInterval) return

    console.log("[NOTIFICATION-WIDGET] Iniciando polling cada 15 segundos")

    const poll = async () => {
      try {
        const statusUrl = `${config.baseUrl}/api/notifications/status?sso_token=${encodeURIComponent(config.ssoToken)}`
        const response = await fetch(statusUrl)
        
        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            const oldTotal = state.total

            state.pendingCount = data.pending_count || 0
            state.activeCount = data.active_count || 0
            state.total = data.total || 0
            state.connected = true
            state.lastUpdate = data.timestamp

            if (state.total > oldTotal) {
              triggerNewNotificationAnimation()
            }

            updateUI()
          }
        } else {
          state.connected = false
          updateUI()
        }
      } catch (error) {
        console.error("[NOTIFICATION-WIDGET] Error en polling:", error)
        state.connected = false
        updateUI()
      }
    }

    // Poll inmediatamente y luego cada 15 segundos
    poll()
    pollingInterval = setInterval(poll, 15000)
  }

  // Inicializar widget
  function init() {
    console.log("[NOTIFICATION-WIDGET] Inicializando...")

    // Inyectar estilos
    injectStyles()

    // Crear widget
    createWidget()

    // Conectar a SSE (o fallback a polling)
    connectSSE()

    console.log("[NOTIFICATION-WIDGET] Widget inicializado correctamente")
  }

  // Exponer API pública
  window.NotificationWidget = {
    getState: () => ({ ...state }),
    refresh: () => {
      if (state.eventSource) {
        state.eventSource.close()
      }
      connectSSE()
    },
    destroy: () => {
      if (state.eventSource) {
        state.eventSource.close()
      }
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
      const container = document.getElementById("notification-widget-container")
      if (container) {
        container.remove()
      }
      const styles = document.getElementById("notification-widget-styles")
      if (styles) {
        styles.remove()
      }
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
