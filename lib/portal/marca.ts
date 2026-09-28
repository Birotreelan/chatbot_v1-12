/**
 * Cómo se ve el portal para cada clínica (22/9/2026).
 *
 * Importa más de lo que parece. El paciente llega acá desde WhatsApp, a un
 * dominio que no conoce, para gestionar un turno médico. Que vea el nombre de
 * su clínica arriba es lo que separa "esto es de ellos" de "esto es raro, mejor
 * no pongo nada".
 *
 * ── Los colores salieron de acá (28/9/2026) ────────────────────────────────
 *
 * Hasta hoy esto devolvía también el color primario y el secundario que cada
 * cliente había cargado para su widget, y el portal se pintaba con ellos.
 * Ahora el portal usa los tokens del sistema de diseño, cuyos valores pasaron
 * una auditoría de contraste; un hexadecimal escrito a mano en un formulario
 * no pasó ninguna, y un color claro sobre blanco dejaba texto ilegible justo
 * en el público que peor ve.
 *
 * Los campos se borraron en vez de dejarlos sin uso: un `colorPrimario` que
 * nadie lee es una promesa rota esperando a que alguien la descubra cambiando
 * el color en el dashboard y mirando el portal sin entender por qué no pasa
 * nada.
 *
 * `widgetPrimaryColor` y `widgetSecondaryColor` siguen existiendo y siguen
 * mandando en el widget web, que es de donde salieron.
 */

import type { WhatsAppConfig } from "../types"

export interface MarcaDelPortal {
  clinica: string
}

export function marcaDelPortal(config?: Partial<WhatsAppConfig> | null): MarcaDelPortal {
  return {
    clinica: config?.displayName?.trim() || "tu clínica",
  }
}
