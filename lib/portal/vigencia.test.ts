/**
 * lib/portal/vigencia.test.ts
 *
 * Esta lógica decide dos cosas con consecuencias opuestas: hasta cuándo alguien
 * puede tocar el turno de un paciente, y hasta cuándo el paciente puede ver qué
 * le quedó. Apretar de más expone; aflojar de más confunde y genera un mensaje
 * que pagamos.
 *
 * Por eso los tests están agrupados por lo que pasa si se equivoca, no por
 * función.
 */

import { describe, it, expect } from "vitest"
import {
  calcularVencimientos,
  estadoDelEnlace,
  permiteGestionar,
  permiteVerDatos,
  reemplazaElTurnoPrevio,
  VENTANA_CONVERSACION_MS,
  TOPE_RECORDATORIO_MS,
} from "./vigencia"

const AHORA = new Date("2026-09-22T10:00:00.000Z").getTime()
const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

const ms = (iso: string) => new Date(iso).getTime()

describe("lo que sale de una conversación", () => {
  it("dura media hora para gestionar", () => {
    const v = calcularVencimientos({ origen: "conversacion", ahora: AHORA })
    expect(ms(v.venceAccion) - AHORA).toBe(VENTANA_CONVERSACION_MS)
  })

  it("sin un turno de referencia, el resultado se ve una semana", () => {
    const v = calcularVencimientos({ origen: "conversacion", ahora: AHORA })
    expect(ms(v.venceVisibilidad) - AHORA).toBe(7 * DIA)
  })
})

describe("lo que sale de un recordatorio", () => {
  it("dura hasta el turno cuando el turno es pronto", () => {
    const turno = new Date(AHORA + 5 * HORA).toISOString()
    const v = calcularVencimientos({ origen: "recordatorio", fechaDelTurno: turno, ahora: AHORA })
    expect(v.venceAccion).toBe(turno)
  })

  it("no se estira más allá del tope aunque el turno sea dentro de un mes", () => {
    const turno = new Date(AHORA + 30 * DIA).toISOString()
    const v = calcularVencimientos({ origen: "recordatorio", fechaDelTurno: turno, ahora: AHORA })
    expect(ms(v.venceAccion) - AHORA).toBe(TOPE_RECORDATORIO_MS)
  })

  it("un recordatorio que llega una hora antes del turno igual deja gestionar", () => {
    // Sin este piso, el paciente recibiría un enlace ya vencido o casi. Es el
    // caso del recordatorio del mismo día.
    const turno = new Date(AHORA + 10 * 60 * 1000).toISOString()
    const v = calcularVencimientos({ origen: "recordatorio", fechaDelTurno: turno, ahora: AHORA })
    expect(ms(v.venceAccion) - AHORA).toBe(VENTANA_CONVERSACION_MS)
  })
})

describe("la visibilidad nunca es menor que la acción", () => {
  it("sería poder gestionar algo cuyo resultado no se puede ver", () => {
    for (const origen of ["conversacion", "recordatorio"] as const) {
      for (const fechaDelTurno of [null, new Date(AHORA + 10 * 60 * 1000).toISOString(), new Date(AHORA + 30 * DIA).toISOString()]) {
        const v = calcularVencimientos({ origen, fechaDelTurno, ahora: AHORA })
        expect(ms(v.venceVisibilidad), `${origen} ${fechaDelTurno}`).toBeGreaterThanOrEqual(ms(v.venceAccion))
      }
    }
  })
})

