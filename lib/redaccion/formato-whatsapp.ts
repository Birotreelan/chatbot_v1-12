/**
 * El formato que entiende WhatsApp (25/11/2026).
 *
 * ── El caso ───────────────────────────────────────────────────────────────
 *
 * Primer mensaje reescrito por la IA en producción, Salud Ocular:
 *
 *     Te esperamos el **26 de noviembre de 2026** a las **09:05** con
 *     Etcheverria, Martiniano…
 *
 * WhatsApp usa UN asterisco para negrita. Con dos, no los interpreta: el
 * paciente lee los asteriscos. El prompt pedía negritas y el modelo las escribió
 * en Markdown, que es lo que hacen todos los modelos salvo que se les diga lo
 * contrario — y decirlo tampoco alcanza, porque es un prompt y no una garantía.
 *
 * ── Y el problema ya estaba antes de la IA ────────────────────────────────
 *
 * Buscándolo apareció que el repaso de la reserva ya mandaba
 * `**DATOS DEL PACIENTE:**` escrito a mano en tres archivos
 * (confirmation-handler, reschedule-templates, new-patient-templates). O sea
 * que el paciente al que se le pide verificar sus datos los lee con los
 * asteriscos a la vista, y viene así desde antes.
 *
 * Por eso esto se aplica a TODOS los mensajes y no sólo a los reescritos: la
 * conversión es correcta para los dos casos y arreglarlo en el embudo lo arregla
 * también donde está escrito a mano.
 *
 * ── Qué se convierte y qué no ─────────────────────────────────────────────
 *
 * Sólo lo que WhatsApp sí tiene: negrita, cursiva y tachado. Los encabezados de
 * Markdown (`## Título`) no tienen equivalente, así que se les saca el numeral y
 * queda el texto en negrita, que es lo más parecido. Lo que no se toca es un
 * asterisco solo —que ya es negrita de WhatsApp— ni los guiones de una lista.
 */

/**
 * Pasa un texto a formato de WhatsApp.
 *
 * Es idempotente: aplicado dos veces da lo mismo. Importa porque corre en el
 * embudo, y un mensaje que ya venía con un asterisco simple tiene que salir
 * igual.
 */
export function aFormatoDeWhatsApp(texto: string): string {
  if (!texto) return texto

  return (
    texto
      /**
       * `**negrita**` → `*negrita*`.
       *
       * El contenido no puede empezar ni terminar con espacio ni contener un
       * salto de línea doble: así no se agarra un `**` suelto en medio de un
       * párrafo ni se come un bloque entero por error.
       */
      .replace(/\*\*(?!\s)([^\n*]{1,200}?)(?<!\s)\*\*/g, "*$1*")
      /** `__cursiva__` → `_cursiva_`, por el mismo motivo. */
      .replace(/__(?!\s)([^\n_]{1,200}?)(?<!\s)__/g, "_$1_")
      /** `~~tachado~~` → `~tachado~`. */
      .replace(/~~(?!\s)([^\n~]{1,200}?)(?<!\s)~~/g, "~$1~")
      /**
       * Encabezados: `## Datos del turno` → `*Datos del turno*`.
       *
       * No existen en WhatsApp. Sin esto el paciente lee los numerales, que es
       * peor que no tener encabezado.
       */
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, (_m, titulo) => `*${String(titulo).replace(/\*/g, "").trim()}*`)
  )
}

/**
 * ¿Quedó algo que WhatsApp no va a interpretar?
 *
 * Para el log, después de convertir. Si esto aparece es que hay una forma de
 * Markdown que la conversión no cubre, y el que la ve es el paciente.
 */
export function restosDeMarkdown(texto: string): string | null {
  if (/\*\*/.test(texto)) return "quedaron asteriscos dobles"
  if (/^[ \t]*#{1,6}[ \t]/m.test(texto)) return "quedó un encabezado con numeral"
  if (/\[[^\]]+\]\((https?:\/\/[^)]+)\)/.test(texto)) return "quedó un enlace en formato Markdown"
  return null
}
