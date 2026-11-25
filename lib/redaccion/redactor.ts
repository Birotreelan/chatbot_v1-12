/**
 * El redactor: la IA escribe lo que el paciente lee (25/11/2026).
 *
 * ── El hallazgo que lo motiva ─────────────────────────────────────────────
 *
 * Del diagnóstico del 20/11: la IA ya decide, pero no habla. El dispatcher
 * clasifica la intención y elige entre 12 acciones, y eso funciona
 * razonablemente bien; pero una vez elegida la acción, el texto que el paciente
 * lee sale de 161 funciones que arman mensajes fijos. "La IA decide el camino;
 * el camino tiene las palabras escritas de antemano."
 *
 * ── Por qué este primer paso reescribe en vez de reemplazar ───────────────
 *
 * El plan pide "un único redactor que recibe el estado completo y escribe el
 * mensaje. Reemplaza a los 161 constructores, empezando por los más usados".
 * Empezar por reemplazar incluso uno solo obliga a decidir, para ese mensaje,
 * qué parte del estado hace falta, qué pasa si el modelo falla y cómo se
 * compara con lo de antes. Multiplicado por 161, es un proyecto de meses que
 * se abandona a la mitad y deja el sistema con dos formas de escribir.
 *
 * Así que el primer paso invierte el orden: el constructor determinístico sigue
 * armando el mensaje —que es, de hecho, el estado completo ya resuelto: quién
 * es el paciente, qué turno tiene, qué puede hacer— y la IA lo reescribe. Se
 * gana lo que se vino a buscar, que es que el paciente deje de leer un
 * formulario, sin tocar ninguna de las 161 decisiones que esos constructores ya
 * tomaron bien.
 *
 * Y se gana algo que el reemplazo directo no da: una verificación posible. El
 * texto de antes está ahí, al lado, así que las barandas pueden comparar en vez
 * de adivinar. Ver lib/redaccion/barandas.ts.
 *
 * ── Dónde corre ──────────────────────────────────────────────────────────
 *
 * En `sendDirectResponse`, el embudo por el que salen las 141 respuestas. Mismo
 * lugar que la presentación de Iris y la etiqueta de "otra consulta", y por el
 * mismo motivo: ninguna rama puede olvidarse, y la que se agregue mañana queda
 * cubierta sin hacer nada.
 *
 * Corre ANTES de la presentación a propósito. Así la línea "Soy Iris, tu
 * asistente virtual de inteligencia artificial" se antepone después y queda
 * fuera del alcance del modelo: es la frase que no puede cambiar de forma.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────
 *
 * No toca los menús numerados ni los botones: el número que el paciente
 * responde lo interpreta un action map escrito aparte. No decide nada: la
 * cascada de compuertas sigue igual, y eso es la etapa 4.
 */

import { openai } from "@/lib/openai"
import { MODELO_REDACCION } from "@/lib/ai-models"
import { revisarRedaccion, separarMenu } from "./barandas"

/**
 * Debajo de esto no se llama al modelo.
 *
 * "Listo." o "Perfecto, ¿en qué más te ayudo?" no tienen nada que mejorar, y
 * cada llamada cuesta tiempo en el camino caliente del webhook: el paciente
 * espera. El umbral deja afuera los acuses de recibo y deja pasar lo que de
 * verdad se lee como un formulario.
 */
const MINIMO_PARA_VALER_LA_PENA = 120

const SYSTEM_PROMPT = `Sos Iris, la asistente de una clínica oftalmológica argentina. Te paso un mensaje ya redactado por el sistema y lo reescribís para que suene a una persona del equipo, no a un formulario.

REGLAS QUE NO SE NEGOCIAN:
- No agregues NINGÚN dato que no esté en el mensaje original: ni fechas, ni horarios, ni nombres, ni teléfonos, ni precios, ni direcciones. Si no está, no existe.
- No saques ningún dato que esté: fechas, horarios, nombres de profesionales, sedes, enlaces y teléfonos van todos.
- No contestes consultas médicas ni des indicaciones (gotas, ayuno, medicación): si el mensaje original no habla de eso, vos tampoco.
- Un solo mensaje. No cierres con una pregunta de cortesía que no estaba.
- No agregues saludos de apertura: eso lo pone el sistema aparte.

CÓMO ESCRIBIR:
- Español rioplatense, voseo (tenés, podés, escribí). Cálido y directo.
- Más corto que el original, nunca más largo.
- Frases cortas. Una idea por oración. Muchos pacientes son mayores y leen en el teléfono.
- Negritas con UN asterisco, como en WhatsApp: *así*. Nunca **así**, que WhatsApp no interpreta y el paciente termina leyendo los asteriscos. Y sólo en el dato que importa (la fecha, la hora, el profesional).
- Sin emojis.
- Si el mensaje original ya está bien, devolvelo casi igual. No hace falta cambiar por cambiar.

Devolvé SOLO el mensaje reescrito, sin comillas ni explicaciones.`

