/**
 * Lo que la observación de Servicio tiene de puro (16/10/2026).
 *
 * Está separado de `lib/servicio-observaciones.ts` por el mismo motivo que
 * `lib/reapertura-texto.ts` lo está de `lib/reapertura.ts`: aquel importa
 * `@upstash/redis` en el tope del módulo, y la tabla que muestra este campo es
 * un componente de cliente. Importar el módulo con Redis desde el navegador
 * arrastraría el cliente de Redis al bundle.
 *
 * El tope vive en un solo lugar a propósito: lo usa el `maxLength` del input y
 * el recorte del servidor. Si fueran dos números, el día que alguien cambie uno
 * el campo dejaría escribir más de lo que se guarda, y el texto se cortaría sin
 * que nadie entienda por qué.
 */

/** Tope del texto. Es una nota al margen, no un documento. */
export const OBSERVACION_MAX = 280
