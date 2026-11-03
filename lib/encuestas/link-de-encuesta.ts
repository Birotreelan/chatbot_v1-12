/**
 * El link de la encuesta, cuando no vino en el envío (3/11/2026).
 *
 * El VPS lo manda en `Chatbot_Data.link_encuesta`, pero puede venir `null` si
 * la clínica no lo cargó o si no se pudo leer en ese momento. Entonces se pide
 * al pedir: cuando el paciente toca "Estoy conforme", recién ahí hace falta.
 *
 * ── Tres respuestas posibles, y las tres importan ──────────────────────────
 *
 * El endpoint puede devolver un link, puede devolver la encuesta desactivada o
 * con el link vacío, y puede fallar con 503 si la clínica no responde. Las tres
 * terminan igual para el paciente —el agradecimiento sin encuesta— pero se
 * distinguen en el log, porque son tres problemas distintos: uno es de
 * configuración de la clínica, otro es que apagó la encuesta a propósito, y el
 * tercero es que su servidor está caído.
 *
 * Nunca lanza: el paciente contestó que está bien y lo peor que puede pasar es
 * que no reciba el link. Que una consulta a un servidor ajeno rompa ese
 * agradecimiento sería desproporcionado.
 */

const URL_ENCUESTAS = process.env.ENCUESTAS_API_URL || "https://api.santiagovulliez.com/encuestas.php"

/** Cinco segundos. El paciente está esperando una respuesta. */
const TIMEOUT_MS = 5000

export interface LinkDeEncuesta {
  link: string | null
  /** Por qué no hay link, cuando no hay. Para el log, no para el paciente. */
  motivo?: "sin_api_key" | "desactivada" | "vacio" | "error_http" | "red" | "respuesta_invalida"
}

export async function obtenerLinkDeEncuesta(clienteId: string): Promise<LinkDeEncuesta> {
  const apiKey = process.env.TREELAN_BOT_API_KEY
  if (!apiKey) {
    console.warn("[ENCUESTA_LINK] Falta TREELAN_BOT_API_KEY: no se puede consultar el link")
    return { link: null, motivo: "sin_api_key" }
  }
  if (!clienteId) return { link: null, motivo: "respuesta_invalida" }

  const controlador = new AbortController()
  const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS)

  try {
    const r = await fetch(URL_ENCUESTAS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ Action: "link", Cliente_Id: clienteId }),
      signal: controlador.signal,
    })

    if (!r.ok) {
      // El 503 documentado es "la clínica no responde", y se ve igual que
      // cualquier otro error del servidor: se anota el código y se sigue.
      console.warn(`[ENCUESTA_LINK] ${clienteId}: HTTP ${r.status}`)
      return { link: null, motivo: "error_http" }
    }

    const datos = await r.json().catch(() => null)
    if (!datos || datos.success === false) {
      console.warn(`[ENCUESTA_LINK] ${clienteId}: respuesta sin éxito`, datos)
      return { link: null, motivo: "respuesta_invalida" }
    }

    // `activa: false` es la clínica diciendo "no quiero encuestas ahora". No es
    // un error y no hay que reintentarlo.
    if (datos.activa === false) {
      console.log(`[ENCUESTA_LINK] ${clienteId}: la encuesta está desactivada`)
      return { link: null, motivo: "desactivada" }
    }

    const link = typeof datos.link === "string" ? datos.link.trim() : ""
    if (!link) {
      console.warn(`[ENCUESTA_LINK] ${clienteId}: la clínica no tiene link cargado`)
      return { link: null, motivo: "vacio" }
    }

    return { link }
  } catch (error) {
    console.error(`[ENCUESTA_LINK] ${clienteId}: no se pudo consultar`, error)
    return { link: null, motivo: "red" }
  } finally {
    clearTimeout(corte)
  }
}
