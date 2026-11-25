/**
 * ¿En esta clínica el texto lo escribe la IA? (25/11/2026)
 *
 * ── `=== true`, o sea apagado por defecto ──────────────────────────────────
 *
 * Mismo criterio que `atencionPorChatWeb` y por el mismo motivo: los switches
 * que son opciones de una pantalla arrancan encendidos, porque que aparezca el
 * campo no tiene que cambiarle nada a nadie. Éste cambia quién escribe lo que
 * 25 clínicas le dicen a sus pacientes, así que arranca apagado y se prende de
 * a una.
 *
 * El plan lo dice así: "Arranca en una clínica chica, con el switch por cliente
 * que ya existe para todo lo demás. Si algo sale mal, se apaga en diez
 * segundos."
 *
 * ── Y una llave general, para apagar todo sin entrar al panel ─────────────
 *
 * `REDACCION_IA_APAGADA=1` apaga la redacción en todos los clientes a la vez,
 * sin deploy y sin tocar ninguna configuración. Es la misma idea que
 * `EXIGIR_LLAVE_DE_ENTRADA` pero al revés: ahí la variable cierra una puerta,
 * acá apaga una función. Existe porque el daño posible de esta capa es que un
 * paciente lea algo mal escrito sobre su turno médico, y en ese caso no se
 * quiere estar buscando qué clínica tenía el switch prendido.
 */
export function laIaRedacta(config?: { laIaRedacta?: boolean } | null): boolean {
  if (process.env.REDACCION_IA_APAGADA === "1") return false
  return config?.laIaRedacta === true
}
