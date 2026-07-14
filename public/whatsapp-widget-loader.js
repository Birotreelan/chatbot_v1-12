;(() => {
  // Widget flotante de WhatsApp (9/7/2026) — hermano del chat (widget-loader.js)
  // pero mucho más simple: no abre un iframe ni tiene estado de abierto/cerrado,
  // sólo es un botón (pill, icono + texto, igual que el del chat) que lleva
  // directo a wa.me con un mensaje predefinido dirigido a Iris. Se ancla a la
  // esquina inferior IZQUIERDA (el chat usa la derecha) para poder convivir
  // con él en el mismo sitio sin superponerse.
  console.log("[WHATSAPP-WIDGET-LOADER] Iniciando...")

  const scriptElement = document.currentScript
  const clienteId = scriptElement.getAttribute("data-cliente-id") || scriptElement.getAttribute("data-client-id")

  if (!clienteId) {
    console.error("[WHATSAPP-WIDGET-LOADER] Error: data-cliente-id o data-client-id es requerido")
    return
  }

  const scriptUrl = new URL(scriptElement.src)
  const baseUrl = `${scriptUrl.protocol}//${scriptUrl.host}`

  // Mensaje predefinido que llega ya escrito en WhatsApp al tocar el botón,
  // personalizado con el nombre de la clínica. Sin emoji: llegaba a destino
  // como un carácter no reconocible ("�") en algunos sistemas.
  function buildPresetMessage(clinicName) {
    const clinicLabel = clinicName ? clinicName : "la cl\u00EDnica"
    return `\u00A1Hola ${clinicLabel}! Quiero agendar un turno.`
  }

  function buildWhatsAppUrl(digits, clinicName) {
    return `https://wa.me/${digits}?text=${encodeURIComponent(buildPresetMessage(clinicName))}`
  }

  function injectStyles() {
    if (document.getElementById("iris-whatsapp-widget-styles")) return

    const style = document.createElement("style")
    style.id = "iris-whatsapp-widget-styles"
    style.textContent = `
      #iris-whatsapp-widget-button {
        position: fixed;
        z-index: 9997;
        left: 20px;
        bottom: 20px;
        min-height: 56px;
        max-width: 320px;
        padding: 10px 18px 10px 10px;
        border-radius: 28px;
        background: linear-gradient(135deg, #25D366, #128C7E);
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 32px rgba(18, 140, 126, 0.35);
        cursor: pointer;
        text-decoration: none;
        -webkit-tap-highlight-color: transparent;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #iris-whatsapp-widget-button:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 12px 40px rgba(18, 140, 126, 0.45);
      }
      #iris-whatsapp-widget-icon {
        position: relative;
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #iris-whatsapp-widget-icon svg.iris-wa-icon {
        width: 20px;
        height: 20px;
        fill: white;
      }
      #iris-whatsapp-widget-badge {
        position: absolute;
        bottom: -3px;
        right: -3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #0284c7;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #iris-whatsapp-widget-badge svg {
        width: 9px;
        height: 9px;
      }
      #iris-whatsapp-widget-text {
        color: white;
        font-size: 13px;
        line-height: 1.3;
        font-weight: 500;
      }
      @media (max-width: 767px) {
        #iris-whatsapp-widget-button {
          left: 16px;
          bottom: 16px;
          max-width: calc(100vw - 90px);
        }
      }
    `
    document.head.appendChild(style)
  }

  function createButton(digits, clinicName) {
    if (document.getElementById("iris-whatsapp-widget-button")) {
      console.log("[WHATSAPP-WIDGET-LOADER] El botón ya existe")
      return
    }

    injectStyles()

    const link = document.createElement("a")
    link.id = "iris-whatsapp-widget-button"
    link.href = buildWhatsAppUrl(digits, clinicName)
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.setAttribute("aria-label", "Hablar con Iris por WhatsApp")
    link.title = "Hablar con Iris por WhatsApp"

    // Ícono de WhatsApp (mismo path que components/support/support-nav.tsx y
    // components/dashboard/whatsapp-cta-preview.tsx, para consistencia visual)
    // + insignia de robot marcando que del otro lado responde un asistente de IA.
    // Estático y seguro de insertar por innerHTML (no depende de datos externos).
    const iconWrapper = document.createElement("div")
    iconWrapper.id = "iris-whatsapp-widget-icon"
    iconWrapper.innerHTML = `
      <svg class="iris-wa-icon" viewBox="0 0 24 24" fill="white">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a11.899 11.899 0 005.71 1.454h.005c6.582 0 11.943-5.359 11.945-11.892a11.821 11.821 0 00-3.495-8.411"/>
      </svg>
      <span id="iris-whatsapp-widget-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 8V4H8"/>
          <rect x="4" y="8" width="16" height="12" rx="2"/>
          <path d="M2 14h2"/>
          <path d="M20 14h2"/>
          <path d="M15 13v2"/>
          <path d="M9 13v2"/>
        </svg>
      </span>
    `

    // El texto sí depende de un dato externo (nombre de la clínica) — se arma
    // con textContent, no con innerHTML, para no quedar expuestos a que un
    // displayName con caracteres raros rompa el HTML del sitio que lo aloja.
    const textEl = document.createElement("span")
    textEl.id = "iris-whatsapp-widget-text"
    textEl.textContent = "Solicitar turno por Whatsapp"

    link.appendChild(iconWrapper)
    link.appendChild(textEl)
    document.body.appendChild(link)
    console.log("[WHATSAPP-WIDGET-LOADER] Botón de WhatsApp creado")
  }

  async function init() {
    try {
      const timestamp = Date.now()
      const url = `${baseUrl}/api/widget?cliente_id=${encodeURIComponent(clienteId)}&_t=${timestamp}`

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      })

      if (!response.ok) {
        console.warn("[WHATSAPP-WIDGET-LOADER] No se pudo obtener la configuración:", response.status)
        return
      }

      const config = await response.json()
      const digits = (config.whatsappNumber || "").replace(/\D/g, "")

      if (!digits) {
        console.warn("[WHATSAPP-WIDGET-LOADER] La clínica no tiene un número de WhatsApp configurado, no se muestra el botón")
        return
      }

      createButton(digits, config.displayName)
    } catch (error) {
      console.error("[WHATSAPP-WIDGET-LOADER] Error inicializando el widget:", error)
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
