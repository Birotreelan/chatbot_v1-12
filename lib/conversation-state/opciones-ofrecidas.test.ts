/**
 * lib/conversation-state/opciones-ofrecidas.test.ts
 *
 * El caso que motivó esto es fácil de arreglar mal: si la validación es
 * demasiado estricta, rechaza selecciones legítimas y rompe la reserva de
 * turnos, que es el flujo más usado del sistema. Por eso la mitad de estos tests
 * verifican que NO intercepte.
 *
 * Los textos de paso son los reales, copiados de conversaciones de producción.
 */

import { describe, it, expect } from 'vitest'
import {
  evaluarSeleccionFueraDeMenu,
  opcionesOfrecidas,
  esSeleccionNumerica,
  listarOpciones,
} from './opciones-ofrecidas'

/** Menú que recibió Marta: su obra social no permite agendar, así que hay 2 opciones. */
const MENU_MARTA = `¿Puedo ayudarte con algo más?

1- Solicitar turno para un familiar
2- Realizar otra consulta

Respondé con el número o presioná el botón de tu preferencia.`

/** Lista de turnos para reagendar: 20 opciones numéricas y un botón "Ver más". */
const LISTA_TURNOS = `DANIELA, encontré *100 turnos* disponibles.

*Lunes 7 de septiembre*
  1. 13:15
  2. 13:45
  3. 15:15

*Lunes 14 de septiembre*
  7. 11:15
  8. 12:00
  12. 15:45

Respondé con el *número* del turno que preferís.

0. *Volver al paso anterior*`

const CONFIRMACION = `Para confirmar, ¿asistirás al siguiente turno?

📅 10/09/2026 a las 11:30
👨‍⚕️ SOBRINO CLAUDIA
📍 San Cristobal

1- Sí, confirmo
2- No, quiero cancelar`

describe('Opción fuera del menú', () => {
  it('detecta el caso Marta: eligió 3 en un menú de 1 y 2', () => {
    const r = evaluarSeleccionFueraDeMenu('3', MENU_MARTA)
    expect(r.fueraDeMenu).toBe(true)
    expect(r.elegida).toBe('3')
    expect(r.disponibles).toEqual(['1', '2'])
  })

  it('deja pasar una opción válida del mismo menú', () => {
    expect(evaluarSeleccionFueraDeMenu('2', MENU_MARTA).fueraDeMenu).toBe(false)
  })
})

describe('No debe romper lo que funciona', () => {
  it('NO intercepta la selección de un turno de la lista', () => {
    // El riesgo real: validar contra los botones guardados (solo "Ver más")
    // rechazaría este 7 y rompería la reserva.
    expect(evaluarSeleccionFueraDeMenu('7', LISTA_TURNOS).fueraDeMenu).toBe(false)
    expect(evaluarSeleccionFueraDeMenu('12', LISTA_TURNOS).fueraDeMenu).toBe(false)
  })

  it('NO intercepta el 0 de "volver al paso anterior"', () => {
    expect(evaluarSeleccionFueraDeMenu('0', LISTA_TURNOS).fueraDeMenu).toBe(false)
  })

  it('sí detecta un número que la lista no ofrece', () => {
    expect(evaluarSeleccionFueraDeMenu('99', LISTA_TURNOS).fueraDeMenu).toBe(true)
  })

  it('NO intercepta un DNI', () => {
    // 7-8 dígitos: no puede confundirse con una opción de menú.
    expect(evaluarSeleccionFueraDeMenu('29171192', MENU_MARTA).fueraDeMenu).toBe(false)
  })

  it('NO intercepta texto libre', () => {
    expect(evaluarSeleccionFueraDeMenu('quiero cancelar', MENU_MARTA).fueraDeMenu).toBe(false)
    expect(evaluarSeleccionFueraDeMenu('Lunes 14. 11:15', LISTA_TURNOS).fueraDeMenu).toBe(false)
  })

  it('sin paso previo no interviene', () => {
    expect(evaluarSeleccionFueraDeMenu('3', null).fueraDeMenu).toBe(false)
    expect(evaluarSeleccionFueraDeMenu('3', '').fueraDeMenu).toBe(false)
  })

  it('un paso sin opciones enumeradas no es un menú', () => {
    const sinOpciones = 'Para poder identificarte, ¿me pasás tu DNI?'
    expect(evaluarSeleccionFueraDeMenu('3', sinOpciones).fueraDeMenu).toBe(false)
  })
})

describe('Parseo de opciones', () => {
  it('no confunde direcciones, teléfonos ni fechas con opciones', () => {
    const conDatos = `Tu turno es el 10/09/2026 a las 11:30.

📍 Mariano Castex 1369
📞 0800-345-9393
+54 9 11 2322-3785

1- Confirmar
2- Cancelar`
    expect([...opcionesOfrecidas(conDatos)].sort()).toEqual(['1', '2'])
  })

  it('acepta los separadores que usa el sistema', () => {
    expect(opcionesOfrecidas('1- uno\n2. dos\n3) tres').size).toBe(3)
  })

  it('esSeleccionNumerica normaliza y acota', () => {
    expect(esSeleccionNumerica(' 2 ')).toBe('2')
    expect(esSeleccionNumerica('02')).toBe('2')
    expect(esSeleccionNumerica('1234567')).toBeNull()
    expect(esSeleccionNumerica('1a')).toBeNull()
  })

  it('listarOpciones arma el texto en castellano', () => {
    expect(listarOpciones(['1', '2'])).toBe('1 o 2')
    expect(listarOpciones(['1', '2', '3'])).toBe('1, 2 o 3')
  })
})
