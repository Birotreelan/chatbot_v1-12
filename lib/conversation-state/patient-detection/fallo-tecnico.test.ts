/**
 * lib/conversation-state/patient-detection/fallo-tecnico.test.ts
 *
 * Protege la distinción entre "consultamos y el paciente no está" y "no pudimos
 * consultar" (14/9/2026).
 *
 * Las dos llegaban como `exito: false` y se resolvían en la misma rama, así que
 * un timeout contra el proxy de la clínica daba por inexistente a un paciente y
 * lo mandaba al alta como si fuera nuevo — dejando un duplicado en la base de la
 * clínica. El caso real: ETIMEDOUT el 8/9/2026 con el DNI 29171192.
 *
 * Es el tipo de falla que NO se ve en la conversación: el paciente completa el
 * alta sin notar nada raro y el duplicado aparece semanas después, del lado de
 * la clínica. Por eso conviene que quede clavado en un test.
 */

import { describe, it, expect } from 'vitest'
import { esFalloTecnicoDeBackend } from './patient-flow-handler'

describe('esFalloTecnicoDeBackend', () => {
  it('un error de red es fallo técnico: no sabemos si el paciente existe', () => {
    // Forma real que devuelve clinic-api ante un ETIMEDOUT.
    expect(
      esFalloTecnicoDeBackend({ exito: false, error: { codigo: 'ERROR_RED', mensaje: 'fetch failed' } as any }),
    ).toBe(true)
  })

  it('un error HTTP del proxy también es fallo técnico', () => {
    expect(esFalloTecnicoDeBackend({ exito: false, error: { codigo: 'HTTP_500' } })).toBe(true)
    expect(esFalloTecnicoDeBackend({ exito: false, error: { codigo: 'HTTP_502' } })).toBe(true)
  })

  it('"paciente no encontrado" NO es fallo técnico: ahí sí sabemos', () => {
    // Este caso debe seguir yendo al alta de paciente nuevo, como hasta ahora.
    expect(esFalloTecnicoDeBackend({ exito: false, error: { codigo: 'API_ERROR' } })).toBe(false)
  })

  it('una respuesta exitosa nunca es fallo técnico', () => {
    expect(esFalloTecnicoDeBackend({ exito: true })).toBe(false)
    // Incluso si por algún motivo viniera un código de error adjunto.
    expect(esFalloTecnicoDeBackend({ exito: true, error: { codigo: 'ERROR_RED' } })).toBe(false)
  })

  it('sin código de error no se asume fallo técnico', () => {
    // Ante la duda, el comportamiento previo: no bloquear el flujo del paciente.
    expect(esFalloTecnicoDeBackend({ exito: false })).toBe(false)
    expect(esFalloTecnicoDeBackend({ exito: false, error: {} })).toBe(false)
  })
})
