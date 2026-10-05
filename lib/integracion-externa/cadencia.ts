/**
 * Cada cuánto suele llegar cada plantilla, y si se salió de esa cadencia.
 *
 * ── Por qué no alcanza un umbral fijo ──────────────────────────────────────
 *
 * La idea original era reiniciar la medición cada dos horas: lo que no apareció
 * en ese rato, se marca. No sirve, y el motivo es el volumen desparejo. El
 * recordatorio de 1 turno llega cientos de veces por día; el de 3 turnos, o la
 * aprobación de un turno pedido, pueden pasar dos horas sin aparecer sin que
 * nada esté mal. Con un umbral único esas filas viven en rojo, y una alarma que
 * suena siempre deja de ser una alarma.
 *
 * ── Qué hace en cambio ─────────────────────────────────────────────────────
 *
 * Mira cada cuánto venía llegando ESA plantilla en ESE cliente, y compara el
 * silencio actual contra su propia costumbre. "Normalmente llega cada 20
 * minutos y hace cuatro horas que no llega" es un hallazgo; "hace cuatro horas
 * que no llega algo que llega dos veces por semana" no lo es.
 *
 * Se calibra solo: no hay nada que configurar por cliente ni por plantilla, y
 * una clínica que manda el doble de volumen que otra no necesita otro umbral.
 *
 * ── Por qué la mediana y no el promedio ────────────────────────────────────
 *
 * Porque los intervalos tienen huecos enormes y previsibles: la noche, el fin
 * de semana, un feriado. Un promedio se los come y da una cadencia inflada que
 * nunca se supera, con lo cual nunca avisaría. La mediana ignora esos pocos
 * intervalos largos y describe el ritmo del horario de trabajo, que es cuando
 * la caída importa.
 */

/** Sin esta cantidad de llegadas no se opina: con tres marcas no hay ritmo. */
const MINIMO_DE_LLEGADAS = 6

/**
 * Cuántas veces la cadencia habitual hay que superar para marcarlo.
 *
 * Cuatro es holgado a propósito. Esto no busca detectar una demora: busca
 * detectar que algo SE CORTÓ, y para eso conviene equivocarse para el lado de
 * no avisar. Un falso positivo acá cuesta caro —enseña a ignorar la pantalla—
 * y un retraso de un rato en detectar un corte no cambia nada.
 */
const FACTOR = 4

/**
 * Piso absoluto. Sin esto, una plantilla que llega cada diez segundos en una
 * ráfaga de recordatorios se marcaría a los cuarenta segundos de silencio, que
 * es normalísimo apenas termina la tanda.
 */
const SILENCIO_MINIMO_MS = 45 * 60 * 1000

export interface Cadencia {
  /** Cada cuántos milisegundos suele llegar. `null` si no hay datos suficientes. */
  habitualMs: number | null
  /** Hace cuánto que no llega. */
  silencioMs: number | null
  /** Venía llegando con regularidad y se cortó. */
  seCorto: boolean
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

/**
 * @param llegadas Marcas de tiempo, de la más nueva a la más vieja.
 */
export function calcularCadencia(llegadas: number[], ahora: number = Date.now()): Cadencia {
  if (!llegadas || llegadas.length === 0) {
    return { habitualMs: null, silencioMs: null, seCorto: false }
  }

  const silencioMs = Math.max(0, ahora - llegadas[0])

  if (llegadas.length < MINIMO_DE_LLEGADAS) {
    return { habitualMs: null, silencioMs, seCorto: false }
  }

  const intervalos: number[] = []
  for (let i = 0; i < llegadas.length - 1; i++) {
    const d = llegadas[i] - llegadas[i + 1]
    if (d > 0) intervalos.push(d)
  }

  if (intervalos.length === 0) {
    return { habitualMs: null, silencioMs, seCorto: false }
  }

  const habitualMs = mediana(intervalos)
  const umbral = Math.max(habitualMs * FACTOR, SILENCIO_MINIMO_MS)

  return { habitualMs, silencioMs, seCorto: silencioMs > umbral }
}

/** "cada 20 minutos", "cada 3 horas". Para el texto del tablero. */
export function describirIntervalo(ms: number): string {
  const minutos = Math.round(ms / 60000)
  if (minutos < 1) return "cada menos de un minuto"
  if (minutos < 60) return `cada ~${minutos} ${minutos === 1 ? "minuto" : "minutos"}`

  const horas = Math.round(minutos / 60)
  if (horas < 24) return `cada ~${horas} ${horas === 1 ? "hora" : "horas"}`

  const dias = Math.round(horas / 24)
  return `cada ~${dias} ${dias === 1 ? "día" : "días"}`
}

/** "hace 4 horas", "hace 2 días". */
export function describirSilencio(ms: number): string {
  const minutos = Math.round(ms / 60000)
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`

  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`

  const dias = Math.round(horas / 24)
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`
}
