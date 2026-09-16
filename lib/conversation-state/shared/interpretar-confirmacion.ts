/**
 * Interpretación de la respuesta a "¿Confirmás la reserva? 1. Sí / 2. No".
 *
 * ── El caso que lo motivó (16/9/2026, tel. 2291400734) ─────────────────────
 *
 * A una paciente se le pidió confirmar un turno. Respondió:
 *
 *     Jueves 17
 *     2
 *
 * El "2" era su respuesta: *No, modificar*. El sistema reservó el turno igual.
 *
 * El motivo es de una sola línea: la detección hacía
 * `['si', ..., '1'].some(c => entrada.includes(c))`, o sea búsqueda de
 * SUBCADENA. El "1" de "17" alcanzó para dar por confirmada la reserva. El
 * mismo error hace que "necesito cambiar" confirme (por el "si" de "neceSIto"),
 * que "el 21 no me sirve" confirme, y que lo positivo gane siempre porque se
 * evalúa antes que lo negativo.
 *
 * ── El criterio ────────────────────────────────────────────────────────────
 *
 * Las consecuencias de equivocarse no son simétricas, así que el umbral
 * tampoco lo es:
 *
 *   - Confirmar de más reserva un turno real en la agenda de la clínica.
 *   - Rechazar de más muestra el menú de modificación, que se puede deshacer.
 *   - No entender repregunta, que no rompe nada.
 *
 * Por eso las reglas deciden ÚNICAMENTE cuando el mensaje no contiene nada
 * más que la respuesta. Si trae cualquier otra cosa —una fecha, una aclaración,
 * dos señales que se contradicen— se abstiene y decide el clasificador de IA,
 * que ya estaba cableado abajo justamente para eso. Y si la IA tampoco puede,
 * se repregunta.
 *
 * Abstenerse cuesta una llamada barata a gpt-4o-mini. Confirmar de más le
 * ocupa un turno a un paciente que no lo pidió.
 */

export type LecturaConfirmacion = "confirma" | "rechaza" | "ambiguo"

export interface ResultadoInterpretacion {
  lectura: LecturaConfirmacion
  /** Para loguear por qué se decidió así, sin tener que reconstruirlo. */
  motivo: string
}

/** Un token exactamente igual a estos es un sí. "1" es la opción del menú. */
const AFIRMATIVAS = new Set([
  "1",
  "si",
  "sii",
  "siii",
  "sip",
  "claro",
  "ok",
  "oka",
  "okey",
  "okay",
  "dale",
  "listo",
  "correcto",
  "correctos",
  "correcta",
  "confirmo",
  "confirmar",
  "confirmado",
  "confirmada",
  "perfecto",
  "exacto",
  "afirmativo",
  "bien",
  "yes",
])

/** Un token exactamente igual a estos es un no. "2" es la opción del menú. */
const NEGATIVAS = new Set([
  "2",
  "no",
  "nop",
  "negativo",
  "modificar",
  "modificarlo",
  "modifico",
  "cambiar",
  "cambiarlo",
  "cambio",
  "cancelar",
  "cancelo",
  "incorrecto",
  "incorrectos",
  "incorrecta",
  "mal",
  "error",
  "equivocado",
])

/**
 * Palabras de cortesía que acompañan la respuesta sin cambiarla.
 *
 * Están para que "sí, muchas gracias" o "no, gracias" sigan resolviéndose por
 * reglas, sin pagar una llamada a la IA por algo que es evidente.
 */
const RELLENO = new Set([
  "gracias",
  "muchas",
  "mucho",
  "mucha",
  "por",
  "favor",
  "porfa",
  "porfavor",
  "please",
  "hola",
  "buenas",
  "buenos",
  "buen",
  "dia",
  "dias",
  "tarde",
  "tardes",
  "noche",
  "noches",
  "esta",
  "estan",
  "es",
  "son",
  "todo",
  "todos",
  "todas",
  "y",
  "e",
  "la",
  "el",
  "lo",
  "los",
  "las",
  "muy",
  "ya",
  "asi",
  "eso",
  "esos",
  "de",
  "que",
])

/**
 * Corta el mensaje en palabras comparables: sin acentos, en minúscula y sin
 * puntuación. Los números quedan enteros ("17" es un token, no un "1" y un "7"),
 * que es justamente lo que evita el bug original.
 */
function tokenizar(entrada: string): string[] {
  return (entrada || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function interpretarConfirmacion(entrada: string): ResultadoInterpretacion {
  const tokens = tokenizar(entrada)

  if (tokens.length === 0) {
    return { lectura: "ambiguo", motivo: "mensaje vacío" }
  }

  const positivos = tokens.filter((t) => AFIRMATIVAS.has(t))
  const negativos = tokens.filter((t) => NEGATIVAS.has(t))
  const otros = tokens.filter((t) => !AFIRMATIVAS.has(t) && !NEGATIVAS.has(t) && !RELLENO.has(t))

  // "sí, pero no" / "1 2": el paciente dijo las dos cosas. Elegir una sería
  // adivinar, y una de las dos opciones reserva un turno.
  if (positivos.length > 0 && negativos.length > 0) {
    return {
      lectura: "ambiguo",
      motivo: `señales contradictorias (${positivos.join(",")} vs ${negativos.join(",")})`,
    }
  }

  // El caso real: "jueves 17 2" trae un "2", pero también una fecha que no
  // sabemos qué significa. Que lo resuelva la IA con el contexto del paso.
  if (otros.length > 0) {
    return {
      lectura: "ambiguo",
      motivo: `el mensaje trae contenido además de la respuesta (${otros.join(",")})`,
    }
  }

  if (positivos.length > 0) {
    return { lectura: "confirma", motivo: `afirmación limpia (${positivos.join(",")})` }
  }

  if (negativos.length > 0) {
    return { lectura: "rechaza", motivo: `negación limpia (${negativos.join(",")})` }
  }

  return { lectura: "ambiguo", motivo: "sin señal reconocible" }
}
