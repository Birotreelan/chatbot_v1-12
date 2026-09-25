/**
 * lib/flows/recordatorio-con-botones.test.ts
 *
 * Lo que se protege acá es la transparencia de la reescritura: el sistema de la
 * clínica manda su template como siempre y nosotros le cambiamos el nombre y le
 * agregamos los payloads de los botones. Si en el camino se pierde o se corre
 * un parámetro, el paciente recibe el turno de otro día — que es exactamente el
 * bug que tuvimos con `cancelar_turno_solicitado` leyendo parámetros por
 * posición.
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
  PAYLOAD_REAGENDAR,
  CUERPO_VIGENTE,
  CUERPO_CON_BOTONES,
  ENCABEZADO_CON_BOTONES,
  EJEMPLOS_VIGENTES,
} from "./recordatorio-con-botones"
import {
  construirDatosDeLaPantalla,
  construirFlowJson,
  MAX_TURNOS_OFRECIDOS,
  OPCION_NINGUNO,
  PANTALLA_ELEGIR,
} from "./flow-reagendar"
import { construirMensajeFlow, CTA_REAGENDAR } from "./mensaje-flow"

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

const PARAMS = { nombreTemplateFlows: "confirmacion_1_flows" }

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
    expect(r.template.name).toBe("confirmacion_1_flows")
  })
})

describe("los botones que se agregan", () => {
  it("cambia el nombre del template por el de la versión con Flows", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    expect(r.template.name).toBe("confirmacion_1_flows")
  })

  it("agrega los dos payloads con sus índices", () => {
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const botones = r.template.components.filter((c: any) => c.type === "button")
    expect(botones).toHaveLength(2)
    expect(botones.map((b: any) => b.index)).toEqual(["0", "1"])
    expect(botones.map((b: any) => b.parameters[0].payload)).toEqual([PAYLOAD_CONFIRMAR, PAYLOAD_CANCELAR])
  })

  it("NUNCA manda un componente en el índice 2", () => {
    // Éste es el test que importa. La plantilla aprobada tiene dos botones:
    // un componente en el índice 2 hace que Meta rechace el envío entero y
    // ese día ningún paciente del cliente recibe su recordatorio.
    //
    // Mandar de menos no rompe: el botón se muestra igual y al tocarlo
    // WhatsApp devuelve su título, que `accionDelBoton` sabe rutear. Por eso
    // la afirmación es "nunca 2" y no "siempre 0 y 1".
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const indices = r.template.components.filter((c: any) => c.type === "button").map((b: any) => String(b.index))
    expect(indices).not.toContain("2")
    expect(JSON.stringify(r)).not.toContain(PAYLOAD_REAGENDAR)
  })

  it("los dos son quick_reply: la plantilla no lleva botón de Flow", () => {
    // Sin mezclar tipos, el recordatorio también se ve en WhatsApp Desktop.
    const r = agregarBotonesAlEnvio(BODY_DE_LA_CLINICA, PARAMS)!
    const subtipos = r.template.components.filter((c: any) => c.type === "button").map((b: any) => b.sub_type)
    expect(subtipos).toEqual(["quick_reply", "quick_reply"])
    expect(JSON.stringify(r)).not.toContain("flow_token")
  })
})

describe("cuándo NO reescribe", () => {
  it("un payload que no es un template", () => {
    for (const entrada of [null, undefined, "", "{roto", {}, { template: {} }, 42]) {
      expect(agregarBotonesAlEnvio(entrada, PARAMS)).toBeNull()
    }
  })

  it("un template que ya trae botones propios", () => {
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
    expect(accionDelBoton({ payload: PAYLOAD_REAGENDAR })).toBe("reagendar")
  })

  it("cae al texto del botón cuando no vino el payload", () => {
    expect(accionDelBoton({ text: BOTON_CONFIRMAR })).toBe("confirmar")
    expect(accionDelBoton({ text: BOTON_CANCELAR })).toBe("cancelar")
    expect(accionDelBoton({ text: BOTON_REAGENDAR })).toBe("reagendar")
  })

  it("no depende de las mayúsculas", () => {
    // La plantilla aprobada dice "Confirmar Asistencia" con A mayúscula. Una
    // comparación sensible a mayúsculas habría dejado el botón sin rutear, y la
    // diferencia es invisible al leer el código.
    expect(accionDelBoton({ text: "confirmar asistencia" })).toBe("confirmar")
    expect(accionDelBoton({ text: "CONFIRMAR ASISTENCIA" })).toBe("confirmar")
    expect(accionDelBoton({ text: "Reprogramar Turno" })).toBe("reagendar")
  })

  it("no matchea por substring", () => {
    expect(accionDelBoton({ text: "quiero cancelar turno pero otro" })).toBeNull()
    expect(accionDelBoton({ text: "Confirmar asistencia de mi hija" })).toBeNull()
  })

  it("cualquier otra cosa sigue su camino por el motor conversacional", () => {
    for (const entrada of [null, undefined, {}, { text: "" }, { text: "hola" }]) {
      expect(accionDelBoton(entrada)).toBeNull()
    }
  })

  it("sigue aceptando las etiquetas del template viejo", () => {
    // Un recordatorio mandado ayer se queda en el chat del paciente.
    expect(accionDelBoton({ text: "Confirmar" })).toBe("confirmar")
    expect(accionDelBoton({ text: "Cancelar" })).toBe("cancelar")
  })
})

describe("las etiquetas entran en el límite de Meta", () => {
  it("ninguna supera los 25 caracteres", () => {
    for (const etiqueta of [BOTON_CONFIRMAR, BOTON_CANCELAR, BOTON_REAGENDAR]) {
      expect(etiqueta.length, etiqueta).toBeLessThanOrEqual(25)
    }
  })
})

describe("el cuerpo del template", () => {
  it("conserva los cinco parámetros del template vigente", () => {
    for (const cuerpo of [CUERPO_VIGENTE, CUERPO_CON_BOTONES]) {
      for (let i = 1; i <= 5; i++) {
        expect(cuerpo, `{{${i}}}`).toContain(`{{${i}}}`)
      }
      expect(cuerpo).not.toContain("{{6}}")
    }
  })

  it("hay un ejemplo por cada parámetro", () => {
    expect(EJEMPLOS_VIGENTES).toHaveLength(5)
  })
})

describe("definicionDeTemplate", () => {
  const DEF = definicionDeTemplate({
    nombre: "confirmacion_1_flows",
    idioma: "es_AR",
    cuerpo: CUERPO_CON_BOTONES,
    ejemplos: EJEMPLOS_VIGENTES,
    encabezado: ENCABEZADO_CON_BOTONES,
  })

  it("pide categoría utility", () => {
    expect(DEF.category).toBe("UTILITY")
  })

  it("incluye el encabezado cuando se lo pasan", () => {
    const header: any = DEF.components.find((c: any) => c.type === "HEADER")
    expect(header.format).toBe("TEXT")
    expect(header.text).toBe(ENCABEZADO_CON_BOTONES)
  })

  it("lo omite cuando no", () => {
    const sin = definicionDeTemplate({
      nombre: "x", idioma: "es_AR", cuerpo: CUERPO_VIGENTE, ejemplos: EJEMPLOS_VIGENTES,
    })
    expect(sin.components.some((c: any) => c.type === "HEADER")).toBe(false)
  })

  it("los dos botones son quick reply", () => {
    const botones: any = DEF.components.find((c: any) => c.type === "BUTTONS")
    expect(botones.buttons.map((b: any) => b.type)).toEqual(["QUICK_REPLY", "QUICK_REPLY"])
    expect(botones.buttons.map((b: any) => b.text)).toEqual([BOTON_CONFIRMAR, BOTON_CANCELAR])
  })

  it("el cuerpo no promete una opción que no está entre los botones", () => {
    // Si el texto ofrece reprogramar y el botón no existe, el paciente busca
    // algo que no está. El reagendamiento se ofrece dentro del portal.
    expect(CUERPO_CON_BOTONES.toLowerCase()).not.toContain("reprogram")
  })
})

describe("los datos que viajan dentro del mensaje de Flow", () => {
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
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: turnos })
    expect(d.turnos_disponibles.at(-1)!.id).toBe(OPCION_NINGUNO)
  })

  it("acorta los títulos largos en vez de dejar que Meta rechace el mensaje", () => {
    const d = construirDatosDeLaPantalla({
      turnoActual: "x",
      turnosDisponibles: [{ id: "a", title: "Un título larguísimo que no entra en treinta caracteres" }],
    })
    expect(d.turnos_disponibles[0].title.length).toBeLessThanOrEqual(30)
  })

  it("una lista vacía igual ofrece la salida", () => {
    const d = construirDatosDeLaPantalla({ turnoActual: "x", turnosDisponibles: [] })
    expect(d.turnos_disponibles).toHaveLength(1)
    expect(d.turnos_disponibles[0].id).toBe(OPCION_NINGUNO)
  })
})

describe("el mensaje que abre el Flow", () => {
  const DATOS = construirDatosDeLaPantalla({
    turnoActual: "jueves 25/09 a las 08:25",
    turnosDisponibles: [{ id: "ag1|2026-09-26|08:25", title: "Vie 26/09 · 08:25" }],
  })

  const MSG: any = construirMensajeFlow({
    to: "5491144175052",
    flowId: "123456",
    flowToken: "tok_abc",
    cuerpo: "Elegí un nuevo horario para tu turno.",
    datosDeLaPantalla: DATOS,
  })

  it("lleva el token, que es lo que identifica la conversación al volver", () => {
    expect(MSG.interactive.action.parameters.flow_token).toBe("tok_abc")
  })

  it("abre en la pantalla correcta con los datos adentro", () => {
    const payload = MSG.interactive.action.parameters.flow_action_payload
    expect(payload.screen).toBe(PANTALLA_ELEGIR)
    expect(payload.data).toEqual(DATOS)
  })

  it("usa navigate: el Flow no llama a ningún endpoint nuestro", () => {
    // Un data_exchange acá nos metería en el requisito de responder en menos de
    // un segundo, con el riesgo de que Meta throttlee el Flow a 10 mensajes por
    // hora. Ver la nota en flow-reagendar.ts.
    expect(MSG.interactive.action.parameters.flow_action).toBe("navigate")
    expect(JSON.stringify(MSG)).not.toContain("data_exchange")
  })

  it("el CTA entra en el límite de 30 caracteres", () => {
    expect(MSG.interactive.action.parameters.flow_cta.length).toBeLessThanOrEqual(30)
    expect(MSG.interactive.action.parameters.flow_cta).toBe(CTA_REAGENDAR)
  })

  it("acorta un CTA demasiado largo en vez de que WhatsApp rechace el mensaje", () => {
    const m: any = construirMensajeFlow({
      to: "1", flowId: "1", flowToken: "t", cuerpo: "c", datosDeLaPantalla: {},
      cta: "Ver todos los horarios disponibles para reprogramar",
    })
    expect(m.interactive.action.parameters.flow_cta.length).toBeLessThanOrEqual(30)
  })

  it("permite mandar el Flow en borrador para probarlo sin publicarlo", () => {
    const m: any = construirMensajeFlow({
      to: "1", flowId: "1", flowToken: "t", cuerpo: "c", datosDeLaPantalla: {}, modo: "draft",
    })
    expect(m.interactive.action.parameters.mode).toBe("draft")
  })

  it("sin modo no manda el campo, y Meta asume publicado", () => {
    expect(MSG.interactive.action.parameters.mode).toBeUndefined()
  })

  it("encabezado y pie son opcionales", () => {
    expect(MSG.interactive.header).toBeUndefined()
    expect(MSG.interactive.footer).toBeUndefined()
    const m: any = construirMensajeFlow({
      to: "1", flowId: "1", flowToken: "t", cuerpo: "c", datosDeLaPantalla: {},
      encabezado: "Reprogramar", pie: "Instituto Santa Lucía",
    })
    expect(m.interactive.header).toEqual({ type: "text", text: "Reprogramar" })
    expect(m.interactive.footer).toEqual({ text: "Instituto Santa Lucía" })
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
    const json = JSON.stringify(FLOW).toLowerCase()
    expect(json).not.toContain("reagendado")
    expect(json).not.toContain("confirmado")
  })
})
