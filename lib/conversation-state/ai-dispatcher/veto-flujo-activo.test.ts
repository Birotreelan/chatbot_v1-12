/**
 * lib/conversation-state/ai-dispatcher/veto-flujo-activo.test.ts
 *
 * Caso real (16/9/2026, tel. 1140688863): una paciente estaba eligiendo entre 52
 * turnos para reagendar. Escribió "Viernes 9 de octubre." y el dispatcher eligió
 * `mostrar_menu_principal`: la conversación volvió a cero y le pidió el DNI.
 * Antes, con "Si por favor. Puede ser un lunes..." había elegido
 * `cancelar_y_solicitar_nuevo_turno` sobre un turno que ella ya había cancelado.
 *
 * El contexto que recibió el modelo decía `activeFlowType: "reschedule"` en las
 * dos ocasiones. Tenía el dato y decidió igual — por eso la defensa es
 * estructural y no una regla más en el prompt.
 *
 * Los tests se dividen en tres grupos, y el tercero importa tanto como el
 * primero: vetar de más dejaría al paciente encerrado en el flujo sin poder
 * pedir ayuda ni que le contesten una pregunta.
 */

import { describe, it, expect } from "vitest"
import { vetarDesvioDeFlujoPorPasos, type ExecutorResult } from "./tool-executor"
import type { DispatcherContext } from "./context-builder"

function contextoCon(tipoDeFlujo: string, fase = "awaiting_selection"): DispatcherContext {
  return {
    activeFlow: { type: tipoDeFlujo, phase: fase, description: "" },
    hasActiveFlow: tipoDeFlujo !== "none",
  } as unknown as DispatcherContext
}

function resultado(action: ExecutorResult["action"]): ExecutorResult {
  return { action, logNote: "original" }
}

describe("con un flujo por pasos abierto, se vetan las acciones que lo destruirían", () => {
  it("no reinicia la identificación del paciente en medio de un reagendamiento", () => {
    // El caso exacto: "Viernes 9 de octubre." → mostrar_menu_principal.
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "init_patient_detection" }),
      contextoCon("reschedule"),
    )
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("no cancela un turno en medio de un reagendamiento", () => {
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "trigger_cancel_and_rebook" }),
      contextoCon("reschedule"),
    )
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("no confirma asistencia en medio de un reagendamiento", () => {
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "trigger_confirm_appointment" }),
      contextoCon("reschedule"),
    )
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("segundo caso real: elegir un turno por la hora no es confirmar asistencia", () => {
    // 16/9/2026, tel. 2234217045. La paciente estaba eligiendo entre 38 turnos y
    // escribió "16.15" para pedir el de las 16:15 (opción 11). El dispatcher lo
    // leyó como `confirmar_asistencia_turno` y el router de intercalada le
    // contestó "Tu turno ya está agendado, todavía no hace falta que confirmes".
    // El handler del flujo nunca vio el mensaje — y sí sabe leer "16.15",
    // porque su regex de hora acepta el punto además de los dos puntos.
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "trigger_confirm_appointment" }),
      contextoCon("existing_patient", "awaiting_turno_selection"),
    )
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("no arranca una reserva nueva en medio del alta de un paciente nuevo", () => {
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "init_existing_patient_flow" }),
      contextoCon("new_patient", "pidiendo_apellido"),
    )
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("cede al handler del flujo, NO a passthrough", () => {
    // passthrough termina en initializePatientDetection, o sea el mismo reinicio
    // que estamos evitando. Si alguien lo cambia, este test lo frena.
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "init_patient_detection" }),
      contextoCon("booking", "eligiendo_turno"),
    )
    expect(r.action.type).not.toBe("passthrough")
    expect(r.action.type).toBe("continue_active_flow")
  })

  it("deja constancia de qué se descartó, para poder auditarlo", () => {
    const r = vetarDesvioDeFlujoPorPasos(
      resultado({ type: "trigger_cancel_menu" }),
      contextoCon("reschedule"),
    )
    expect(r.logNote).toContain("trigger_cancel_menu")
    expect(r.logNote).toContain("reschedule")
  })
})

describe("sin un flujo por pasos abierto, el dispatcher decide como siempre", () => {
  it("sin ningún flujo activo no se toca nada", () => {
    const original = resultado({ type: "trigger_cancel_and_rebook" })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("none", "none"))).toBe(original)
  })

  it("con una decisión pendiente NO se veta: ahí la pregunta abierta es sobre el turno", () => {
    // "¿Confirmás que querés cancelar?" — que el dispatcher resuelva eso es
    // justamente para lo que está.
    const original = resultado({ type: "trigger_cancel_menu" })
    expect(
      vetarDesvioDeFlujoPorPasos(original, contextoCon("decision_pendiente", "awaiting_cancel_confirmation")),
    ).toBe(original)
  })

  it("con detección de paciente NO se veta", () => {
    // Ese flujo reconstruye su propio menú desde Redis; incluirlo en la guarda
    // causó el caso 'Liliana' documentado en whatsapp.tsx.
    const original = resultado({ type: "init_patient_detection" })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("patient_detection", "detecting"))).toBe(original)
  })

  it("esperando el DNI NO se veta", () => {
    const original = resultado({ type: "init_existing_patient_flow" })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("esperando_dni", "esperando_dni"))).toBe(original)
  })
})

describe("el paciente no queda encerrado: lo que solo habla sigue pasando", () => {
  it("puede recibir una respuesta a su pregunta", () => {
    const original = resultado({ type: "send_and_return", message: "El turno es a las 12:30." })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("reschedule"))).toBe(original)
  })

  it("puede pedir hablar con una persona", () => {
    const original = resultado({ type: "derive_to_human", motivo: "quiere hablar con alguien" })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("reschedule"))).toBe(original)
  })

  it("puede ser derivado a la clínica por algo fuera de alcance", () => {
    const original = resultado({ type: "derive_external", message: "Consultá con la clínica." })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("reschedule"))).toBe(original)
  })

  it("puede abandonar el flujo si lo dice", () => {
    const original = resultado({ type: "end_conversation", message: "¡Listo! Que tengas buen día." })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("reschedule"))).toBe(original)
  })

  it("continuar el flujo ya era lo correcto y no cambia", () => {
    const original = resultado({ type: "continue_active_flow" })
    expect(vetarDesvioDeFlujoPorPasos(original, contextoCon("reschedule"))).toBe(original)
  })
})
