/**
 * Alta de Flows y templates contra la Graph API (21/9/2026).
 *
 * Existe para no tener que entrar a Meta for Developers ni a WhatsApp Manager
 * por cada clínica. Todo esto son llamadas HTTP y ya tenemos `wabaId` y
 * `accessToken` guardados por cliente.
 *
 * ── Criterio de diseño: devolver siempre la respuesta cruda ────────────────
 *
 * Ninguna función interpreta el resultado de Meta ni lo resume. Devuelven el
 * JSON tal cual, con el código HTTP. El motivo es concreto: estamos usando esto
 * justamente para averiguar cosas que la documentación no dice — en qué
 * categoría clasifica Meta un template utility cuando tiene un botón de Flow,
 * qué campos acepta ese botón al crearlo, qué versión de Flow JSON sigue viva.
 *
 * Una función que "normaliza" el error se come exactamente el dato que fuimos a
 * buscar. Que lo lea una persona.
 */

/**
 * Los Flows necesitan v18 o posterior. Se deja en una constante porque Meta da
 * de baja versiones viejas y cuando pase hay que tocar un solo lugar.
 */
const GRAPH = "v21.0"

export interface RespuestaDeMeta {
  ok: boolean
  status: number
  /** El JSON que devolvió Meta, sin tocar. */
  datos: any
}

async function llamar(url: string, init: RequestInit): Promise<RespuestaDeMeta> {
  try {
    const respuesta = await fetch(url, init)
    const texto = await respuesta.text()
    let datos: any
    try {
      datos = JSON.parse(texto)
    } catch {
      // Meta contesta texto plano en algunos errores de infraestructura.
      datos = { respuesta_sin_json: texto }
    }
    return { ok: respuesta.ok, status: respuesta.status, datos }
  } catch (error: any) {
    return { ok: false, status: 0, datos: { error_de_red: error?.message || String(error) } }
  }
}

function auth(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` }
}

/** Lista los Flows que ya existen en el WABA, para no crear duplicados. */
export function listarFlows(wabaId: string, accessToken: string): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${wabaId}/flows?fields=id,name,status,categories`, {
    method: "GET",
    headers: auth(accessToken),
  })
}

/**
 * Crea el Flow vacío. Devuelve el `id`, que es lo que después necesita el
 * template. Todavía no tiene pantallas: eso va en `subirFlowJson`.
 */
export function crearFlow(
  wabaId: string,
  accessToken: string,
  nombre: string,
  categorias: string[] = ["APPOINTMENT_BOOKING"],
): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${wabaId}/flows`, {
    method: "POST",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre, categories: categorias }),
  })
}

/**
 * Sube el Flow JSON como asset del Flow.
 *
 * Va como multipart, no como JSON en el body: Meta lo trata como un archivo.
 * Si el JSON tiene errores de validación, la respuesta los trae en
 * `validation_errors` con el 200 — o sea que `ok: true` NO significa que el
 * Flow esté bien. Por eso devolvemos la respuesta entera.
 */
export async function subirFlowJson(
  flowId: string,
  accessToken: string,
  flowJson: unknown,
): Promise<RespuestaDeMeta> {
  const form = new FormData()
  form.append("name", "flow.json")
  form.append("asset_type", "FLOW_JSON")
  form.append("file", new Blob([JSON.stringify(flowJson)], { type: "application/json" }), "flow.json")

  return llamar(`https://graph.facebook.com/${GRAPH}/${flowId}/assets`, {
    method: "POST",
    headers: auth(accessToken),
    body: form,
  })
}

/**
 * Publica el Flow.
 *
 * Es el paso con menos vuelta atrás de todos: un Flow publicado no se
 * despublica, se deprecia. Por eso la interfaz lo pide aparte y con
 * confirmación, en vez de encadenarlo al alta.
 */
export function publicarFlow(flowId: string, accessToken: string): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${flowId}/publish`, {
    method: "POST",
    headers: auth(accessToken),
  })
}

/** Estado del Flow: DRAFT, PUBLISHED, y los errores de validación si los hay. */
export function estadoDelFlow(flowId: string, accessToken: string): Promise<RespuestaDeMeta> {
  return llamar(
    `https://graph.facebook.com/${GRAPH}/${flowId}?fields=id,name,status,categories,validation_errors,json_version,data_api_version,preview`,
    { method: "GET", headers: auth(accessToken) },
  )
}

