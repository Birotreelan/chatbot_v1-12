/**
 * El comentario del turno cuando el paciente corrige su cobertura
 * (27/11/2026).
 *
 * ── Por qué hace falta un comentario ──────────────────────────────────────
 *
 * El proxy tiene tres acciones de escritura —`set_turno`, `confirmar_turno`,
 * `cancelar_turno`— y ninguna modifica la ficha de un paciente. Así que cuando
 * alguien corrige su obra social desde el portal, el dato nuevo viaja en el
 * turno y la ficha sigue diciendo lo de antes. La próxima vez que entre, el
 * portal le va a volver a mostrar la cobertura vieja.
 *
 * El comentario es lo único que cierra ese circuito: es el aviso para que
 * alguien de la clínica actualice la ficha a mano.
 *
 * ── Por qué explícito, y qué significa explícito acá ──────────────────────
 *
 * Pedido de Nicolás: "lo más explícito posible". Y hay un motivo concreto para
 * que no sea una frase corta: el que lo lee está mirando una agenda con
 * cuarenta turnos, no investigando este caso. Un comentario que dice "el
 * paciente modificó sus datos" lo obliga a abrir la ficha para ver qué cambió;
 * uno que dice qué había y qué declaró se entiende de una sola lectura y se
 * resuelve sin salir de la agenda.
 *
 * Así que se nombran las dos puntas —lo declarado y lo que figura— y se
 * aclara que la ficha NO se tocó, que es la parte que alguien tiene que hacer.
 *
 * ── Se concatena, no reemplaza ────────────────────────────────────────────
 *
 * `comentarioParaLaReserva` ya resuelve el comentario de reagendamiento y
 * conserva el del llamador. Esto entra por ahí, así que un turno que es
 * reagendamiento Y trae cobertura corregida sale con los dos avisos. Era así
 * desde el 26/10 y por eso este módulo no toca nada de eso.
 */

export interface CoberturaDeclarada {
  /** Lo que el paciente eligió en el portal. */
  obraSocialNombre?: string | null
  nroAfiliado?: string | null
  /** Lo que decía la ficha de la clínica antes. */
  deLaFicha?: {
    obraSocialNombre?: string | null
    nroAfiliado?: string | null
  } | null
}

function limpio(valor?: string | null): string {
  return String(valor || "").trim()
}

/**
 * El texto para `Comentarios`, o `null` si no hay nada que avisar.
 *
 * `null` cuando el paciente no cambió nada: el caso normal es que acepte lo que
 * la ficha ya decía, y un comentario en cada turno reservado lo volvería ruido
 * que nadie lee —que es la forma más segura de que, el día que diga algo
 * importante, tampoco lo lean—.
 */
export function comentarioDeLaCobertura(datos: CoberturaDeclarada): string | null {
  const obraDeclarada = limpio(datos.obraSocialNombre)
  const afiliadoDeclarado = limpio(datos.nroAfiliado)
  const obraDeLaFicha = limpio(datos.deLaFicha?.obraSocialNombre)
  const afiliadoDeLaFicha = limpio(datos.deLaFicha?.nroAfiliado)

  const cambióLaObra = Boolean(obraDeclarada) && obraDeclarada !== obraDeLaFicha
  const cambióElAfiliado = Boolean(afiliadoDeclarado) && afiliadoDeclarado !== afiliadoDeLaFicha

  if (!cambióLaObra && !cambióElAfiliado) return null

  const partes: string[] = ["DATOS CORREGIDOS POR EL PACIENTE DESDE EL PORTAL."]

  if (cambióLaObra) {
    partes.push(
      obraDeLaFicha
        ? `Obra social: declaró "${obraDeclarada}" y en su ficha figura "${obraDeLaFicha}".`
        : `Obra social: declaró "${obraDeclarada}" (en su ficha no figuraba ninguna).`,
    )
  }

  if (cambióElAfiliado) {
    partes.push(
      afiliadoDeLaFicha
        ? `N° de afiliado: declaró ${afiliadoDeclarado} y en su ficha figura ${afiliadoDeLaFicha}.`
        : `N° de afiliado: declaró ${afiliadoDeclarado} (en su ficha no figuraba).`,
    )
  }

  // La última línea es la que convierte el aviso en una tarea. Sin esto, el
  // comentario describe algo que ya pasó y no dice qué falta hacer.
  partes.push("La ficha NO se modificó: hay que actualizarla a mano si corresponde.")

  return partes.join(" ")
}
