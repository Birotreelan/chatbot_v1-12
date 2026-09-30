/**
 * lib/conversation-state/patient-detection/opciones-del-turno.test.ts
 *
 * Lo que se prueba acá no es una función: es que cuatro superficies —el texto
 * del menú, el mapa de números, los botones de WhatsApp y el saludo— muestren
 * lo mismo. Cuando se separan, el paciente lee "2- Cancelar el turno" y el 2
 * hace otra cosa. Eso ya pasó (caso Liliana, 9/7/2026).
 */

import { describe, it, expect } from "vitest"

import {
  menuDelTurno,
  gestionesDelTurno,
  soloSePuedeCancelar,
  seOfreceConfirmarAsistencia,
  BOTON_DE_LA_ACCION,
  MAXIMO_DE_BOTONES,
  type PermisosDelMenu,
} from "./opciones-del-turno"

const TODO_HABILITADO: PermisosDelMenu = { estadoAdmiteConfirmar: true }

describe("qué opciones se ofrecen", () => {
  it("con portal son tres, y por eso entran como botones", () => {
    // Éste es el motivo por el que el saludo con turno no tenía botones: con
    // cuatro opciones no hay forma, WhatsApp admite tres.
    const menu = menuDelTurno({ ...TODO_HABILITADO, usaPortalWeb: true })
    expect(menu).toEqual([
      "cancel_appointment",
      "cancel_and_book_new_appointment",
      "other_inquiry_intent",
    ])
    expect(menu.length).toBeLessThanOrEqual(MAXIMO_DE_BOTONES)
  })

  it("sin portal son cuatro, y no entran", () => {
    const menu = menuDelTurno(TODO_HABILITADO)
    expect(menu[0]).toBe("confirm_appointment")
    expect(menu.length).toBeGreaterThan(MAXIMO_DE_BOTONES)
  })

  it("la obra social bloqueada saca sólo 'solicitar uno nuevo'", () => {
    // Cancelar sigue siendo una gestión válida para ese paciente: lo que no
    // puede es sacar un turno online.
    const gestiones = gestionesDelTurno({
      ...TODO_HABILITADO,
      usaPortalWeb: true,
      obraSocialBloqueada: true,
    })
    expect(gestiones).toEqual(["cancel_appointment"])
  })

  it("sin cancelación ni turnos nuevos no queda nada que ofrecer", () => {
    const permisos: PermisosDelMenu = {
      estadoAdmiteConfirmar: false,
      permitirCancelacion: false,
      permitirNuevoTurno: false,
    }
    expect(gestionesDelTurno(permisos)).toEqual([])
    expect(menuDelTurno(permisos)).toEqual([])
    expect(soloSePuedeCancelar(permisos)).toBe(false)
  })
})

describe("el menú numerado y el botón suelto son casos distintos", () => {
  it("cuando lo único posible es cancelar, no hay menú", () => {
    // Ahí el saludo muestra un botón "Cancelar turno" y deriva el resto por
    // teléfono. Devolver un menú de una opción haría que el paciente
    // respondiera "1" a algo que no es una lista.
    const permisos: PermisosDelMenu = {
      estadoAdmiteConfirmar: false,
      usaPortalWeb: true,
      permitirNuevoTurno: false,
    }
    expect(soloSePuedeCancelar(permisos)).toBe(true)
    expect(menuDelTurno(permisos)).toEqual([])
  })

  it("un menú vacío no siempre significa 'sólo cancelar'", () => {
    // Los dos devuelven [], y el llamador tiene que distinguirlos: uno muestra
    // un botón y el otro una derivación.
    const sinNada: PermisosDelMenu = {
      estadoAdmiteConfirmar: false,
      permitirCancelacion: false,
      permitirNuevoTurno: false,
    }
    expect(menuDelTurno(sinNada)).toEqual([])
    expect(soloSePuedeCancelar(sinNada)).toBe(false)
  })
})

describe("los títulos de los botones", () => {
  it("ninguno pasa de 20 caracteres", () => {
    // WhatsApp corta ahí. Por eso el botón dice "Cancelar turno" y el menú
    // escrito "Cancelar el turno médico", que son 24.
    for (const [accion, titulo] of Object.entries(BOTON_DE_LA_ACCION)) {
      expect(titulo.length, `${accion}: "${titulo}"`).toBeLessThanOrEqual(20)
    }
  })

  it("hay título para toda acción que pueda aparecer en el menú", () => {
    // Una acción sin título saldría como un botón vacío.
    for (const accion of menuDelTurno(TODO_HABILITADO)) {
      expect(BOTON_DE_LA_ACCION[accion], accion).toBeTruthy()
    }
  })
})

describe("confirmar asistencia", () => {
  it("el portal la saca aunque el turno la admita", () => {
    expect(
      seOfreceConfirmarAsistencia({ estadoAdmiteConfirmar: true, usaPortalWeb: true }),
    ).toBe(false)
  })

  it("sin portal depende del estado del turno", () => {
    expect(seOfreceConfirmarAsistencia({ estadoAdmiteConfirmar: true })).toBe(true)
    expect(seOfreceConfirmarAsistencia({ estadoAdmiteConfirmar: false })).toBe(false)
  })
})
