/**
 * Widget de Notificaciones Embebible
 * 
 * Un icono de campana con badge que muestra notificaciones en tiempo real
 * de conversaciones pendientes y activas para el Panel de Atencion al Paciente.
 * 
 * USO:
 * <script>
 *   window.NotificationWidgetConfig = {
 *     ssoToken: 'TOKEN_SSO_AQUI',
 *     baseUrl: 'https://tu-dominio.vercel.app',
 *     panelUrl: 'whatsapp.php',
 *     position: 'manual',
 *     containerId: 'notification-widget-container',
 *     theme: 'light',
 *     iconColor: '#ffffff',      // opcional: color del ícono (pisa el del tema)
 *     iconHoverColor: '#ffffff'  // opcional: color del ícono en hover
 *   };
 * </script>
 * <script src="https://tu-dominio.vercel.app/notification-widget-loader.js"></script>
 */
(function() {
  "use strict";
  
  console.log("[NOTIFICATION-WIDGET] ========================================");
  console.log("[NOTIFICATION-WIDGET] SCRIPT CARGADO - v2.3 (iconColor configurable)");
  console.log("[NOTIFICATION-WIDGET] Timestamp: " + new Date().toISOString());
  console.log("[NOTIFICATION-WIDGET] ========================================");

  // Verificar si ya se inicializo
  if (window._notificationWidgetInitialized) {
    console.log("[NOTIFICATION-WIDGET] Widget ya inicializado, saliendo...");
    return;
  }

  // Obtener configuracion global
  var config = window.NotificationWidgetConfig || {};
  
  console.log("[NOTIFICATION-WIDGET] Config encontrada:", config);
  
  // Obtener base URL del script element si no esta configurada
  if (!config.baseUrl) {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (src.indexOf("notification-widget-loader.js") !== -1) {
        try {
          var url = new URL(src);
          config.baseUrl = url.protocol + "//" + url.host;
          console.log("[NOTIFICATION-WIDGET] baseUrl detectado desde script src: " + config.baseUrl);
        } catch (e) {
          console.error("[NOTIFICATION-WIDGET] Error parseando URL del script:", e);
        }
        break;
      }
    }
  }

  console.log("[NOTIFICATION-WIDGET] Configuracion final:", {
    hasToken: !!config.ssoToken,
    tokenLength: config.ssoToken ? config.ssoToken.length : 0,
    baseUrl: config.baseUrl,
    panelUrl: config.panelUrl,
    position: config.position,
    containerId: config.containerId,
    theme: config.theme
  });

  // Validar configuracion requerida
  if (!config.ssoToken) {
    console.error("[NOTIFICATION-WIDGET] ERROR: ssoToken es requerido");
    console.error("[NOTIFICATION-WIDGET] Asegurate de que window.NotificationWidgetConfig.ssoToken este definido ANTES de cargar este script");
    return;
  }

  if (!config.baseUrl) {
    console.error("[NOTIFICATION-WIDGET] ERROR: No se pudo determinar baseUrl");
    return;
  }

  // Marcar como inicializado
  window._notificationWidgetInitialized = true;

  // Estado del widget
  var state = {
    pendingCount: 0,
    activeCount: 0,
    total: 0,
    connected: false,
    eventSource: null,
    lastUpdate: null
  };

  // Colores por tema
  var themes = {
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
  };

  var colors = themes[config.theme] || themes.light;

  // Overrides opcionales de color del ícono (para que combine con la barra del
  // sistema anfitrión sin depender de los temas predefinidos)
  colors = Object.assign({}, colors);

  // En modo manual/inline el widget vive dentro de la barra del sistema anfitrión
  // (fondo oscuro): por defecto usar el gris claro de los íconos vecinos (#d5d5d5).
  // Se puede pisar con config.iconColor.
  if (config.position === "manual" && !config.iconColor) {
    config.iconColor = "#d5d5d5";
  }

  if (config.iconColor) {
    colors.iconColor = config.iconColor;
    // Si no se especifica hover, usar el mismo color para no "saltar" a un gris del tema
    colors.iconHover = config.iconHoverColor || config.iconColor;
  }
  if (config.iconHoverColor) {
    colors.iconHover = config.iconHoverColor;
  }

  // Crear estilos
  function injectStyles() {
    var styleId = "notification-widget-styles";
    if (document.getElementById(styleId)) return;

    var style = document.createElement("style");
    style.id = styleId;
    style.textContent = "\
      @keyframes notification-widget-pulse {\
        0%, 100% { transform: scale(1); }\
        50% { transform: scale(1.1); }\
      }\
      \
      @keyframes notification-widget-shake {\
        0%, 100% { transform: rotate(0deg); }\
        25% { transform: rotate(-10deg); }\
        75% { transform: rotate(10deg); }\
      }\
      \
      @keyframes notification-widget-fade-in {\
        from { opacity: 0; transform: scale(0.8); }\
        to { opacity: 1; transform: scale(1); }\
      }\
      \
      #notification-widget-container.nw-fixed {\
        position: fixed;\
        z-index: 99999;\
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;\
        animation: notification-widget-fade-in 0.3s ease-out;\
      }\
      \
      #notification-widget-button {\
        position: relative;\
        width: 48px;\
        height: 48px;\
        border-radius: 50%;\
        background: " + colors.background + ";\
        border: 1px solid " + colors.border + ";\
        box-shadow: " + colors.shadow + ";\
        cursor: pointer;\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        transition: all 0.2s ease;\
        padding: 0;\
        margin: 0;\
      }\
      \
      #notification-widget-button.nw-inline {\
        width: 32px;\
        height: 32px;\
        box-shadow: none;\
        border: none;\
        background: transparent;\
      }\
      \
      #notification-widget-button.nw-inline svg {\
        width: 20px;\
        height: 20px;\
      }\
      \
      #notification-widget-button.nw-inline #notification-widget-badge {\
        top: -6px;\
        right: -6px;\
        min-width: 16px;\
        height: 16px;\
        font-size: 10px;\
        padding: 0 4px;\
      }\
      \
      #notification-widget-button.nw-inline #notification-widget-status {\
        width: 8px;\
        height: 8px;\
        bottom: 0px;\
        right: 0px;\
        border-width: 1px;\
      }\
      \
      #notification-widget-button.nw-inline #notification-widget-tooltip {\
        bottom: auto;\
        top: 100%;\
        margin-bottom: 0;\
        margin-top: 8px;\
      }\
      \
      #notification-widget-button.nw-inline #notification-widget-tooltip::after {\
        top: auto;\
        bottom: 100%;\
        border-top-color: transparent;\
        border-bottom-color: " + colors.border + ";\
      }\
      \
      #notification-widget-button:hover {\
        transform: scale(1.05);\
      }\
      \
      #notification-widget-button:hover svg {\
        color: " + colors.iconHover + ";\
      }\
      \
      #notification-widget-button svg {\
        width: 24px;\
        height: 24px;\
        color: " + colors.iconColor + ";\
        transition: color 0.2s ease;\
      }\
      \
      #notification-widget-button.has-notifications svg {\
        animation: notification-widget-shake 0.5s ease-in-out;\
      }\
      \
      #notification-widget-badge {\
        position: absolute;\
        top: -4px;\
        right: -4px;\
        min-width: 20px;\
        height: 20px;\
        padding: 0 6px;\
        border-radius: 10px;\
        background: " + colors.badgeBg + ";\
        color: " + colors.badgeText + ";\
        font-size: 12px;\
        font-weight: 600;\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.4);\
        animation: notification-widget-pulse 2s infinite;\
      }\
      \
      #notification-widget-badge.hidden {\
        display: none;\
      }\
      \
      #notification-widget-tooltip {\
        position: absolute;\
        bottom: 100%;\
        left: 50%;\
        transform: translateX(-50%);\
        margin-bottom: 8px;\
        padding: 8px 12px;\
        background: " + colors.background + ";\
        border: 1px solid " + colors.border + ";\
        border-radius: 8px;\
        box-shadow: " + colors.shadow + ";\
        white-space: nowrap;\
        font-size: 13px;\
        color: " + colors.text + ";\
        opacity: 0;\
        visibility: hidden;\
        transition: all 0.2s ease;\
        pointer-events: none;\
      }\
      \
      #notification-widget-button:hover #notification-widget-tooltip {\
        opacity: 1;\
        visibility: visible;\
      }\
      \
      #notification-widget-tooltip::after {\
        content: '';\
        position: absolute;\
        top: 100%;\
        left: 50%;\
        transform: translateX(-50%);\
        border: 6px solid transparent;\
        border-top-color: " + colors.border + ";\
      }\
      \
      #notification-widget-status {\
        position: absolute;\
        bottom: 2px;\
        right: 2px;\
        width: 10px;\
        height: 10px;\
        border-radius: 50%;\
        background: #9ca3af;\
        border: 2px solid " + colors.background + ";\
      }\
      \
      #notification-widget-status.connected {\
        background: #22c55e;\
      }\
      \
      #notification-widget-status.disconnected {\
        background: #ef4444;\
      }\
    ";
    document.head.appendChild(style);
    console.log("[NOTIFICATION-WIDGET] Estilos inyectados");
  }

  // Crear el widget
  function createWidget() {
    var customContainerId = config.containerId;
    var defaultContainerId = "notification-widget-container";
    var isManualPosition = config.position === "manual";
    
    var container = null;
    
    console.log("[NOTIFICATION-WIDGET] Creando widget...");
    console.log("[NOTIFICATION-WIDGET] - customContainerId: " + customContainerId);
    console.log("[NOTIFICATION-WIDGET] - isManualPosition: " + isManualPosition);
    
    // Modo manual: usar contenedor existente proporcionado por el usuario
    if (isManualPosition && customContainerId) {
      container = document.getElementById(customContainerId);
      console.log("[NOTIFICATION-WIDGET] Buscando contenedor: #" + customContainerId);
      console.log("[NOTIFICATION-WIDGET] Contenedor encontrado: " + (container ? "SI" : "NO"));
      
      if (container) {
        console.log("[NOTIFICATION-WIDGET] Usando contenedor existente: " + customContainerId);
        // Verificar si ya tiene el boton renderizado
        if (container.querySelector("#notification-widget-button")) {
          console.log("[NOTIFICATION-WIDGET] Widget ya renderizado en contenedor");
          return container;
        }
        // Limpiar contenedor y renderizar widget
        container.innerHTML = "";
      } else {
        console.error("[NOTIFICATION-WIDGET] No se encontro contenedor con id: " + customContainerId);
        console.log("[NOTIFICATION-WIDGET] Creando contenedor flotante como fallback");
        isManualPosition = false;
      }
    }
    
    // Modo fijo: crear contenedor con position fixed
    if (!container) {
      // Verificar si ya existe
      var existingContainer = document.getElementById(defaultContainerId);
      if (existingContainer) {
        if (existingContainer.querySelector("#notification-widget-button")) {
          console.log("[NOTIFICATION-WIDGET] Widget ya existe");
          return existingContainer;
        }
        container = existingContainer;
      } else {
        container = document.createElement("div");
        container.id = defaultContainerId;
        container.className = "nw-fixed";

        // Posicionamiento fijo
        var positions = {
          "top-right": "top: 20px; right: 20px;",
          "top-left": "top: 20px; left: 20px;",
          "bottom-right": "bottom: 20px; right: 20px;",
          "bottom-left": "bottom: 20px; left: 20px;"
        };
        container.style.cssText = positions[config.position] || positions["top-right"];
        document.body.appendChild(container);
      }
    }

    // Renderizar el boton del widget
    var inlineClass = isManualPosition ? "nw-inline" : "";
    var tooltipHTML = config.showTooltip !== false ? '\
        <div id="notification-widget-tooltip">\
          <div>Pendientes: <strong id="tooltip-pending">0</strong></div>\
          <div>Mis activas: <strong id="tooltip-active">0</strong></div>\
        </div>\
    ' : '';
    
    var buttonHTML = '\
      <button id="notification-widget-button" class="' + inlineClass + '" type="button" aria-label="Notificaciones de atencion al paciente">\
        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">\
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.142 1.595 5.945L0 24l6.335-1.652a11.899 11.899 0 005.71 1.454h.005c6.582 0 11.943-5.359 11.945-11.892a11.821 11.821 0 00-3.495-8.411" />\
        </svg>\
        <span id="notification-widget-badge" class="hidden">0</span>\
        <span id="notification-widget-status" title="Desconectado"></span>\
        ' + tooltipHTML + '\
      </button>\
    ';
    
    container.innerHTML = buttonHTML;

    // Event listener para click
    var button = container.querySelector("#notification-widget-button");
    if (button) {
      button.addEventListener("click", handleWidgetClick);
    }

    console.log("[NOTIFICATION-WIDGET] Widget creado en posicion: " + config.position + (isManualPosition ? " (contenedor manual)" : " (fijo)"));
    return container;
  }

  // Manejar click en el widget
  function handleWidgetClick() {
    console.log("[NOTIFICATION-WIDGET] Click detectado");

    // Si hay panelUrl configurada (sin iframe), redirigir a esa pagina
    if (config.panelUrl) {
      console.log("[NOTIFICATION-WIDGET] Redirigiendo a: " + config.panelUrl);
      window.location.href = config.panelUrl;
      return;
    }

    // Buscar el iframe del panel
    var iframe = config.panelIframeSelector ? document.querySelector(config.panelIframeSelector) : null;
    
    if (iframe) {
      // Construir URL con token SSO
      var panelUrl = config.panelUrlBase + "?sso_token=" + encodeURIComponent(config.ssoToken);
      console.log("[NOTIFICATION-WIDGET] Actualizando iframe a: " + panelUrl);
      iframe.src = panelUrl;
      
      // Opcional: hacer visible el iframe si esta oculto
      if (iframe.style.display === "none") {
        iframe.style.display = "block";
      }
    } else {
      console.warn("[NOTIFICATION-WIDGET] No se encontro iframe, abriendo en nueva ventana");
      var fallbackUrl = (config.panelUrlBase || config.baseUrl + "/support") + "?sso_token=" + encodeURIComponent(config.ssoToken);
      console.log("[NOTIFICATION-WIDGET] Abriendo en nueva ventana: " + fallbackUrl);
      window.open(fallbackUrl, "_blank");
    }
  }

  // Actualizar UI del widget
  function updateUI() {
    var badge = document.getElementById("notification-widget-badge");
    var status = document.getElementById("notification-widget-status");
    var button = document.getElementById("notification-widget-button");
    var tooltipPending = document.getElementById("tooltip-pending");
    var tooltipActive = document.getElementById("tooltip-active");

    if (badge) {
      if (state.total > 0) {
        badge.textContent = state.total > 99 ? "99+" : state.total;
        badge.className = "";
        if (button) {
          button.classList.add("has-notifications");
        }
      } else {
        badge.className = "hidden";
        if (button) {
          button.classList.remove("has-notifications");
        }
      }
    }

    if (status) {
      status.className = state.connected ? "connected" : "disconnected";
      status.title = state.connected ? "Conectado" : "Desconectado";
    }

    if (tooltipPending) {
      tooltipPending.textContent = state.pendingCount;
    }

    if (tooltipActive) {
      tooltipActive.textContent = state.activeCount;
    }
  }

  // Variable para polling
  var pollingInterval = null;

  // Conectar al stream SSE
  function connectSSE() {
    if (state.eventSource) {
      state.eventSource.close();
    }

    var streamUrl = config.baseUrl + "/api/notifications/stream?sso_token=" + encodeURIComponent(config.ssoToken);
    console.log("[NOTIFICATION-WIDGET] Conectando a SSE: " + streamUrl);

    try {
      state.eventSource = new EventSource(streamUrl);

      state.eventSource.onopen = function() {
        console.log("[NOTIFICATION-WIDGET] SSE conectado");
        state.connected = true;
        updateUI();
      };

      state.eventSource.onmessage = function(event) {
        try {
          var data = JSON.parse(event.data);
          console.log("[NOTIFICATION-WIDGET] Datos recibidos:", data);

          var oldTotal = state.total;

          state.pendingCount = data.pending_count || 0;
          state.activeCount = data.active_count || 0;
          state.total = data.total || 0;
          state.lastUpdate = data.timestamp;

          // Si aumentaron las notificaciones, triggear animacion
          if (state.total > oldTotal) {
            triggerNewNotificationAnimation();
          }

          updateUI();
        } catch (error) {
          console.error("[NOTIFICATION-WIDGET] Error parseando datos SSE:", error);
        }
      };

      state.eventSource.onerror = function(error) {
        console.error("[NOTIFICATION-WIDGET] Error SSE:", error);
        state.connected = false;
        updateUI();

        // Reconectar despues de 5 segundos
        setTimeout(function() {
          console.log("[NOTIFICATION-WIDGET] Intentando reconectar...");
          connectSSE();
        }, 5000);
      };
    } catch (error) {
      console.error("[NOTIFICATION-WIDGET] Error creando EventSource:", error);
      state.connected = false;
      updateUI();

      // Fallback a polling si SSE no funciona
      console.log("[NOTIFICATION-WIDGET] Usando fallback de polling");
      startPolling();
    }
  }

  // Animacion de nueva notificacion
  function triggerNewNotificationAnimation() {
    var button = document.getElementById("notification-widget-button");
    if (button) {
      button.classList.remove("has-notifications");
      // Force reflow
      void button.offsetWidth;
      button.classList.add("has-notifications");
    }
  }

  // Fallback: Polling si SSE no funciona
  function startPolling() {
    if (pollingInterval) return;

    console.log("[NOTIFICATION-WIDGET] Iniciando polling cada 15 segundos");

    function poll() {
      var statusUrl = config.baseUrl + "/api/notifications/status?sso_token=" + encodeURIComponent(config.ssoToken);
      
      var xhr = new XMLHttpRequest();
      xhr.open("GET", statusUrl, true);
      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) {
            try {
              var data = JSON.parse(xhr.responseText);
              if (data.success) {
                var oldTotal = state.total;

                state.pendingCount = data.pending_count || 0;
                state.activeCount = data.active_count || 0;
                state.total = data.total || 0;
                state.connected = true;
                state.lastUpdate = data.timestamp;

                if (state.total > oldTotal) {
                  triggerNewNotificationAnimation();
                }

                updateUI();
              }
            } catch (e) {
              console.error("[NOTIFICATION-WIDGET] Error parseando respuesta polling:", e);
            }
          } else {
            state.connected = false;
            updateUI();
          }
        }
      };
      xhr.onerror = function() {
        console.error("[NOTIFICATION-WIDGET] Error en polling");
        state.connected = false;
        updateUI();
      };
      xhr.send();
    }

    // Poll inmediatamente y luego cada 15 segundos
    poll();
    pollingInterval = setInterval(poll, 15000);
  }

  // Inicializar widget
  function init() {
    console.log("[NOTIFICATION-WIDGET] Inicializando...");
    console.log("[NOTIFICATION-WIDGET] document.readyState: " + document.readyState);

    // Inyectar estilos
    injectStyles();

    // Crear widget
    createWidget();

    // Conectar a SSE (o fallback a polling)
    connectSSE();

    console.log("[NOTIFICATION-WIDGET] Widget inicializado correctamente");
  }

  // Exponer API publica
  window.NotificationWidget = {
    getState: function() { 
      return {
        pendingCount: state.pendingCount,
        activeCount: state.activeCount,
        total: state.total,
        connected: state.connected,
        lastUpdate: state.lastUpdate
      };
    },
    refresh: function() {
      if (state.eventSource) {
        state.eventSource.close();
      }
      connectSSE();
    },
    destroy: function() {
      if (state.eventSource) {
        state.eventSource.close();
      }
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
      var container = document.getElementById("notification-widget-container");
      if (container) {
        container.parentNode.removeChild(container);
      }
      var styles = document.getElementById("notification-widget-styles");
      if (styles) {
        styles.parentNode.removeChild(styles);
      }
      window._notificationWidgetInitialized = false;
    }
  };

  // Inicializar cuando el DOM este listo
  if (document.readyState === "loading") {
    console.log("[NOTIFICATION-WIDGET] DOM loading, esperando DOMContentLoaded...");
    document.addEventListener("DOMContentLoaded", init);
  } else {
    console.log("[NOTIFICATION-WIDGET] DOM ya listo, inicializando inmediatamente...");
    init();
  }
})();
