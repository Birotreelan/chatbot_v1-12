/**
 * El texto del motor, adaptado al chat del enlace (14/10/2026).
 *
 * El motor conversacional redacta para WhatsApp: usa `*negrita*` y termina
 * varios mensajes con una línea tipo "0. *Volver al paso anterior*", porque en
 * WhatsApp el paciente contesta escribiendo un número.
 *
 * ── Qué se hace con cada cosa ──────────────────────────────────────────────
 *
 * La negrita se CONSERVA y se dibuja como negrita (ver `tramos`). El widget de
 * la web borra los asteriscos (`cleanBackendText`, en widget-form-flow.ts), y
 * ahí tiene sentido porque muestra el texto en un `alert` que no formatea nada.
 * Acá no: los textos del motor usan la negrita
 * para destacar el día y la hora de un turno, que es justo el dato que el
 * paciente relee antes de confirmar.
 *
 * La pista de "0. Volver" se BORRA cuando el chat ya dibuja ese botón. Dejarla
 * sería pedirle al paciente que escriba un número al lado del botón que hace
 * lo mismo — y el que escriba "0" cuando el botón no está (porque el motor no
 * lo ofreció en ese paso) manda al motor algo que no espera.
 *
 * Es un módulo puro: lo importan el servidor (para guardar la transcripción ya
 * limpia) y el cliente (para dibujar la negrita).
 */

/**
 * Saca la línea final que ofrece volver escribiendo un número.
 *
 * Sólo la ÚLTIMA línea y sólo si empieza con "0.": el motor la pone siempre al
 * final. Buscarla en cualquier parte del texto se comería una línea legítima
 * de una lista de turnos.
 */
export function sinPistaDeVolver(texto: string): string {
  return texto
    .replace(/\n+0\.\s*\*?Volver[^\n*]*\*?\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export interface TramoDeTexto {
  texto: string
  negrita: boolean
}

/**
 * Parte el texto en tramos normales y en negrita.
 *
 * `*así*`, como en WhatsApp. Se devuelven tramos y no HTML a propósito: el
 * texto viene del motor y pasa por el proxy de la clínica, así que armar HTML
 * acá sería abrir la puerta a que un nombre con `<` termine inyectado. React
 * escapa cada tramo solo.
 *
 * Un `*` suelto —sin su par— se deja como está: es texto, no formato.
 */
export function tramos(texto: string): TramoDeTexto[] {
  const partes: TramoDeTexto[] = []
  // `[^*\n]+` y no `.+?`: en WhatsApp la negrita no cruza saltos de línea, y
  // sin esa restricción dos asteriscos de párrafos distintos se emparejan y
  // marcan en negrita todo lo que hay en el medio.
  const patron = /\*([^*\n]+)\*/g

  let ultimo = 0
  let encontrado: RegExpExecArray | null
  while ((encontrado = patron.exec(texto)) !== null) {
    if (encontrado.index > ultimo) {
      partes.push({ texto: texto.slice(ultimo, encontrado.index), negrita: false })
    }
    partes.push({ texto: encontrado[1], negrita: true })
    ultimo = encontrado.index + encontrado[0].length
  }

  if (ultimo < texto.length) {
    partes.push({ texto: texto.slice(ultimo), negrita: false })
  }

  return partes
}
