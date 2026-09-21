/**
 * lib/flows/recordatorio-con-botones.test.ts
 *
 * Lo que se protege acá es la transparencia de la reescritura: el sistema de la
 * clínica manda su template como siempre y nosotros le agregamos botones. Si en
 * el camino se pierde o se corre un parámetro, el paciente recibe el turno de
 * otro día — que es exactamente el bug que tuvimos con
 * `cancelar_turno_solicitado` leyendo parámetros por posición.
 */

import { describe, it, expect } from "vitest"
import {
  agregarBotonesAlEnvio,
  definicionDeTemplate,
  accionDelBoton,
  BOTON_CONFIRMAR,
  BOTON_CANCELAR,
  BOTON_REAGENDAR,
  PAYLOAD_CONFIRMAR,
  PAYLOAD_CANCELAR,
  CUERPO_VIGENTE,
  CUERPO_CON_REAGENDAR,
  EJEMPLOS_VIGENTES,
} from "./recordatorio-con-botones"
import {
  construirDatosDeLaPantalla,
  construirFlowJson,
  MAX_TURNOS_OFRECIDOS,
  OPCION_NINGUNO,
  PANTALLA_ELEGIR,
} from "./flow-reagendar"

/** Exactamente lo que manda hoy el sistema de la clínica. */
const BODY_DE_LA_CLINICA = {
  template: {
    name: "confirmacion_1_turno",
    language: { code: "es_AR" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "SALUD OCULAR CALLAO" },
          { type: "text", text: "19/09/2026" },
          { type: "text", text: "08:00" },
          { type: "text", text: "TRAVERSO ALVARADO ARIANNA ANDREA" },
          { type: "text", text: "Av. Callao 710" },
        ],
      },
    ],
  },
}

const PARAMS = {
  nombreTemplateFlows: "confirmacion_1_turno_flows",
  flowToken: "tok_abc123",
  datosDeLaPantalla: { turno_actual: "x", turnos_disponibles: [] },
}

describe("la reescritura no toca los datos del turno", () => {
  it("conserva los 5 parámetros, en el mismo orden", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const body = r.template.components.find((c: any) => c.type === "body")
    expect(body.parameters).toEqual(BODY_DE_LA_CLINICA.template.components[0].parameters)
  })

  it("conserva el idioma", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    expect(r.template.language).toEqual({ code: "es_AR" })
  })

  it("no muta el objeto original", () => {
    const copia = JSON.parse(JSON.stringify(BODY_DE_LA_CLINICA))
    agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)
    expect(BODY_DE_LA_CLINICA).toEqual(copia)
  })

  it("acepta el body como string, que es como llega por HTTP", () => {
    const r = agregarBotonesAlEnvio(JSON.stringify(BODY_DE_LA_CLINICA), PARAMS)!
    expect(r.template.name).toBe("confirmacion_1_turno_flows")
  })
})

describe("los botones que se agregan", () => {
  it("cambia el nombre del template por el de la versión con Flows", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    expect(r.template.name).toBe("confirmacion_1_turno_flows")
  })

  it("agrega los tres botones con sus índices", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const botones = r.template.components.filter((c: any) => c.type === "button")
    expect(botones).toHaveLength(3)
    expect(botones.map((b: any) => b.index)).toEqual(["0", "1", "2"])
  })

  it("los quick reply van primero y el Flow último", () => {
    // Meta rechaza "QUICK_REPLY, FLOW, QUICK_REPLY" con error de combinación.
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const subtipos = r.template.components.filter((c: any) => c.type === "button").map((b: any) => b.sub_type)
    expect(subtipos).toEqual(["quick_reply", "quick_reply", "flow"])
  })

  it("el botón de Flow lleva el token y los datos de la pantalla", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const flow = r.template.components.find((c: any) => c.sub_type === "flow")
    expect(flow.parameters[0].action.flow_token).toBe("tok_abc123")
    expect(flow.parameters[0].action.flow_action_data).toEqual(PARAMS.datosDeLaPantalla)
  })
})

