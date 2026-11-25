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

  /**
   * ── Los cuatro bloques más preguntados (25/11/2026) ─────────────────────
   *
   * Van en el bloque del contexto con el mismo criterio que lo de arriba: sólo
   * lo que está cargado, nunca un hueco rellenado. Y con el nombre del tema
   * adelante, porque el modelo tiene que poder decir "eso no lo tengo" en vez
   * de contestar con el campo de al lado.
   *
   * Qué de esto puede REPETIRLE al paciente no se decide acá: lo decide
   * `camposQueElBotPuedeContestar` en answer.ts. Este bloque es contexto —sirve
   * para que entienda de qué le están hablando— y eso vale para todo lo
   * cargado.
   */
  if (info.guardia) {
    const g = info.guardia
    const partes = [
      g.disponible === false ? "NO tiene guardia oftalmológica" : g.disponible === true ? "tiene guardia" : "",
      g.horarios ? `horarios: ${g.horarios}` : "",
      g.porOrdenDeLlegada === true
        ? "se atiende por orden de llegada, sin turno"
        : g.porOrdenDeLlegada === false
          ? "la guardia también requiere turno"
          : "",
      g.sede ? `funciona en: ${g.sede}` : "",
      g.queSeAtiende ? `se atiende: ${g.queSeAtiende}` : "",
      g.queNoSeAtiende ? `NO se atiende por guardia: ${g.queNoSeAtiende}` : "",
    ].filter(Boolean)
    if (partes.length > 0) lines.push(`- Guardia / urgencias: ${partes.join(" | ")}`)
  }

  if (info.coberturas && info.coberturas.length > 0) {
    lines.push(`- Coberturas, con plan y copago:`)
    for (const c of info.coberturas) {
      const detalle = [
        c.planes?.length ? `planes: ${c.planes.join(", ")}` : "",
        c.planesNoAceptados?.length ? `NO se aceptan: ${c.planesNoAceptados.join(", ")}` : "",
        c.requiereOrden === true ? "requiere orden" : c.requiereOrden === false ? "sin orden" : "",
        c.copago ? `copago: ${c.copago}` : "",
        c.comoAutorizar ? `autorización: ${c.comoAutorizar}` : "",
      ].filter(Boolean)
      lines.push(`  · ${c.nombre}${detalle.length ? ` — ${detalle.join(" | ")}` : ""}`)
    }
  }

  if (info.ordenesYAutorizaciones) {
    const o = info.ordenesYAutorizaciones
    const partes = [
      o.hacenFalta === true ? "en general hace falta orden" : o.hacenFalta === false ? "no hace falta orden" : "",
      o.comoObtenerla ? `cómo obtenerla: ${o.comoObtenerla}` : "",
      o.aNombreDe ? `a nombre de: ${o.aNombreDe}` : "",
      o.codigos ? `códigos de prestación: ${o.codigos}` : "",
      o.siNoLaTrae ? `si el paciente no la trae: ${o.siNoLaTrae}` : "",
    ].filter(Boolean)
    if (partes.length > 0) lines.push(`- Órdenes y autorizaciones: ${partes.join(" | ")}`)
  }

  if (info.aranceles) {
    const a = info.aranceles
    const partes = [
      a.consultaParticular ? `consulta particular: ${a.consultaParticular}` : "",
      a.mediosDePago?.length ? `medios de pago: ${a.mediosDePago.join(", ")}` : "",
      a.financiacion ? `financiación: ${a.financiacion}` : "",
      a.facturacion ? `facturación: ${a.facturacion}` : "",
      a.vigenciaDeclarada ? `precios vigentes: ${a.vigenciaDeclarada}` : "",
    ].filter(Boolean)
    if (partes.length > 0) lines.push(`- Aranceles y pagos: ${partes.join(" | ")}`)
  }

  if (info.estudios && info.estudios.length > 0) {
    lines.push(`- Estudios:`)
    for (const e of info.estudios) {
      const detalle = [
        e.requiereOrden === true ? "requiere orden" : e.requiereOrden === false ? "sin orden" : "",
        // Lo más importante de todo el bloque: si dilata, no puede manejar al
        // volver, y hoy el paciente se entera cuando ya está acá.
        e.dilata === true ? "DILATA la pupila: el paciente no puede manejar después" : e.dilata === false ? "no dilata" : "",
        e.duracion ? `dura ${e.duracion}` : "",
        e.preparacion ? `preparación: ${e.preparacion}` : "",
        e.sinConsultaPrevia === true
          ? "se puede hacer sin consulta previa"
          : e.sinConsultaPrevia === false
            ? "requiere consulta previa con el profesional"
            : "",
        e.arancelParticular ? `particular: ${e.arancelParticular}` : "",
      ].filter(Boolean)
      lines.push(`  · ${e.nombre}${detalle.length ? ` — ${detalle.join(" | ")}` : ""}`)
    }
  }

  if (info.informacionAdicional) lines.push(`- Información adicional: ${info.informacionAdicional}`)

  if (lines.length === 1) {
    return "INFORMACIÓN DE LA CLÍNICA: cargada pero sin datos en ningún campo todavía."
  }

  return lines.join("\n")
}