describe("los cuatro estados", () => {
  const base = {
    venceAccion: new Date(AHORA + HORA).toISOString(),
    venceVisibilidad: new Date(AHORA + DIA).toISOString(),
  }

  it("vigente: se puede gestionar", () => {
    const e = estadoDelEnlace(base, AHORA)
    expect(e).toBe("vigente")
    expect(permiteGestionar(e)).toBe(true)
    expect(permiteVerDatos(e)).toBe(true)
  })

  it("gestionado: se ve el resultado, no se gestiona de nuevo", () => {
    const e = estadoDelEnlace({ ...base, resultado: { texto: "x" } }, AHORA)
    expect(e).toBe("gestionado")
    expect(permiteGestionar(e)).toBe(false)
    expect(permiteVerDatos(e)).toBe(true)
  })

  it("pasada la ventana de acción todavía se ve el turno", () => {
    // El paciente que vuelve a mirar no tiene por qué encontrarse un error.
    const e = estadoDelEnlace(base, AHORA + 2 * HORA)
    expect(e).toBe("vencido_para_gestionar")
    expect(permiteGestionar(e)).toBe(false)
    expect(permiteVerDatos(e)).toBe(true)
  })

  it("pasada la visibilidad no se muestra ningún dato", () => {
    // Si el resultado quedara visible para siempre, esa URL sería una ventana
    // permanente al turno de esa persona.
    const e = estadoDelEnlace(base, AHORA + 2 * DIA)
    expect(e).toBe("vencido")
    expect(permiteGestionar(e)).toBe(false)
    expect(permiteVerDatos(e)).toBe(false)
  })

  it("gestionado y vencido no muestra los datos: gana el vencimiento", () => {
    const e = estadoDelEnlace({ ...base, resultado: { texto: "x" } }, AHORA + 2 * DIA)
    expect(e).toBe("vencido")
    expect(permiteVerDatos(e)).toBe(false)
  })

  it("gestionado gana sobre la ventana de acción vencida", () => {
    // Al que ya reprogramó le importa ver qué le quedó, no que el plazo pasó.
    const e = estadoDelEnlace({ ...base, resultado: { texto: "x" } }, AHORA + 2 * HORA)
    expect(e).toBe("gestionado")
  })
})

describe("datos rotos no habilitan nada", () => {
  it("fechas inválidas o ausentes caen en vencido", () => {
    for (const contexto of [
      { venceAccion: "", venceVisibilidad: "" },
      { venceAccion: "no es una fecha", venceVisibilidad: "tampoco" },
      { venceAccion: undefined as any, venceVisibilidad: undefined as any },
    ]) {
      const e = estadoDelEnlace(contexto, AHORA)
      expect(e).toBe("vencido")
      expect(permiteGestionar(e)).toBe(false)
      expect(permiteVerDatos(e)).toBe(false)
    }
  })

  it("una fecha de turno inválida no rompe el cálculo", () => {
    const v = calcularVencimientos({ origen: "recordatorio", fechaDelTurno: "cualquier cosa", ahora: AHORA })
    expect(ms(v.venceAccion) - AHORA).toBe(TOPE_RECORDATORIO_MS)
  })
})

describe("¿el enlace reemplaza el turno que trae?", () => {
  it("reagendar y cancelar sí", () => {
    // Con el recordatorio de dos botones, el reagendamiento entra por
    // "Cancelar": el token dice `cancelar` y el paciente igual termina
    // reservando. Si sólo se mirara `reagendar`, ese paciente quedaría con
    // dos turnos —que es exactamente lo que pasó en producción el 25/9—.
    expect(reemplazaElTurnoPrevio("reagendar")).toBe(true)
    expect(reemplazaElTurnoPrevio("cancelar")).toBe(true)
  })

  it("sacar un turno nuevo NO cancela el que ya tenía", () => {
    // El token de `nuevo_turno` también trae el turno vigente del paciente
    // (`datosDesdeElContexto` lo copia siempre). Tratarlo como reemplazo le
    // borraría el turno que tenía a quien vino a sacar uno más.
    expect(reemplazaElTurnoPrevio("nuevo_turno")).toBe(false)
  })

  it("el turno de un familiar tampoco", () => {
    // El turno del token es del titular del teléfono, no del familiar.
    expect(reemplazaElTurnoPrevio("familiar")).toBe(false)
  })
})
