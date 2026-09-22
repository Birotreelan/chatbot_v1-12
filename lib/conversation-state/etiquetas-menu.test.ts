/**
 * lib/conversation-state/etiquetas-menu.test.ts
 *
 * El riesgo de este cambio no es que no reemplace: es que reemplace de más.
 * El texto "Realizar otra consulta" aparece en prompts, en comentarios y en
 * frases explicativas, no sólo en las líneas del menú. Tocar cualquiera de esos
 * cambiaría el comportamiento del bot para todos los clientes.
 *
 * Por eso la mitad de los tests son sobre lo que NO se toca.
 */

import { describe, it, expect } from "vitest"
import {
  personalizarMenu,
  personalizarBotones,
  tituloBotonOtraConsulta,
  esBotonOtraConsulta,
  mencionaOtraConsulta,
  ETIQUETA_OTRA_CONSULTA,
  BOTON_OTRA_CONSULTA,
  LIMITE_TITULO_BOTON,
} from "./etiquetas-menu"

const PROPIA = "Realizar otra consulta o solicitar turno de estudios"

/** El menú real del caso, tal cual lo arma patient-templates.ts. */
const MENU = `*Ana, ¡bienvenido de nuevo a Instituto Santa Lucia Paraná!*

Soy Iris, tu asistente virtual de inteligencia artificial. Por este canal podrás solicitar, consultar, confirmar o cancelar turnos.

Veo que actualmente no tenés turnos agendados. ¿En qué te puedo ayudar?

1- Solicitar turno médico
2- Solicitar turno para un familiar
3- Realizar otra consulta

Respondé con el número o presioná el botón de tu preferencia.`

describe("el caso pedido", () => {
  it("reemplaza la línea 3 y deja el resto igual", () => {
    const r = personalizarMenu(MENU, PROPIA)
    expect(r).toContain(`3- ${PROPIA}`)
    expect(r).toContain("1- Solicitar turno médico")
    expect(r).toContain("2- Solicitar turno para un familiar")
    expect(r).toContain("Respondé con el número o presioná el botón de tu preferencia.")
  })

  it("no renumera ni agrega opciones", () => {
    // Es un cambio de etiqueta. Si apareciera un "4-", el action map quedaría
    // corto y ese número no ejecutaría nada — el bug de Liliana otra vez.
    const r = personalizarMenu(MENU, PROPIA)
    expect(r).not.toContain("4-")
    expect(r.match(/^\s*\d+[.\-)]/gm)).toHaveLength(3)
  })

  it("funciona con cualquier numeración, porque cada menú tiene la suya", () => {
    // Obra social bloqueada la numera 2; el menú de cirugías, 4.
    expect(personalizarMenu("2- Realizar otra consulta", PROPIA)).toBe(`2- ${PROPIA}`)
    expect(personalizarMenu("4- Realizar otra consulta", PROPIA)).toBe(`4- ${PROPIA}`)
    expect(personalizarMenu("1. Realizar otra consulta", PROPIA)).toBe(`1. ${PROPIA}`)
  })

  it("reemplaza todas las apariciones si un mensaje trae más de un menú", () => {
    const dos = "1- Realizar otra consulta\n\ntexto\n\n3- Realizar otra consulta"
    const r = personalizarMenu(dos, PROPIA)
    expect(r.split(PROPIA)).toHaveLength(3)
  })
})

