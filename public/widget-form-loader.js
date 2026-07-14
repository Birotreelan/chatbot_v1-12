;(() => {
  // Widget de FORMULARIO (tercer tipo de widget embebible, 9/7/2026) — hermano
  // de widget-loader.js (el chat). Mismo mecanismo de embebido (botón flotante
  // + iframe, misma lógica de tamaño full-height desktop / pantalla completa
  // mobile, mismo cierre por postMessage), pero el iframe apunta a
  // /widget-form en vez de /widget: ahí se renderiza components/widget-form.tsx,
  // que reemplaza el chat de texto por inputs/selects/botones/datepicker
  // reales, usando el mismo motor de agendamiento por debajo.
  //
  // IDs de elementos DISTINTOS a los del chat (iris-form-widget-* en vez de
  // chat-widget-*) para que una clínica pueda tener los DOS scripts en la
  // misma página sin que se pisen el DOM. Por diseño (14/7/2026, 3ra vuelta):
  // este botón se ancla en bottom: 20px, el mismo costado por defecto que el
  // chat pero en la posición inferior — así queda alineado horizontalmente
  // con el botón de WhatsApp (bottom-left), que también usa bottom: 20px. El
  // botón del chat queda apilado 70px más arriba (bottom: 90px, ver
  // widget-loader.js). Además, abrir uno cierra el otro (evento global
  // "iris-widget-toggle") para que nunca haya dos paneles superpuestos en
  // pantalla al mismo tiempo.
  console.log("[FORM-WIDGET-LOADER] Iniciando...")

  const scriptElement = document.currentScript
  const clienteId = scriptElement.getAttribute("data-cliente-id") || scriptElement.getAttribute("data-client-id")

  if (!clienteId) {
    console.error("[FORM-WIDGET-LOADER] Error: data-cliente-id o data-client-id es requerido")
    return
  }

  const scriptUrl = new URL(scriptElement.src)
  const baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`

  const config = {
    position: scriptElement.getAttribute("data-position") || "bottom-right",
    widgetUrl: `${baseUrl}/widget-form`,
  }

  const BUTTON_TEXT = "Solicitar turno"

  let isWidgetVisible = false
  let widgetContainer = null
  let floatingButton = null

  function createFloatingButton() {
    if (document.getElementById("iris-form-widget-button")) {
      return document.getElementById("iris-form-widget-button")
    }

    const button = document.createElement("div")
    button.id = "iris-form-widget-button"
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

    const textSpan = document.createElement("span")
    textSpan.textContent = BUTTON_TEXT

    // Ícono de calendario (distinto al del chat, para diferenciarlo a simple vista).
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
      </svg>
    `
    button.appendChild(textSpan)

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
    return button
  }

  function injectWidgetStyles() {
    if (document.getElementById("iris-form-widget-styles")) return

    const style = document.createElement("style")
    style.id = "iris-form-widget-styles"
    style.textContent = `
      #iris-form-widget-container {
        position: fixed;
        z-index: 9999;
        bottom: 90px;
        height: 600px; /* valor inicial; el iframe la ajusta por postMessage según su contenido */
        min-height: 600px; /* tamaño estándar (calendario + 2 filas de horarios): nunca achica más que esto */
        max-height: calc(100vh - 110px);
        width: 380px;
        max-width: calc(100vw - 40px);
        border: none;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.25);
        display: none;
        background: white;
        overflow: hidden;
      }

      #iris-form-widget-container iframe {
        width: 100%;
        height: 100%;
        border: none;
        border-radius: 16px;
      }

      @media (max-width: 767px) {
        #iris-form-widget-container {
          top: 0 !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          height: 100vh !important;
          height: 100dvh !important;
          min-height: 0 !important; /* en mobile el tamaño estándar desktop no debe forzar overflow en pantallas bajas */
          border-radius: 0 !important;
          box-shadow: none !important;
        }

        #iris-form-widget-container iframe {
          border-radius: 0 !important;
        }
      }
    `
    document.head.appendChild(style)
  }

  function createWidget() {
    if (document.getElementById("iris-form-widget-container")) {
      return document.getElementById("iris-form-widget-container")
    }

    injectWidgetStyles()

    const container = document.createElement("div")
    container.id = "iris-form-widget-container"
    container.style.cssText = `
      ${config.position === "bottom-left" ? "left: 20px;" : "right: 20px;"}
    `

    const iframe = document.createElement("iframe")
    const timestamp = Date.now()
    // El iframe siempre se renderiza angosto (~380px), tanto en mobile como en
    // desktop, así que Tailwind no puede distinguir los dos modos por su propio
    // ancho (por eso el fix anterior con md: no funcionaba). Quien sí sabe en
    // qué modo está es esta página anfitriona (mismo breakpoint que el media
    // query de abajo), así que se lo pasamos al iframe por query param.
    const layoutMode = window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop"
    const widgetUrl = `${config.widgetUrl}?clienteId=${encodeURIComponent(clienteId)}&embedded=true&mode=${layoutMode}&_t=${timestamp}`
    iframe.src = widgetUrl

    const loadTimeout = setTimeout(() => {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666; height: 100%; display: flex; flex-direction: column; justify-content: center; font-family: Arial, sans-serif;">
          <p style="margin-bottom: 10px; font-size: 14px;">Timeout cargando el formulario</p>
          <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer;">Reintentar</button>
        </div>
      `
    }, 10000)

    iframe.onload = () => clearTimeout(loadTimeout)
    iframe.onerror = () => {
      clearTimeout(loadTimeout)
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666; height: 100%; display: flex; flex-direction: column; justify-content: center; font-family: Arial, sans-serif;">
          <p style="margin-bottom: 10px; font-size: 14px;">Error cargando el formulario</p>
          <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0ea5e9; color: white; border: none; border-radius: 4px; cursor: pointer;">Reintentar</button>
        </div>
      `
    }

    container.appendChild(iframe)
    document.body.appendChild(container)
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
      // Si el chat (u otro widget Iris) está abierto, que se cierre al abrir éste.
      window.dispatchEvent(new CustomEvent("iris-widget-toggle", { detail: { widget: "form", visible: true } }))
    }
  }

  function hideWidget() {
    if (widgetContainer && isWidgetVisible) {
      widgetContainer.style.display = "none"
      isWidgetVisible = false
    }
  }

  // Mismo contrato de postMessage que widget-loader.js — el botón de cerrar
  // dentro del iframe (components/widget-form.tsx) no puede tocar el DOM del
  // padre directamente (otro origen), así que avisa por postMessage.
  window.addEventListener("message", (event) => {
    const data = event.data
    if (data && data.source === "iris-widget" && data.type === "close") {
      hideWidget()
    }
    // El iframe (components/widget-form.tsx) mide su propio contenido y avisa
    // cuánto necesita, así la caja crece/achica según el paso actual (ej. una
    // grilla larga de horarios) en vez de tener un alto fijo con scroll interno.
    // El CSS (#iris-form-widget-container, max-height) ya limita esto a lo que
    // entra en la pantalla; en mobile el media query fuerza 100dvh con
    // !important y esto se ignora.
    if (data && data.source === "iris-form-widget" && data.type === "resize" && widgetContainer) {
      widgetContainer.style.height = `${data.height}px`
    }
  })

  // Exclusión mutua: si se abre otro widget Iris (ej. el chat), cerramos éste.
  window.addEventListener("iris-widget-toggle", (event) => {
    const detail = event.detail
    if (detail && detail.widget !== "form" && detail.visible) {
      hideWidget()
    }
  })

  async function initWidget() {
    try {
      const timestamp = Date.now()
      const url = `${baseUrl}/api/widget?cliente_id=${encodeURIComponent(clienteId)}&_t=${timestamp}`
      const response = await fetch(url, {
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache", Expires: "0" },
      })

      if (response.ok) {
        const widgetConfig = await response.json()
        if (widgetConfig.widgetEnabled === false) {
          console.log("[FORM-WIDGET-LOADER] Widget deshabilitado en la configuración")
          return
        }
      }

      floatingButton = createFloatingButton()
    } catch (error) {
      console.error("[FORM-WIDGET-LOADER] Error inicializando widget:", error)
      // Ante un error de red, igual mostramos el botón — mejor eso que un sitio sin nada.
      floatingButton = createFloatingButton()
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget)
  } else {
    initWidget()
  }
})()
