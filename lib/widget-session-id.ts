/**
 * Genera un session_id para los widgets públicos (chat/formulario embebidos).
 *
 * SEGURIDAD: antes se armaba con `Math.random()`, que no es un generador
 * criptográficamente seguro y da ~46 bits de entropía. Como el backend
 * confía en el session_id que manda el cliente para identificar la
 * conversación (incluye DNI/nombre/teléfono ya cargados), usamos
 * `crypto.randomUUID()` (122 bits de entropía, no determinístico) para que
 * adivinarlo o fuerza-bruteo sea inviable. Fallback a `getRandomValues` para
 * navegadores muy viejos sin `randomUUID`.
 */
export function newWidgetSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `web_${crypto.randomUUID()}`
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    return `web_${hex}`
  }
  // Último recurso (no debería alcanzarse en un navegador moderno)
  return `web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
