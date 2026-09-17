/**
 * lib/conversation-state/ai-dispatcher/consulta-cirugia.test.ts
 *
 * Caso real (17/9/2026, tel. 1133126267): "Hola buen día.. Quería saber el
 * horario de operación de día…". El paciente tenía una cirugía agendada y
 * ningún turno médico. El log lo decía en la línea anterior a la respuesta:
 *
 *     [CANCEL-FALLBACK] Sin turnos médicos, pero 1 cirugía(s) agendada(s)
 *     → "No encontré turnos próximos en tu cuenta."
 *
 * El modelo había elegido bien: `responder_consulta_informativa` con
 * aspecto "hora". Quien contradecía al contexto era el executor, que sólo
 * miraba `ctx.turnos` e ignoraba `ctx.turnosQx`. El paciente tuvo que escribir
 * un segundo mensaje ("No es turno es horario") para que otra rama del sistema
 * —el saludo de detección de paciente— le mostrara los datos que ya teníamos.
 */

import { describe, it, expect } from "vitest"
import { executeDispatcherDecision, type ExecutorDeps } from "./tool-executor"
import { TOOL_NAMES } from "./tool-manifest"
import type { DispatcherDecision } from "./dispatcher"
import type { DispatcherContext } from "./context-builder"

const CIRUGIA = {
  fecha: "martes, 22 de septiembre de 2026",
  hora: "11:00",
  cirugia: "Facovitrectomia Simple",
  cirujano: "Romano Joaquin",
  estado: "Programada",
}

const TURNO = {
  fecha: "viernes, 19 de septiembre de 2026",
  hora: "08:00",
  profesional: "TRAVERSO ALVARADO, ARIANNA",
  sede: "SALUD OCULAR CALLAO",
  estado: "sin confirmar",
}

function contexto(over: Partial<DispatcherContext> = {}): DispatcherContext {
  return {
    patient: { identified: true, name: "Ricardo" },
    turnos: [],
    turnosQx: [],
    activeFlow: { type: "none", phase: "none", description: "" },
    hasActiveFlow: false,
    // Con historial, para que no anteponga el saludo y los asserts sean sobre el contenido.
    conversationHistory: "Paciente: hola\nBot: hola",
    ...over,
  } as unknown as DispatcherContext
}

const deps: ExecutorDeps = {
  phoneNumber: "1133126267",
  configId: "cfg",
  clienteId: "cli",
  escalationPhone: "0800-345-9393",
  clinicName: "Salud Ocular",
}

function consulta(aspecto: string, tipo?: string): DispatcherDecision {
  return {
    handled: true,
    tool: TOOL_NAMES.CONSULTA_INFORMATIVA,
    args: tipo ? { aspecto, tipo } : { aspecto },
  }
}

async function mensajeDe(decision: DispatcherDecision, ctx: DispatcherContext): Promise<string> {
  const r = await executeDispatcherDecision(decision, ctx, deps)
  return r.action.type === "send_and_return" ? r.action.message : `[${r.action.type}]`
}

describe("con una cirugía agendada y ningún turno médico", () => {
  const ctx = contexto({ turnosQx: [CIRUGIA] as any })

  it("ya no dice que no hay nada agendado", async () => {
    const mensaje = await mensajeDe(consulta("hora"), ctx)
    expect(mensaje).not.toContain("No encontré turnos próximos")
  })

  it("responde con la hora de la cirugía", async () => {
    const mensaje = await mensajeDe(consulta("hora"), ctx)
    expect(mensaje).toContain("11:00")
    expect(mensaje).toContain("22 de septiembre")
  })

  it("responde con la fecha cuando preguntan por la fecha", async () => {
    expect(await mensajeDe(consulta("fecha"), ctx)).toContain("22 de septiembre")
  })

  it("responde con el cirujano cuando preguntan por el profesional", async () => {
    expect(await mensajeDe(consulta("profesional"), ctx)).toContain("Romano Joaquin")
  })

  it("en una consulta general devuelve todos los datos", async () => {
    const mensaje = await mensajeDe(consulta("general"), ctx)
    expect(mensaje).toContain("11:00")
    expect(mensaje).toContain("Romano Joaquin")
    expect(mensaje).toContain("Facovitrectomia")
  })

  it("siempre aclara que los cambios se gestionan con la clínica", async () => {
    // La cirugía es informativa en este canal: no se puede confirmar, cancelar
    // ni reagendar. Sugerir lo contrario sería peor que no responder.
    for (const aspecto of ["hora", "fecha", "profesional", "general"]) {
      const mensaje = await mensajeDe(consulta(aspecto), ctx)
      expect(mensaje, aspecto).toContain("0800-345-9393")
    }
  })
})

describe("no cambia el comportamiento con turnos médicos", () => {
  it("con turno y sin cirugía sigue respondiendo por el turno", async () => {
    const mensaje = await mensajeDe(consulta("hora"), contexto({ turnos: [TURNO] as any }))
    expect(mensaje).toContain("08:00")
    expect(mensaje).not.toContain("cirugía")
  })

  it("con ambos, por defecto responde por el turno médico", async () => {
    const ctx = contexto({ turnos: [TURNO] as any, turnosQx: [CIRUGIA] as any })
    const mensaje = await mensajeDe(consulta("hora"), ctx)
    expect(mensaje).toContain("08:00")
  })

  it("con ambos, responde por la cirugía si el modelo lo pide explícitamente", async () => {
    const ctx = contexto({ turnos: [TURNO] as any, turnosQx: [CIRUGIA] as any })
    const mensaje = await mensajeDe(consulta("hora", "cirugia"), ctx)
    expect(mensaje).toContain("11:00")
    expect(mensaje).toContain("0800-345-9393")
  })

  it("sin turno y sin cirugía mantiene el mensaje de siempre", async () => {
    const mensaje = await mensajeDe(consulta("hora"), contexto())
    expect(mensaje).toContain("No encontré turnos próximos")
  })
})

describe("datos incompletos no rompen la respuesta", () => {
  it("una cirugía sin hora responde igual, sin inventarla", async () => {
    const ctx = contexto({ turnosQx: [{ ...CIRUGIA, hora: "" }] as any })
    const mensaje = await mensajeDe(consulta("hora"), ctx)
    expect(mensaje).toContain("hora no disponible")
    expect(mensaje).toContain("22 de septiembre")
  })

  it("una cirugía sin cirujano no deja el campo colgado", async () => {
    const ctx = contexto({ turnosQx: [{ ...CIRUGIA, cirujano: "" }] as any })
    const mensaje = await mensajeDe(consulta("general"), ctx)
    expect(mensaje).not.toContain("Cirujano:")
  })

  it("sin teléfono de derivación remite igual a la clínica", async () => {
    const r = await executeDispatcherDecision(
      consulta("hora"),
      contexto({ turnosQx: [CIRUGIA] as any }),
      { ...deps, escalationPhone: undefined },
    )
    const mensaje = r.action.type === "send_and_return" ? r.action.message : ""
    expect(mensaje).toContain("comunicate con la clínica")
  })
})
