/**
 * ¿Esta clínica atiende por el chat web? (5/11/2026)
 *
 * Un solo lugar que lo decide, por el mismo motivo que
 * `ofreceTurnosParticulares`: hay dos puntas que tienen que contestar lo
 * mismo —por dónde sale el mensaje del agente, y qué recibe el paciente— y si
 * se desincronizan, el agente escribe a un lado y el paciente mira el otro,
 * sin que nada falle visiblemente.
 *
 * ── `=== true`, no `!== false` ─────────────────────────────────────────────
 *
 * Al revés que los otros switches del proyecto. Los demás son opciones de una
 * pantalla y arrancan encendidos: que aparezca el campo no tiene que
 * apagárselos a nadie. Éste cambia cómo se atiende a un paciente, así que
 * arranca apagado: que aparezca el campo tampoco tiene que prendérselo a
 * nadie.
 */
export function atencionPorChatWeb(
  config?: { atencionPorChatWeb?: boolean } | null,
): boolean {
  return config?.atencionPorChatWeb === true
}
