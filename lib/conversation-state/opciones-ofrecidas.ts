/**
 * lib/conversation-state/opciones-ofrecidas.ts
 *
 * Qué opciones le ofrecimos realmente al paciente en el último paso, y si su
 * respuesta numérica está entre ellas.
 *
 * ── Por qué existe (14/9/2026) ────────────────────────────────────────────
 *
 * Caso Marta: se le mostró un menú de DOS opciones (su obra social no permite
 * agendar por el bot, así que "Solicitar turno médico" ni figuraba) y contestó
 * "3". Ninguna capa reconoció ese "3", el mensaje cayó hasta el fondo de la
 * cascada, y el fondo de la cascada REINICIA: la saludaron de nuevo como si
 * recién llegara y le ofrecieron agendar un turno que un mensaje antes le habían
 * dicho que no podía sacar.
 *
 * Reiniciar es la peor respuesta posible ante algo que no entendimos, porque
 * descarta todo lo que ya se había establecido. Lo correcto es decir que esa
 * opción no está y volver a mostrar el paso.
 *
 * ── Por qué se parsea el texto y no se usan los botones guardados ─────────
 *
 * `saveStepButtons` guarda los botones interactivos de WhatsApp, que son como
 * máximo 3. Una lista de turnos ofrece 20 opciones numéricas y un solo botón
 * ("Ver más"). Validar contra los botones rechazaría el "7" de un paciente
 * eligiendo turno — rompiendo algo que hoy funciona. El texto del paso, en
 * cambio, enumera las opciones de verdad.
 */

/**
 * Números de opción que el mensaje enumera al principio de sus líneas:
 * "1- Solicitar turno", "  7. 11:15", "0. Volver al paso anterior".
 *
 * Se exige que el número abra la línea y esté seguido de un separador, para no
 * confundir con direcciones ("Mariano Castex 1369"), teléfonos o fechas, que
 * aparecen en medio del texto.
 */
const OPCION_EN_LINEA = /^\s*(\d{1,2})\s*[.\-)]/gm

export function opcionesOfrecidas(textoDelPaso?: string | null): Set<string> {
  const opciones = new Set<string>()
  if (!textoDelPaso) return opciones

  for (const match of textoDelPaso.matchAll(OPCION_EN_LINEA)) {
    opciones.add(String(Number(match[1])))
  }
  return opciones
}

/**
 * El mensaje es una selección de opción a secas ("3", "12", " 2 ").
 *
 * Se limita a 1-2 dígitos a propósito: un DNI son 7-8 y no puede confundirse con
 * una opción de menú.
 */
export function esSeleccionNumerica(mensaje: string): string | null {
  const limpio = (mensaje || '').trim()
  return /^\d{1,2}$/.test(limpio) ? String(Number(limpio)) : null
}

export interface ResultadoFueraDeMenu {
  /** true si el paciente eligió un número que no le ofrecimos. */
  fueraDeMenu: boolean
  /** La opción que eligió, para poder nombrarla en la respuesta. */
  elegida?: string
  /** Las que sí están disponibles, ordenadas. */
  disponibles: string[]
}

/**
 * ¿El paciente eligió una opción que no existe?
 *
 * Devuelve `fueraDeMenu: false` ante cualquier duda — si el paso no enumera
 * opciones, si ofrece una sola, o si el mensaje no es un número suelto. Es
 * deliberado: esta función sólo debe interceptar el caso inequívoco. Bloquear un
 * mensaje legítimo es peor que dejar pasar uno raro, que igual va a caer en las
 * capas de abajo.
 */
export function evaluarSeleccionFueraDeMenu(
  mensaje: string,
  textoDelPaso?: string | null,
): ResultadoFueraDeMenu {
  const disponiblesSet = opcionesOfrecidas(textoDelPaso)
  const disponibles = [...disponiblesSet].sort((a, b) => Number(a) - Number(b))

  // Con menos de dos opciones no hay menú del cual salirse.
  if (disponiblesSet.size < 2) return { fueraDeMenu: false, disponibles }

  const elegida = esSeleccionNumerica(mensaje)
  if (!elegida) return { fueraDeMenu: false, disponibles }

  if (disponiblesSet.has(elegida)) return { fueraDeMenu: false, elegida, disponibles }

  return { fueraDeMenu: true, elegida, disponibles }
}

/** Cómo se le nombra al paciente la lista de opciones válidas. */
export function listarOpciones(disponibles: string[]): string {
  if (disponibles.length === 0) return ''
  if (disponibles.length === 1) return disponibles[0]
  return `${disponibles.slice(0, -1).join(', ')} o ${disponibles[disponibles.length - 1]}`
}