/**
 * Los assets del Flow: el Flow JSON que tiene cargado AHORA.
 *
 * Es el diagnóstico que faltaba. Cuando Meta rechaza un envío diciendo que la
 * pantalla no está permitida, la pregunta es siempre la misma —¿qué pantallas
 * tiene realmente este Flow?— y hasta ahora no había forma de contestarla sin
 * entrar a WhatsApp Manager.
 *
 * La respuesta trae una URL de descarga del JSON, no el JSON en sí.
 */
export function assetsDelFlow(flowId: string, accessToken: string): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${flowId}/assets`, {
    method: "GET",
    headers: auth(accessToken),
  })
}

/**
 * Borra un Flow. Sólo funciona con los que están en borrador: uno publicado se
 * deprecia, no se borra.
 *
 * Existe para limpieza. Dos Flows con nombres parecidos en el mismo WABA es una
 * confusión garantizada, y el id equivocado no falla de forma evidente — falla
 * con un error sobre pantallas que manda a buscar el problema en otro lado.
 */
export function borrarFlow(flowId: string, accessToken: string): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${flowId}`, {
    method: "DELETE",
    headers: auth(accessToken),
  })
}

/** Descarga el Flow JSON desde la URL que devuelve `assetsDelFlow`. */
export async function descargarFlowJson(url: string): Promise<RespuestaDeMeta> {
  return llamar(url, { method: "GET" })
}

/**
 * Crea el template.
 *
 * La respuesta trae `{ id, status, category }` — y ese `category` es el dato
 * que venimos persiguiendo: si Meta lo deja en UTILITY o lo reclasifica a
 * MARKETING al ver el botón de Flow. La diferencia de tarifa es grande.
 */
export function crearTemplate(
  wabaId: string,
  accessToken: string,
  definicion: unknown,
): Promise<RespuestaDeMeta> {
  return llamar(`https://graph.facebook.com/${GRAPH}/${wabaId}/message_templates`, {
    method: "POST",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(definicion),
  })
}

/**
 * Estado de la cuenta: verificación del negocio, revisión del WABA y calidad
 * del número (22/9/2026).
 *
 * Nace del error `(#139000) Blocked by Integrity`, que Meta devuelve sin decir
 * cuál de los requisitos falta. La guía de envío de Flows los enumera —"You
 * will need to verify your business and maintain a high message quality"— pero
 * el error no dice cuál de los dos, y son arreglos completamente distintos:
 * uno es un trámite de documentación, el otro es bajar el ritmo de envíos.
 *
 * Son dos consultas porque la verificación vive en el WABA y la calidad en el
 * número. Se devuelven las dos crudas.
 */
export async function diagnosticoDeLaCuenta(
  wabaId: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<{ waba: RespuestaDeMeta; numero: RespuestaDeMeta }> {
  const camposWaba = "id,name,account_review_status,business_verification_status,messaging_limit_tier,primary_funding_id"
  const camposNumero = "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput"

  const [waba, numero] = await Promise.all([
    llamar(`https://graph.facebook.com/${GRAPH}/${wabaId}?fields=${camposWaba}`, {
      method: "GET",
      headers: auth(accessToken),
    }),
    llamar(`https://graph.facebook.com/${GRAPH}/${phoneNumberId}?fields=${camposNumero}`, {
      method: "GET",
      headers: auth(accessToken),
    }),
  ])

  return { waba, numero }
}

/** Busca un template por nombre, para ver en qué estado de aprobación quedó. */
export function buscarTemplate(
  wabaId: string,
  accessToken: string,
  nombre: string,
): Promise<RespuestaDeMeta> {
  const query = `fields=name,status,category,language,components&name=${encodeURIComponent(nombre)}`
  return llamar(`https://graph.facebook.com/${GRAPH}/${wabaId}/message_templates?${query}`, {
    method: "GET",
    headers: auth(accessToken),
  })
}