describe("cuándo NO reescribe", () => {
  it("un payload que no es un template", () => {
    for (const entrada of [null, undefined, "", "{roto", {}, { template: {} }, 42]) {
      expect(agregarBotonesAlEnvio(entrada, PARAMS)).toBeNull()
    }
  })

  it("un template que ya trae botones propios", () => {
    // Señal de que la clínica cambió su integración: no le pisamos nada.
    const conBotones = {
      template: {
        ...BODY_DE_LA_CLINICA.template,
        components: [
          ...BODY_DE_LA_CLINICA.template.components,
          { type: "button", sub_type: "quick_reply", index: "0", parameters: [] },
        ],
      },
    }
    expect(agregarBotonesAlEnvio(conBotones, PARAMS)).toBeNull()
  })
})

describe("accionDelBoton — rutear sin adivinar", () => {
  it("rutea por payload, que es el que definimos nosotros", () => {
    expect(accionDelBoton({ payload: PAYLOAD_CONFIRMAR })).toBe("confirmar")
    expect(accionDelBoton({ payload: PAYLOAD_CANCELAR })).toBe("cancelar")
  })

  it("cae al texto del botón cuando no vino el payload", () => {
    expect(accionDelBoton({ text: BOTON_CONFIRMAR })).toBe("confirmar")
    expect(accionDelBoton({ text: BOTON_CANCELAR })).toBe("cancelar")
  })

  it("no matchea por substring", () => {
    // El bug que no queremos repetir: "necesito cancelar el lunes" no es el botón.
    expect(accionDelBoton({ text: "quiero cancelar turno pero otro" })).toBeNull()
    expect(accionDelBoton({ text: "Confirmar asistencia de mi hija" })).toBeNull()
  })

  it("cualquier otra cosa sigue su camino por el motor conversacional", () => {
    for (const entrada of [null, undefined, {}, { text: "" }, { text: "hola" }]) {
      expect(accionDelBoton(entrada)).toBeNull()
    }
  })

  it("sigue aceptando las etiquetas del template viejo", () => {
    // Un recordatorio mandado ayer se queda en el chat del paciente. Puede
    // tocar "Confirmar" tres días después de que migramos el template, y ese
    // toque tiene que rutear igual.
    expect(accionDelBoton({ text: "Confirmar" })).toBe("confirmar")
    expect(accionDelBoton({ text: "Cancelar" })).toBe("cancelar")
  })
})

describe("el cuerpo del template", () => {
  it("conserva los cinco parámetros del template vigente", () => {
    for (const cuerpo of [CUERPO_VIGENTE, CUERPO_CON_REAGENDAR]) {
      for (let i = 1; i <= 5; i++) {
        expect(cuerpo, `{{${i}}}`).toContain(`{{${i}}}`)
      }
      expect(cuerpo).not.toContain("{{6}}")
    }
  })

  it("la versión con reagendar sólo cambia la frase de las opciones", () => {
    const hasta = (t: string) => t.slice(0, t.indexOf("Por favor"))
    expect(hasta(CUERPO_CON_REAGENDAR)).toBe(hasta(CUERPO_VIGENTE))
    expect(CUERPO_CON_REAGENDAR).not.toContain("confirme o cancele")
  })

  it("hay un ejemplo por cada parámetro", () => {
    expect(EJEMPLOS_VIGENTES).toHaveLength(5)
  })
})

describe("las etiquetas entran en el límite de Meta", () => {
  it("ninguna supera los 25 caracteres", () => {
    for (const etiqueta of [BOTON_CONFIRMAR, BOTON_CANCELAR, BOTON_REAGENDAR]) {
      expect(etiqueta.length, etiqueta).toBeLessThanOrEqual(25)
    }
  })
})

