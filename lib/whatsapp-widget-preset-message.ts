/**
 * Detección del mensaje predefinido que manda el botón flotante de WhatsApp
 * (public/whatsapp-widget-loader.js, buildPresetMessage). Cuando un mensaje
 * entrante coincide EXACTO con ese texto, sabemos con certeza que viene de
 * ese widget — no hace falta pasarlo por OpenAI para entender la intención,
 * ya la conocemos: el paciente quiere agendar un turno.
 *
 * IMPORTANTE: si se cambia el texto en whatsapp-widget-loader.js hay que
 * actualizar buildExpectedPresetMessage acá también (se mantienen manualmente
 * en sync, no comparten código porque uno corre en el navegador y el otro en
 * el server).
 */

// Debe coincidir EXACTO con buildPresetMessage() en public/whatsapp-widget-loader.js
function buildExpectedPresetMessage(clinicName?: string): string {
  const clinicLabel = clinicName ? clinicName : "la clínica"
  return `¡Hola ${clinicLabel}! Quiero agendar un turno.`
}

// Normaliza espacios (colapsa múltiples espacios/whitespace raro que a veces
// inserta WhatsApp al copiar el texto prellenado) sin tocar tildes ni
// mayúsculas — el texto exacto sí importa para evitar falsos positivos.
function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

/**
 * Devuelve true si `message` es (o es "prácticamente") el texto predefinido
 * del widget de WhatsApp para la clínica `clinicName`.
 *
 * Compara contra el nombre de la clínica configurado (config.displayName) Y
 * contra el fallback genérico ("la clínica"), porque el widget usa ese
 * fallback si displayName no está seteado en el momento en que se cargó el
 * botón.
 */
export function isWhatsAppWidgetPresetMessage(message: string, clinicName?: string): boolean {
  if (typeof message !== "string" || !message.trim()) return false
  const normalizedIncoming = normalizeForComparison(message)

  const candidates = new Set<string>([
    normalizeForComparison(buildExpectedPresetMessage(clinicName)),
    normalizeForComparison(buildExpectedPresetMessage(undefined)),
  ])

  return candidates.has(normalizedIncoming)
}
