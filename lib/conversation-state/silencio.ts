/**
 * Cuándo NO responder (29/9/2026, recortado el 12/11/2026).
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Desde el 1/10 Meta cobra por mensaje enviado y no por conversación. Hasta
 * entonces el bot contestaba siempre: un "gracias!" costaba lo mismo que dar
 * un turno.
 *
 * ── Queda una sola regla ───────────────────────────────────────────────────
 *
 * **Cierres conversacionales.** "Gracias", "chau", "perfecto". No se responde.
 * La clasificación la hace el dispatcher, que ya distingue un agradecimiento
 * suelto de uno con una pregunta pegada; acá sólo se decide qué hacer con esa
 * clasificación. Un regex de /gracias|chau/ trataría igual a "gracias!!" y a
 * "gracias, ¿y la dirección?".
 *
 * ── Las dos que se quitaron, y por qué ─────────────────────────────────────
 *
 * Había otras dos, las dos sobre repetir:
 *
 *  · "una vez por ventana" (`yaSeDijo`/`anotarQueSeDijo`): un mensaje marcado
 *    con una etiqueta —derivación, cancelación no permitida, datos de
 *    contacto— no se repetía por 24 h.
 *  · "idéntica a la anterior" (`esIdenticoALoUltimo`): no salía un texto igual
 *    al último enviado, sin nada en el medio.
 *
 * Ahorraban mensajes, pero las dos cobraban lo mismo: el paciente que vuelve a
 * preguntar algo que ya le contestamos recibía silencio, y desde afuera el
 * silencio no se distingue de un número que no funciona. Se decidió pagar el
 * mensaje repetido.
 *
 * La diferencia con la regla que queda: un cierre conversacional no es una
 * repetición. Es un mensaje que no hace falta ni la primera vez —el paciente
 * dijo "gracias" para terminar, no para que le contesten— así que callarlo no
 * le quita nada.
 *
 * El código de las dos está en el historial de git: buscar
 * `esIdenticoALoUltimo` antes del 12/11/2026.
 *
 * ── Sólo en clientes del portal ────────────────────────────────────────────
 *
 * En esos clientes el paciente tiene el enlace y los botones: si el bot se
 * calla, le quedan caminos a la vista. En el resto, el chat es el único camino
 * y el silencio se lee como "no funciona".
 */

export type MotivoDelSilencio = "cierre_conversacional"

/**
 * ¿Este cliente usa el silencio?
 *
 * Se lee de la config ya cargada, no de Redis: el llamador siempre la tiene a
 * mano y agregar una lectura en el camino caliente del webhook por un booleano
 * no se paga.
 */
export function usaSilencio(config: { clientePortalWeb?: boolean } | null | undefined): boolean {
  return config?.clientePortalWeb === true
}

/**
 * Deja constancia de un mensaje que no se envió.
 *
 * No es decorativo. Un bot que responde de más se nota; uno que se calla de
 * más, no: no hay excepción, no hay log de error, y en el panel la
 * conversación se ve igual que una donde el paciente no volvió a escribir. Sin
 * esta línea, el día que una clasificación falle nos enteramos por un reclamo.
 *
 * Se registra el motivo y el principio del texto, que es lo que hace falta para
 * revisar después si lo que se calló había que callarlo.
 */
export function registrarSilencio(params: {
  configId: string
  phoneNumber: string
  motivo: MotivoDelSilencio
  texto?: string
  detalle?: string
}): void {
  const recorte = (params.texto || "").replace(/\s+/g, " ").trim().slice(0, 120)
  console.log(
    `[SILENCIO] No se respondió a ${params.phoneNumber} (${params.motivo}` +
      `${params.detalle ? `: ${params.detalle}` : ""})` +
      `${recorte ? ` — se iba a enviar: "${recorte}"` : ""}`,
  )
}