export interface ResultadoDeRedaccion {
  /** El texto que hay que mandar. Ante cualquier problema, el original. */
  texto: string
  /** `true` sólo si salió el texto del modelo. */
  reescrito: boolean
  /** Por qué no se reescribió. Para el log. */
  motivo?: string
}

/**
 * Reescribe el mensaje, o devuelve el original.
 *
 * Nunca lanza. Esta función está en el camino de TODAS las respuestas del bot:
 * una excepción acá es un paciente que no recibe nada, que es infinitamente
 * peor que un paciente que recibe el texto de siempre.
 */
export async function redactar(params: {
  mensaje: string
  /** La fase del embudo (`sendDirectResponse`), para el log. */
  fase?: string
  /** Los últimos mensajes, para que no repita lo que ya dijo. */
  historial?: Array<{ role: string; content: string }>
}): Promise<ResultadoDeRedaccion> {
  const original = params.mensaje || ""

  if (original.trim().length < MINIMO_PARA_VALER_LA_PENA) {
    return { texto: original, reescrito: false, motivo: "demasiado corto para valer la pena" }
  }

  const { prosa, menu } = separarMenu(original)
  if (prosa.trim().length < MINIMO_PARA_VALER_LA_PENA) {
    // Un mensaje que es casi todo menú: lo poco que hay arriba no justifica la
    // llamada, y el menú no se toca.
    return { texto: original, reescrito: false, motivo: "la prosa es demasiado corta" }
  }

  try {
    const contexto = (params.historial || [])
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Paciente" : "Iris"}: ${m.content}`)
      .join("\n")

    const respuesta = await openai.chat.completions.create({
      model: MODELO_REDACCION,
      // Baja a propósito: lo que se busca es que suene humano, no que sorprenda.
      // Con temperatura alta el mismo mensaje sale distinto cada vez y se
      // vuelve imposible de revisar.
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            (contexto ? `Últimos mensajes de la conversación:\n${contexto}\n\n` : "") +
            `Mensaje del sistema a reescribir:\n${prosa}`,
        },
      ],
    })

    const generado = respuesta.choices[0]?.message?.content?.trim()
    if (!generado) return { texto: original, reescrito: false, motivo: "el modelo no devolvió nada" }

    // Las comillas que el modelo agrega a veces alrededor de todo el mensaje.
    const limpio = generado.replace(/^["“']|["”']$/g, "").trim()

    const veredicto = revisarRedaccion(prosa, limpio)
    if (!veredicto.aprobado) {
      /**
       * El log de las barandas es el criterio de éxito de esta etapa: "se sabe
       * que salió bien cuando el corpus mejora y ninguna baranda se dispara en
       * producción". Así que se registra siempre, con el texto que se rechazó:
       * sin el texto no se puede saber si la baranda acertó o si fue un falso
       * positivo que nos está costando una redacción buena.
       */
      console.warn(
        `[REDACCION] Baranda: ${veredicto.motivo}. Sale el texto determinístico. ` +
          `Fase: ${params.fase || "—"}. Rechazado: ${JSON.stringify(limpio.slice(0, 300))}`,
      )
      return { texto: original, reescrito: false, motivo: veredicto.motivo }
    }

    const texto = menu ? `${limpio}\n\n${menu}` : limpio
    console.log(`[REDACCION] Reescrito (fase ${params.fase || "—"}): ${prosa.length} → ${limpio.length} caracteres`)
    return { texto, reescrito: true }
  } catch (error) {
    console.error("[REDACCION] Falló la reescritura, sale el texto determinístico:", error)
    return { texto: original, reescrito: false, motivo: "error al llamar al modelo" }
  }
}