describe("lo que NO se toca", () => {
  it("la frase suelta, fuera de una línea numerada", () => {
    const prompt = 'Un paciente eligió la opción "Realizar otra consulta" en el menú y escribió algo.'
    expect(personalizarMenu(prompt, PROPIA)).toBe(prompt)
  })

  it("la frase en medio de una oración", () => {
    const texto = "Si querés Realizar otra consulta, escribinos."
    expect(personalizarMenu(texto, PROPIA)).toBe(texto)
  })

  it("una línea numerada que dice otra cosa", () => {
    const otro = "3- Solicitar turno médico"
    expect(personalizarMenu(otro, PROPIA)).toBe(otro)
  })

  it("sin etiqueta propia devuelve el mensaje intacto — el caso de todos los demás clientes", () => {
    for (const etiqueta of [undefined, null, "", "   "]) {
      expect(personalizarMenu(MENU, etiqueta)).toBe(MENU)
    }
  })

  it("una etiqueta igual a la de siempre tampoco hace nada", () => {
    expect(personalizarMenu(MENU, ETIQUETA_OTRA_CONSULTA)).toBe(MENU)
  })

  it("un mensaje vacío no rompe", () => {
    expect(personalizarMenu("", PROPIA)).toBe("")
  })
})

describe("mencionaOtraConsulta — evita leer la config en cada mensaje", () => {
  it("es true sólo cuando hay algo que reemplazar", () => {
    expect(mencionaOtraConsulta(MENU)).toBe(true)
    expect(mencionaOtraConsulta("Tu turno quedó confirmado.")).toBe(false)
    expect(mencionaOtraConsulta("")).toBe(false)
  })
})

describe("el botón, que tiene el límite de 20 de WhatsApp", () => {
  it("sin título propio deja el de siempre", () => {
    for (const t of [undefined, null, "", "  "]) {
      expect(tituloBotonOtraConsulta(t)).toBe(BOTON_OTRA_CONSULTA)
    }
  })

  it("acepta un título propio que entre", () => {
    expect(tituloBotonOtraConsulta("Consulta o estudios")).toBe("Consulta o estudios")
  })

  it("acorta en vez de dejar que WhatsApp rechace el mensaje entero", () => {
    // Pasarse no trunca: el mensaje interactivo se rechaza y el paciente se
    // queda sin ningún botón.
    const largo = tituloBotonOtraConsulta(PROPIA)
    expect(largo.length).toBeLessThanOrEqual(LIMITE_TITULO_BOTON)
    expect(largo).toMatch(/…$/)
  })

  it("reemplaza sólo el botón de otra consulta", () => {
    const botones = [
      { id: "1", title: "Solicitar turno" },
      { id: "2", title: "Turno para familiar" },
      { id: "3", title: BOTON_OTRA_CONSULTA },
    ]
    const r = personalizarBotones(botones, "Consulta o estudios")!
    expect(r[0].title).toBe("Solicitar turno")
    expect(r[1].title).toBe("Turno para familiar")
    expect(r[2].title).toBe("Consulta o estudios")
  })

  it("sin título propio devuelve los botones sin tocar", () => {
    const botones = [{ id: "3", title: BOTON_OTRA_CONSULTA }]
    expect(personalizarBotones(botones, "")).toBe(botones)
    expect(personalizarBotones(undefined, "x")).toBeUndefined()
  })
})

describe("esBotonOtraConsulta — el interceptor global tiene que seguir funcionando", () => {
  it("reconoce el título propio", () => {
    expect(esBotonOtraConsulta("Consulta o estudios", "Consulta o estudios")).toBe(true)
  })

  it("sigue reconociendo el título de siempre", () => {
    // Un menú enviado ayer sigue en el chat con los botones viejos. Si dejáramos
    // de reconocerlos, tocar ese botón no interrumpiría el sub-flujo activo y el
    // paciente quedaría atrapado.
    expect(esBotonOtraConsulta("Otra consulta", "Consulta o estudios")).toBe(true)
    expect(esBotonOtraConsulta("otra consulta", null)).toBe(true)
  })

  it("no reconoce cualquier otra cosa", () => {
    for (const t of ["", "Solicitar turno", "Cancelar", "consulta"]) {
      expect(esBotonOtraConsulta(t, "Consulta o estudios"), t).toBe(false)
    }
  })

  it("reconoce el título propio ya acortado, que es el que viaja en el botón", () => {
    const acortado = tituloBotonOtraConsulta(PROPIA)
    expect(esBotonOtraConsulta(acortado, PROPIA)).toBe(true)
  })
})
