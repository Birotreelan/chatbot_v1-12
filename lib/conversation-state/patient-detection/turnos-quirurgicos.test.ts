/**
 * lib/conversation-state/patient-detection/turnos-quirurgicos.test.ts
 *
 * buildTurnosQuirurgicosInfo se extrajo de buildSoloCirugiaGreeting el
 * 10/9/2026 para poder reusarlo desde el router (caso María Gladys Noguera,
 * tel. 1169503625: sólo tenía cirugía agendada y se le respondió "tu turno ya
 * está agendado, todavía no hace falta que confirmes").
 *
 * Dos cosas que este test protege:
 *
 *  1. Que la extracción no cambió el texto. Es una refactorización de un
 *     mensaje que ya estaba aprobado y en producción.
 *  2. Que los nombres de campo REALES de la API siguen leyéndose. La respuesta
 *     de get_paciente usa `cirugia_nombre` y `cirujano` en minúscula — no
 *     `Profesional_Nombre` ni `sede`, como un turno médico. Asumir la forma
 *     equivocada ya rompió una vez (8/9/2026).
 *
 * La regla de gestión va SIEMPRE pegada al detalle: mostrar los datos de una
 * cirugía sin aclarar que no se gestiona por este canal invita al paciente a
 * intentar confirmarla acá.
 */

import { describe, it, expect } from 'vitest'
import { buildTurnosQuirurgicosInfo } from './patient-templates'

/** Cirugía real devuelta por get_paciente (tel. 1169503625), sin el campo `observ`. */
const CIRUGIA_REAL = {
  id: '237621',
  fecha: '2026-09-11',
  hora: '08:30:00',
  cirugia_nombre: 'FACOVITRECTOMIA SIMPLE POR ',
  ojo: 'OI',
  cirujano: 'RODRIGUEZ RODRIGO ',
  quirofano: 'ONE VISION',
  Estado_Texto: 'Programada',
}

describe('buildTurnosQuirurgicosInfo', () => {
  it('lee los nombres de campo reales de la API', () => {
    const info = buildTurnosQuirurgicosInfo([CIRUGIA_REAL])

    expect(info).toContain('Facovitrectomia Simple Por')
    expect(info).toContain('Rodriguez Rodrigo')
    // La fecha se formatea a texto legible, no se muestra el ISO crudo.
    expect(info).not.toContain('2026-09-11')
    expect(info).toContain('septiembre')
  })

  it('siempre incluye la regla de gestión junto al detalle', () => {
    const info = buildTurnosQuirurgicosInfo([CIRUGIA_REAL])
    expect(info).toContain('debe realizarse comunicándote directamente con la clínica')
  })

  it('nunca filtra las notas clínicas internas', () => {
    // `observ` trae comorbilidades y notas del quirófano. Aunque el mapeo previo
    // debería haberlo descartado, si alguna vez llega igual no puede terminar
    // en el mensaje al paciente.
    const conObserv = { ...CIRUGIA_REAL, observ: 'CNN OP OK. LENTE PONE QUIROFANO - OI: 20.50D' }
    const info = buildTurnosQuirurgicosInfo([conObserv])

    expect(info).not.toContain('20.50D')
    expect(info).not.toContain('CNN OP OK')
  })

  it('enumera cuando hay más de una cirugía', () => {
    const info = buildTurnosQuirurgicosInfo([CIRUGIA_REAL, { ...CIRUGIA_REAL, id: '237622' }])
    expect(info).toContain('2 turnos de cirugía agendados')
    expect(info).toContain('1. Cirugía:')
    expect(info).toContain('2. Cirugía:')
  })

  it('sin cirugías devuelve vacío, para no dejar un bloque colgado', () => {
    expect(buildTurnosQuirurgicosInfo([])).toBe('')
    expect(buildTurnosQuirurgicosInfo(undefined as any)).toBe('')
  })
})