describe("definicionDeTemplate", () => {
  const DEF = definicionDeTemplate({
    nombre: "confirmacion_1_turno_flows",
    idioma: "es_AR",
    cuerpo: "Hola, te recordamos tu turno en {{1}} el {{2}} a las {{3}} con {{4}} en {{5}}.",
    ejemplos: ["SALUD OCULAR CALLAO", "19/09/2026", "08:00", "Dra. Traverso", "Av. Callao 710"],
    flowId: "1234567890",
  })

  it("pide categoría utility", () => {
    expect(DEF.category).toBe("UTILITY")
  })

  it("usa el cuerpo que le pasan, sin inventar texto", () => {
    const body: any = DEF.components.find((c: any) => c.type === "BODY")
    expect(body.text).toContain("{{5}}")
    expect(body.example.body_text[0]).toHaveLength(5)
  })

  it("el botón de Flow apunta a la pantalla de entrada", () => {
    const botones: any = DEF.components.find((c: any) => c.type === "BUTTONS")
    const flow = botones.buttons.find((b: any) => b.type === "FLOW")
    expect(flow.navigate_screen).toBe(PANTALLA_ELEGIR)
    expect(flow.flow_action).toBe("navigate")
    expect(flow.flow_id).toBe("1234567890")
  })
})

describe("los datos que viajan dentro del mensaje", () => {
  const turnos = Array.from({ length: 30 }, (_, i) => ({
    id: `ag${i}`,
    title: `Turno ${i}`,
    description: "Dra. Traverso — Callao",
  }))

  it("respeta el tope de opciones del RadioButtonsGroup", () => {
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: turnos })
    expect(d.turnos_disponibles.length).toBeLessThanOrEqual(MAX_TURNOS_OFRECIDOS)
  })

  it("siempre deja lugar para la opción de escape", () => {
    // Sin esto, un día con muchos horarios libres dejaba al paciente con 20
    // opciones que no le sirven y ninguna forma de decirlo.
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: turnos })
    expect(d.turnos_disponibles.at(-1)!.id).toBe(OPCION_NINGUNO)
  })

  it("se puede pedir que no haya opción de escape", () => {
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: turnos, etiquetaNinguno: null })
    expect(d.turnos_disponibles.some((t) => t.id === OPCION_NINGUNO)).toBe(false)
    expect(d.turnos_disponibles).toHaveLength(MAX_TURNOS_OFRECIDOS)
  })

  it("acorta los títulos largos en vez de dejar que Meta rechace el mensaje", () => {
    const d = construirDatosDeLaPantalla({
      turnoActual: "x",
      turnosDisponibles: [{ id: "a", title: "Un título larguísimo que no entra en treinta caracteres" }],
    })
    expect(d.turnos_disponibles[0].title.length).toBeLessThanOrEqual(30)
    expect(d.turnos_disponibles[0].title).toMatch(/…$/)
  })

  it("una lista vacía igual ofrece la salida", () => {
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: [] })
    expect(d.turnos_disponibles).toHaveLength(1)
    expect(d.turnos_disponibles[0].id).toBe(OPCION_NINGUNO)
  })
})

describe("el Flow JSON", () => {
  const FLOW: any = construirFlowJson()

  it("tiene una sola pantalla y es terminal", () => {
    expect(FLOW.screens).toHaveLength(1)
    expect(FLOW.screens[0].terminal).toBe(true)
    expect(FLOW.screens[0].id).toBe(PANTALLA_ELEGIR)
  })

  it("no declara routing_model: sin endpoint lo genera Meta", () => {
    expect(FLOW.routing_model).toBeUndefined()
  })

  it("no usa endpoint — ni data_exchange ni data_channel_uri", () => {
    const json = JSON.stringify(FLOW)
    expect(json).not.toContain("data_exchange")
    expect(json).not.toContain("data_channel_uri")
    expect(json).not.toContain("data_api_version")
  })

  it("la pantalla terminal tiene Footer, que Meta exige", () => {
    const hijos = FLOW.screens[0].layout.children
    expect(hijos.at(-1).type).toBe("Footer")
    expect(hijos.at(-1)["on-click-action"].name).toBe("complete")
  })

  it("no promete que el turno ya quedó reagendado", () => {
    // Al tocar el botón la reserva todavía no pasó: ocurre en el webhook.
    // Decir lo contrario sería el caso de Norma a escala.
    const json = JSON.stringify(FLOW).toLowerCase()
    expect(json).not.toContain("reagendado")
    expect(json).not.toContain("confirmado")
  })
})
