/**
 * ¿El paciente está preguntando POR QUÉ la clínica confirmó o canceló su turno?
 * (28/10/2026)
 *
 * ── El caso que esto arregla ───────────────────────────────────────────────
 *
 * Después de un `confirmar_turno_solicitado`, el paciente escribió:
 *
 *   "Gracias, sabés cuánto vale la consulta?"
 *   "Quería saber cuánto sería la consulta particular"
 *
 * y las dos veces el bot contestó: "No tengo el detalle del motivo por parte de
 * la clínica. Para más información podés comunicarte…".
 *
 * No es una redacción desafortunada: es la respuesta a OTRA pregunta. La regla
 * que decidía era ésta:
 *
 *   /\b(por que|porque|motivo|razon|saber|entender|explic|…)\b/ || /\?\s*$/
 *
 * El signo de pregunta final alcanzaba, y "saber" también —"quería saber cuánto
 * vale" lo activa—. O sea que CUALQUIER pregunta, del tema que fuera, se
 * respondía como si hubiera preguntado por el motivo.
 *
 * ── Qué hace esto en cambio ────────────────────────────────────────────────
 *
 * Reconoce sólo la pregunta por el motivo, que es la única que sabemos
 * contestar —sabemos que NO tenemos el dato—. Todo lo demás no es asunto de
 * este bloque y sigue su camino por el pipeline normal, que consulta la
 * información de la clínica, deriva por lo que se preguntó y recuerda el turno.
 *
 * ── Por qué sigue siendo una heurística y no el LLM ────────────────────────
 *
 * Porque corre en el camino determinístico, antes de cualquier llamada al
 * modelo, y su única decisión es "¿me quedo con este mensaje o lo dejo pasar?".
 * Equivocarse hacia dejarlo pasar no rompe nada: lo atiende el pipeline. Por
 * eso la regla es deliberadamente angosta.
 */

/** Sin tildes, en minúsculas, sin espacios de más. */
function normalizar(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * La pregunta tiene que ser por el MOTIVO, no una pregunta cualquiera.
 *
 * Dos formas:
 *  - menciona el motivo/la razón explícitamente;
 *  - pregunta qué pasó, o por qué, cerca de la palabra turno/cancel/confirm.
 */
const POR_EL_MOTIVO = [
  // "cuál es el motivo", "quiero saber el motivo", "por qué razón"
  /\b(motivo|razon)\b/,
  // "¿por qué me lo cancelaron?", "porque lo cancelaron", "por que me confirmaron"
  /\bpor\s*que\b[^?]{0,40}\b(cancel|confirm|rechaz|suspend|anul|cambi)/,
  /\b(cancel|confirm|rechaz|suspend|anul)[a-z]*\b[^?]{0,30}\bpor\s*que\b/,
  // "¿qué pasó?", "qué sucedió", "qué pasó con mi turno"
  /\bque\s+(paso|sucedio|ocurrio|hubo)\b/,
  // "por qué" suelto, como mensaje corto y completo
  /^(y\s+)?(por\s*que|porque)\s*\??$/,
]

/**
 * Temas que NO son el motivo, aunque la frase traiga "saber" o un "?".
 *
 * Están para que quede explícito en el código qué fue lo que se nos escapaba:
 * precios, coberturas, preparación, estudios, derivaciones, ubicación.
 */
const OTRO_TEMA =
  /\b(cuanto|precio|valor|vale|cuesta|costo|abon|pag|arancel|particular|obra\s*social|cobertura|prepaga|afiliad|derivacion|orden|receta|estudio|ayun|preparacion|traer|llevar|direccion|donde queda|ubicacion|estacionamiento|demora)\b/

/**
 * `true` sólo si pregunta por el motivo de la decisión de la clínica.
 *
 * Un mensaje que mezcla las dos cosas —"¿por qué me lo cancelaron? ¿cuánto
 * sale la consulta?"— se resuelve como motivo: de las dos preguntas, ésa es la
 * que este bloque puede contestar, y la otra el paciente la va a repetir.
 */
export function preguntaPorElMotivo(mensaje: string): boolean {
  const t = normalizar(mensaje)
  if (!t) return false

  const esDelMotivo = POR_EL_MOTIVO.some((r) => r.test(t))
  if (esDelMotivo) return true

  // Sin marcas del motivo, no se asume que lo sea. Esta línea es el arreglo:
  // antes bastaba con que terminara en "?".
  return false
}

/**
 * ¿El mensaje trae una consulta sobre otra cosa?
 *
 * Se usa para decidir si, además de la confirmación, el primer mensaje
 * después de la plantilla tiene que seguir al pipeline. No alcanza con "no es
 * el motivo": "gracias" tampoco lo es y no hay nada que responder.
 */
export function traeOtraConsulta(mensaje: string): boolean {
  const t = normalizar(mensaje)
  if (!t) return false
  if (preguntaPorElMotivo(t)) return false
  if (OTRO_TEMA.test(t)) return true
  // Una pregunta explícita sobre cualquier otra cosa también cuenta.
  return /\?/.test(mensaje) && t.length > 12
}
