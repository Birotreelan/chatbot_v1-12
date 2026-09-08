/**
 * lib/conversation-state/wrong-number-handler.test.ts
 *
 * Protege la distinción entre DOS mensajes casi idénticos con consecuencias
 * opuestas (8/9/2026):
 *
 *   "Este celular no es de Orozco Marta"  → Orozco Marta es LA MÉDICA que figura
 *                                            en el recordatorio. El paciente
 *                                            confundió el nombre; el turno SÍ es
 *                                            suyo. Hay que aclararle quién es
 *                                            quién.
 *   "Este celular no es de Elsa Silva"    → Elsa Silva es LA TITULAR. Acá la
 *                                            negación es genuina: número
 *                                            equivocado.
 *
 * Los dos matchean el mismo patrón regex (`este celular no es...`), así que sin
 * mirar de QUIÉN es el nombre son indistinguibles. En producción el primero se
 * trató como número equivocado: se marcó el teléfono por 24 horas y se le avisó
 * que dejaría de recibir avisos de un turno que era suyo.
 *
 * Esto corre en `pnpm test`: es determinístico, gratis y no toca la red.
 */

import { describe, it, expect } from 'vitest'
import { detectWrongNumberPreFlow } from './wrong-number-handler'

const DATOS_TURNO = {
  profesional: 'OROZCO MARTA',
  titular: 'ELSA SILVA',
}

/** Sin Redis disponible, setWrongPersonState es un no-op — no afecta al test. */
async function detectar(mensaje: string) {
  return detectWrongNumberPreFlow(mensaje, '1141898093', 'test-config', true, DATOS_TURNO)
}

describe('Número equivocado vs. confusión con el nombre del profesional', () => {
  it('negar el nombre del PROFESIONAL no es número equivocado: se aclara', async () => {
    const r = await detectar('Este celular no es de Orozco Marta')

    expect(r.isWrongNumber).toBe(false)
    // Tiene que responder algo: si cede en silencio, el mensaje sigue por el
    // pipeline y el paciente se queda sin la aclaración que necesitaba.
    expect(r.response).toBeTruthy()
    expect(r.response).toContain('OROZCO MARTA')
    expect(r.response).toContain('ELSA SILVA')
  })

  it('negar el nombre de LA TITULAR sí es número equivocado', async () => {
    const r = await detectar('Este celular no es de Elsa Silva')
    expect(r.isWrongNumber).toBe(true)
  })

  it('nombrar a los dos es una negación genuina, no una confusión', async () => {
    const r = await detectar('no conozco a Orozco Marta ni a Elsa Silva')
    expect(r.isWrongNumber).toBe(true)
  })

  it('sin nombrar a nadie, la detección clásica sigue funcionando', async () => {
    const r = await detectar('no soy paciente, se equivocaron de número')
    expect(r.isWrongNumber).toBe(true)
  })

  it('sin datos del turno se comporta como antes (no rompe call sites viejos)', async () => {
    const r = await detectWrongNumberPreFlow(
      'Este celular no es de Orozco Marta',
      '1141898093',
      'test-config',
      true,
    )
    // Sin saber quién es el profesional, no hay forma de detectar la confusión:
    // se mantiene el comportamiento previo en vez de adivinar.
    expect(r.isWrongNumber).toBe(true)
  })

  it('un mensaje normal no se confunde con número equivocado', async () => {
    const r = await detectar('quiero confirmar mi turno')
    expect(r.isWrongNumber).toBe(false)
    expect(r.response).toBeUndefined()
  })
})
