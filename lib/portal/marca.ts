/**
 * Cómo se ve el portal para cada clínica (22/9/2026).
 *
 * Reusa los campos de marca que cada cliente ya cargó para el widget web. No se
 * agregan campos nuevos a propósito: si mañana la clínica cambia su color, lo
 * cambia en un solo lugar y queda igual en los dos lados.
 *
 * Importa más de lo que parece. El paciente llega acá desde WhatsApp, a un
 * dominio que no conoce, para gestionar un turno médico. Que vea el nombre de
 * su clínica arriba es lo que separa "esto es de ellos" de "esto es raro, mejor
 * no pongo nada".
 */

import type { WhatsAppConfig } from "../types"

export interface MarcaDelPortal {
  clinica: string
  colorPrimario: string
  colorSecundario: string
}

const COLOR_PRIMARIO_POR_DEFECTO = "#0ea5e9"
const COLOR_SECUNDARIO_POR_DEFECTO = "#f0f9ff"

/** Un color hexadecimal válido, o el de por defecto. Lo que llega es de una config editable a mano. */
function color(valor: string | undefined, porDefecto: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(valor || "") ? (valor as string) : porDefecto
}

export function marcaDelPortal(config?: Partial<WhatsAppConfig> | null): MarcaDelPortal {
  return {
    clinica: config?.displayName?.trim() || "tu clínica",
    colorPrimario: color(config?.widgetPrimaryColor, COLOR_PRIMARIO_POR_DEFECTO),
    colorSecundario: color(config?.widgetSecondaryColor, COLOR_SECUNDARIO_POR_DEFECTO),
  }
}
