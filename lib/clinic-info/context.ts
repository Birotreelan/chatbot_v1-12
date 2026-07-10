/**
 * Utilidades de la base de conocimiento institucional (10/7/2026):
 * - hash de contenido, para detectar cuándo cambió el sitio en un re-import.
 * - formateo de ClinicInfo a un bloque de texto para el contexto del AI
 *   dispatcher (lib/conversation-state/ai-dispatcher/context-builder.ts).
 */

import { createHash } from "node:crypto"
import type { ClinicInfo } from "@/lib/types"

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * Convierte la info guardada de la clínica en un bloque de texto legible
 * para el system prompt del dispatcher. Sólo incluye lo que efectivamente
 * está cargado — nunca rellena huecos, para no darle pie a la IA a inventar
 * lo que falta.
 */
export function formatClinicInfoForLLM(info: ClinicInfo | null): string {
  if (!info) {
    return "INFORMACIÓN DE LA CLÍNICA: no cargada todavía en el sistema."
  }

  const lines: string[] = ["INFORMACIÓN DE LA CLÍNICA (usar SOLO estos datos, nunca inventar lo que falte):"]

  if (info.sedes && info.sedes.length > 0) {
    info.sedes.forEach((sede, i) => {
      const parts = [sede.nombre, sede.direccion, sede.horario, sede.comoLlegar].filter(Boolean)
      if (parts.length > 0) lines.push(`- Sede ${i + 1}: ${parts.join(" | ")}`)
    })
  }
  if (info.horarioAtencion) lines.push(`- Horario de atención general: ${info.horarioAtencion}`)
  if (info.telefonoContacto) lines.push(`- Teléfono de contacto: ${info.telefonoContacto}`)
  if (info.emailContacto) lines.push(`- Email de contacto: ${info.emailContacto}`)
  if (info.especialidades && info.especialidades.length > 0) {
    lines.push(`- Especialidades: ${info.especialidades.join(", ")}`)
  }
  if (info.profesionales && info.profesionales.length > 0) {
    lines.push(
      `- Profesionales: ${info.profesionales.map((p) => (p.especialidad ? `${p.nombre} (${p.especialidad})` : p.nombre)).join(", ")}`,
    )
  }
  if (info.equipamiento && info.equipamiento.length > 0) {
    lines.push(`- Equipamiento: ${info.equipamiento.join(", ")}`)
  }
  if (info.obrasSociales && info.obrasSociales.length > 0) {
    lines.push(`- Obras sociales/prepagas aceptadas: ${info.obrasSociales.join(", ")}`)
  }
  if (info.instruccionesPreConsulta) lines.push(`- Instrucciones previas a la consulta: ${info.instruccionesPreConsulta}`)
  if (info.cuidadosPostOperatorios) lines.push(`- Cuidados post-operatorios generales: ${info.cuidadosPostOperatorios}`)
  if (info.informacionAdicional) lines.push(`- Información adicional: ${info.informacionAdicional}`)

  if (lines.length === 1) {
    return "INFORMACIÓN DE LA CLÍNICA: cargada pero sin datos en ningún campo todavía."
  }

  return lines.join("\n")
}
