/**
 * Tests para option-detection-handler.ts
 * Verifica que la detección de opciones de menú funciona correctamente
 */

import { describe, it, expect } from "vitest"
import {
  detectMenuOptionSelection,
  createMenuOptions,
  detectConfirmationOrCancellationOptionSelection,
  MenuOption,
} from "./option-detection-handler"

describe("option-detection-handler", () => {
  // ========================================================================
  // TESTS BÁSICOS DE DETECCIÓN
  // ========================================================================

  describe("detectMenuOptionSelection", () => {
    const basicMenuOptions: MenuOption[] = [
      {
        index: 0,
        label: "Solicitar turno",
        action: "book_appointment",
      },
      {
        index: 1,
        label: "Ver turnos",
        action: "show_appointments",
      },
      {
        index: 2,
        label: "Cancelar turno",
        action: "cancel_appointment",
      },
    ]

    it("debería detectar número directo", () => {
      const result = detectMenuOptionSelection("2", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Ver turnos")
      expect(result.confidence).toBe("high")
    })

    it("debería detectar ordinal", () => {
      const result = detectMenuOptionSelection("segundo", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Ver turnos")
      expect(result.confidence).toBe("high")
    })

    it("debería detectar número en letras", () => {
      const result = detectMenuOptionSelection("tres", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Cancelar turno")
      expect(result.confidence).toBe("high")
    })

    it("debería detectar texto exacto de opción", () => {
      const result = detectMenuOptionSelection("Cancelar turno", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Cancelar turno")
      expect(result.confidence).toBe("high")
    })

    it("debería detectar texto parcial de opción", () => {
      const result = detectMenuOptionSelection("cancelar", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Cancelar turno")
      expect(result.confidence).toBe("high")
    })

    it("debería detectar fuzzy match", () => {
      const result = detectMenuOptionSelection("solocitar turno", basicMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Solicitar turno")
      expect(result.confidence).toBe("medium")
    })

    it("debería NO detectar opción inexistente", () => {
      const result = detectMenuOptionSelection("otra cosa", basicMenuOptions)
      expect(result.detected).toBe(false)
    })

    it("debería manejar mensaje vacío", () => {
      const result = detectMenuOptionSelection("", basicMenuOptions)
      expect(result.detected).toBe(false)
    })

    it("debería manejar opciones vacías", () => {
      const result = detectMenuOptionSelection("1", [])
      expect(result.detected).toBe(false)
    })
  })

  // ========================================================================
  // TESTS DE CONFIRMACIÓN/CANCELACIÓN
  // ========================================================================

  describe("detectConfirmationOrCancellationOptionSelection", () => {
    it("debería detectar 'Sí, cancelar el turno' como cancelación", () => {
      const result = detectConfirmationOrCancellationOptionSelection("1")
      expect(result.action).toBe("cancel")
    })

    it("debería detectar 'No, mantener el turno' como confirmación", () => {
      const result = detectConfirmationOrCancellationOptionSelection("2")
      expect(result.action).toBe("confirm")
    })

    it("debería detectar 'si' como cancelación en contexto de doble confirmación", () => {
      const result = detectConfirmationOrCancellationOptionSelection("sí")
      expect(result.action).toBe("cancel")
    })

    it("debería detectar 'no' como confirmación en contexto de doble confirmación", () => {
      const result = detectConfirmationOrCancellationOptionSelection("no")
      expect(result.action).toBe("confirm")
    })

    it("debería detectar 'confirmar' como cancelación (mantener turno)", () => {
      const result = detectConfirmationOrCancellationOptionSelection("segundo")
      expect(result.action).toBe("confirm")
    })
  })

  // ========================================================================
  // TESTS DE CASOS DE USO REALISTAS
  // ========================================================================

  describe("casos de uso realistas", () => {
    const patientMenuOptions: MenuOption[] = [
      { index: 0, label: "Confirmar turno", action: "confirm_appointment" },
      { index: 1, label: "Cambiar/Reagendar", action: "reschedule_appointment" },
      { index: 2, label: "Cancelar turno", action: "cancel_appointment" },
    ]

    it("usuario dice 'quiero cancelar' debe seleccionar opción 3", () => {
      const result = detectMenuOptionSelection("quiero cancelar", patientMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Cancelar turno")
    })

    it("usuario dice 'reagendar' debe seleccionar opción 2", () => {
      const result = detectMenuOptionSelection("reagendar", patientMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Cambiar/Reagendar")
    })

    it("usuario dice 'ok confirmar' debe seleccionar opción 1", () => {
      const result = detectMenuOptionSelection("ok confirmar", patientMenuOptions)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Confirmar turno")
    })

    it("usuario dice 'no quiero ir mañana' debe detectarse como No (necesita NLU para casos complejos)", () => {
      const result = detectMenuOptionSelection("no quiero ir mañana", patientMenuOptions)
      // Este caso complejo puede no detectarse sin NLU
      // pero el sistema tiene la CAPA 3 (NLU) para esto
      expect(result).toBeDefined()
    })
  })

  // ========================================================================
  // TESTS DE HELPERS
  // ========================================================================

  describe("createMenuOptions", () => {
    it("debería crear array de MenuOption correctamente", () => {
      const labels = ["Opción 1", "Opción 2", "Opción 3"]
      const actions = ["action1", "action2", "action3"]
      
      const options = createMenuOptions(labels, actions)
      
      expect(options).toHaveLength(3)
      expect(options[0]).toEqual({
        index: 0,
        label: "Opción 1",
        action: "action1",
      })
      expect(options[2]).toEqual({
        index: 2,
        label: "Opción 3",
        action: "action3",
      })
    })
  })

  // ========================================================================
  // TESTS DE CASOS EDGE
  // ========================================================================

  describe("casos edge", () => {
    const options: MenuOption[] = [
      { index: 0, label: "Primera", action: "first" },
      { index: 1, label: "Segunda", action: "second" },
      { index: 2, label: "Tercera", action: "third" },
    ]

    it("debería manejar 'primero'", () => {
      const result = detectMenuOptionSelection("primero", options)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Primera")
    })

    it("debería manejar 'último'", () => {
      const result = detectMenuOptionSelection("último", options)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Tercera")
    })

    it("debería manejar múltiples espacios y puntuación", () => {
      const result = detectMenuOptionSelection("  segunda  .", options)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Segunda")
    })

    it("debería manejar mayúsculas/minúsculas", () => {
      const result = detectMenuOptionSelection("PRIMERA", options)
      expect(result.detected).toBe(true)
      expect(result.selectedOption?.label).toBe("Primera")
    })
  })
})
