import type { WhatsAppConfig } from "@/lib/types"

/**
 * Convierte lo que sea que haya escrito la persona en un hostname pelado.
 *
 * ── Por qué esto importa más de lo que parece (24/9/2026) ──────────────────
 *
 * Antes esta función sólo bajaba a minúsculas y sacaba "www.". Alcanzaba
 * mientras el chequeo tenía escapes: un dominio mal escrito no matcheaba, pero
 * el widget andaba igual porque el campo vacío o la falta de Referer dejaban
 * pasar.
 *
 * Al cerrar esos escapes, un dominio mal escrito pasó a ser la diferencia
 * entre que el widget funcione y un 403. Y la forma más natural de escribirlo
 * —copiar la URL del navegador, "https://clinica.com/"— no matcheaba nada,
 * porque se comparaba el texto completo contra el hostname del Origin. El
 * campo decía lo correcto y el widget no andaba.
 *
 * Así que acá se acepta cualquiera de estas formas y todas dan "clinica.com":
 *
 *   clinica.com · www.clinica.com · https://clinica.com
 *   https://www.clinica.com/turnos · clinica.com:443 · CLINICA.COM
 *
 * Es deliberado ser generoso: el campo lo completa una persona mirando la
 * barra del navegador, no un programador leyendo una especificación.
 */
function normalizeHost(host: string): string {
  let valor = String(host || "").trim().toLowerCase()
  if (!valor) return ""

  // Esquema, con o sin "//": https://, http://, //clinica.com
  valor = valor.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "")

  // Usuario:clave@ — raro, pero si alguien pegó una URL completa está ahí.
  valor = valor.replace(/^[^/@]*@/, "")

  // Todo lo que venga después del host: path, query o fragmento.
  valor = valor.split(/[/?#]/)[0]

  // Puerto.
  valor = valor.split(":")[0]

  // Punto final del FQDN ("clinica.com.") y el "www." de siempre.
  valor = valor.replace(/\.$/, "").replace(/^www\./, "")

  return valor
}

/** Se exporta sólo para los tests: es donde se cuelan los errores de tipeo. */
export { normalizeHost as normalizarDominio }

function extractHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Valida que la solicitud a un endpoint de widget venga de un dominio
 * autorizado para ese cliente.
 *
 * Nota de alcance: esto se basa en los headers Origin/Referer, que un
 * atacante que llame directo a la API (curl, script) puede falsificar. No es
 * una defensa infalible tipo CSRF — es una barrera contra el uso casual/
 * automatizado del widget desde sitios no autorizados (scraping, clonado del
 * embed, reutilización del cliente_id de otra clínica). La defensa real
 * contra el embebido no autorizado es `frame-ancestors` (ver middleware.ts):
 * ese lo hace cumplir el navegador y no se falsifica desde el sitio que
 * embebe.
 *
 * ── Se cierra por defecto (24/9/2026) ──────────────────────────────────────
 *
 * Hasta hoy esta función dejaba pasar en dos casos: cuando el cliente no tenía
 * dominios cargados, y cuando la petición no traía ni Origin ni Referer. Los
 * dos eran agujeros por donde entraba exactamente lo que se quería evitar:
 * sin dominios cargados el widget funcionaba en cualquier sitio, y para
 * saltearse el chequeo alcanzaba con no mandar Referer.
 *
 * Ahora los dos casos rechazan. El costo es real y conviene tenerlo presente:
 *
 *  - Un cliente sin "Dominios permitidos" cargado se queda sin widget hasta
 *    que alguien complete el campo. Es una decisión consciente: el objetivo es
 *    que nadie use el widget sin permiso, y "sin permiso" incluye "todavía no
 *    dijimos quién tiene permiso".
 *  - Un visitante cuyo navegador o proxy omite el Referer tampoco va a poder
 *    usarlo. No es frecuente, pero pasa, y es invisible: para esa persona el
 *    widget simplemente no anda.
 *
 * Se mantiene la excepción de same-origin: así se sigue probando el widget
 * desde /demo y desde el dashboard, que no es el escenario que se restringe.
 */
export function isWidgetOriginAllowed(config: Pick<WhatsAppConfig, "widgetAllowedDomains">, request: Request): boolean {
  const originHeader = request.headers.get("origin")
  const refererHeader = request.headers.get("referer")
  const sourceUrl = originHeader || refererHeader
  const host = sourceUrl ? extractHost(sourceUrl) : null

  // Same-origin primero, y antes de mirar los dominios: si no, un cliente sin
  // el campo cargado tampoco podría probar su widget desde nuestro propio
  // dashboard, y no habría forma de darse cuenta de qué falta.
  const ownHost = extractHost(request.url)
  if (host && ownHost && normalizeHost(host) === normalizeHost(ownHost)) return true

  const allowedRaw = config.widgetAllowedDomains?.trim()
  if (!allowedRaw) return false

  const allowedHosts = allowedRaw
    .split(",")
    .map((d) => normalizeHost(d))
    .filter(Boolean)
  if (allowedHosts.length === 0) return false

  // Sin Origin ni Referer no se puede verificar de dónde viene. Antes eso
  // alcanzaba para pasar.
  if (!host) return false

  // Un dominio declarado cubre sus subdominios: quien carga "clinica.com" no
  // debería tener que acordarse también de "turnos.clinica.com".
  const normalizado = normalizeHost(host)
  return allowedHosts.some((permitido) => normalizado === permitido || normalizado.endsWith(`.${permitido}`))
}
