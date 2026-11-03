/**
 * Qué quiso decir el paciente que escribió en vez de tocar un botón
 * (3/11/2026).
 *
 * ── El costo de equivocarse NO es simétrico ────────────────────────────────
 *
 * Es lo que gobierna todo este archivo. Derivar de más le cuesta a la clínica
 * un mensaje y treinta segundos de un agente. No derivar a un paciente operado
 * que está diciendo que algo le duele le cuesta al paciente.
 *
 * Así que ante la duda, se deriva. Y cuando no se entiende nada, no se asume
 * que está todo bien: se repregunta una vez y, si la segunda tampoco se
 * entiende, se deriva igual. En ningún camino un mensaje ambiguo termina en
 * "gracias, que tengas un buen día".
 *
 * ── Primero las reglas, después el modelo ──────────────────────────────────
 *
 * Las dos puntas son inequívocas y no necesitan una llamada al modelo: "todo
 * perfecto, gracias" y "me duele mucho el ojo". Las reglas las resuelven
 * gratis y en el acto. El modelo queda para el medio, que es donde de verdad
 * hace falta — y ahí el riesgo está acotado porque la salida es una de tres
 * palabras y el default es el lado seguro.
 *
 * ── Por qué no se usa el pipeline normal ───────────────────────────────────
 *
 * Porque el pipeline contesta consultas; acá la pregunta es otra: "¿esto es
 * una molestia postoperatoria?". Un mensaje como "tengo una duda" en el
 * pipeline normal es una consulta a responder, y en esta ventana es un motivo
 * de derivación. Son dos lecturas distintas del mismo texto, y sólo una
 * corresponde cuando hay una encuesta abierta.
 */

import { openai } from "../openai"
import { MODELO_CLASIFICACION } from "../ai-models"

export type LecturaDeLaEncuesta = "conforme" | "molestia" | "no_entendido"

/** Sin tildes, en minúsculas, sin espacios de más. */
function normalizar(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Molestia, duda o disconformidad, sin ambigüedad posible.
 *
 * Incluye "duda" y "consulta" a propósito: en esta ventana una duda sobre la
 * recuperación es motivo de derivación, no algo que el bot deba contestar. Fue
 * el pedido explícito —"cualquier molestia, duda o disconformidad"—.
 */
const ES_MOLESTIA = [
  // síntomas
  /\b(me\s+)?(duele|dolia|duelen|arde|ardor|molesta|molestia|molestias|pica|picazon|lagrime|lagrimeo|hinchad|inflamad|supura|pus|sangr|secrecion|legaña)/,
  /\b(vision|veo|visto)\b[^.]{0,30}\b(borros|nubl|doble|mal|peor|manchas|destellos|luces)/,
  /\b(no\s+(veo|puedo\s+ver)|veo\s+(mal|borroso|peor)|perdi\s+vision)\b/,
  /\b(fiebre|mareo|mareos|nauseas|vomit)/,
  // disconformidad
  /\b(disconform|inconform|insatisfech|no\s+estoy\s+conforme|mal\s+atendid|maltrat|queja|reclamo|pesimo|horrible)/,
  // dudas y consultas sobre la recuperación
  /\b(duda|dudas|consulta|consultar|pregunta|preguntar|quisiera\s+saber|necesito\s+saber)\b/,
  /\b(es\s+normal|esta\s+bien\s+que|deberia|tengo\s+que\s+preocuparme|me\s+preocupa|preocupad)/,
  // pedido explícito de una persona
  /\b(hablar\s+con|atencion|me\s+atienda|un\s+medico|el\s+doctor|la\s+doctora|urgente|emergencia)\b/,
]

/**
 * Conformidad sin ambigüedad.
 *
 * Deliberadamente angosto: tiene que ser un mensaje corto y positivo y nada
 * más. "Bien, pero me arde un poco" NO entra acá — y además las reglas de
 * molestia se evalúan primero, justamente para eso.
 */
const ES_CONFORME = [
  /^(si|s|sip|sisi)$/,
  /^(todo\s+)?(bien|ok|oka|okey|perfecto|excelente|barbaro|genial|joya|buenisimo|conforme|correcto)( todo)?[.!]*$/,
  /^(estoy\s+)?(bien|conforme|perfecto|muy\s+bien|re\s+bien)[.!]*$/,
  /^(muchas\s+)?gracias([ ,!.].{0,20})?$/,
  /^(todo\s+(bien|perfecto|ok|en\s+orden))[ ,.!]*(gracias)?[.!]*$/,
  /^(no|ninguna|ningun\s+problema|sin\s+problemas|nada)[ ,.!]*(gracias)?[.!]*$/,
]

/** Lo que resuelven las reglas, o `null` si hay que preguntarle al modelo. */
export function lecturaPorReglas(mensaje: string): LecturaDeLaEncuesta | null {
  const t = normalizar(mensaje)
  if (!t) return null

  // La molestia manda: un mensaje que dice las dos cosas —"bien, pero me
  // arde"— es una molestia. Al revés, "bien" taparía el "me arde".
  if (ES_MOLESTIA.some((r) => r.test(t))) return "molestia"
  if (ES_CONFORME.some((r) => r.test(t))) return "conforme"
  return null
}

const INSTRUCCIONES = `Un paciente recién operado recibió una encuesta de satisfacción con dos opciones: "Estoy conforme" o "Molestia o disconformidad". En vez de elegir, escribió un mensaje.

Clasificá ese mensaje en una sola palabra:

- "molestia": menciona cualquier síntoma, dolor, molestia física, problema de visión, disconformidad con la atención, una duda o consulta sobre su recuperación, o pide hablar con alguien del consultorio.
- "conforme": dice que está bien, que no tiene problemas, o sólo agradece.
- "no_entendido": no se puede determinar con razonable certeza, o habla de un tema completamente distinto.

Ante la duda entre "molestia" y las otras dos, elegí "molestia": es un paciente operado y no detectar un síntoma es mucho peor que preguntar de más.

Respondé SÓLO con una de esas tres palabras, sin comillas ni explicación.`

/**
 * La lectura final: reglas, y si no alcanzan, el modelo.
 *
 * Si el modelo falla o devuelve algo inesperado, la respuesta es
 * `no_entendido`, no `conforme`. El llamador repregunta una vez y a la segunda
 * deriva: un paciente operado nunca termina en "que tengas un buen día" por un
 * error nuestro.
 */
export async function interpretarRespuestaDeEncuesta(
  mensaje: string,
): Promise<{ lectura: LecturaDeLaEncuesta; origen: "reglas" | "modelo" | "falla" }> {
  const porReglas = lecturaPorReglas(mensaje)
  if (porReglas) return { lectura: porReglas, origen: "reglas" }

  try {
    const respuesta = await openai.chat.completions.create({
      model: MODELO_CLASIFICACION,
      temperature: 0,
      max_tokens: 8,
      messages: [
        { role: "system", content: INSTRUCCIONES },
        { role: "user", content: String(mensaje || "").slice(0, 1000) },
      ],
    })

    const crudo = normalizar(respuesta.choices?.[0]?.message?.content || "")
    if (crudo.includes("molestia")) return { lectura: "molestia", origen: "modelo" }
    if (crudo.includes("conforme")) return { lectura: "conforme", origen: "modelo" }
    return { lectura: "no_entendido", origen: "modelo" }
  } catch (error) {
    console.error("[ENCUESTA] No se pudo clasificar el mensaje:", error)
    return { lectura: "no_entendido", origen: "falla" }
  }
}
