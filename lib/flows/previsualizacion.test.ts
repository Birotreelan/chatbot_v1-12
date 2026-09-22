/**
 * lib/flows/previsualizacion.test.ts
 *
 * La previsualización existe para decidir si los textos están bien ANTES de
 * publicar, y publicar no se deshace. Así que el riesgo no es que se vea feo:
 * es que muestre algo distinto de lo que el paciente va a ver, y que confiemos
 * en eso.
 *
 * De ahí los dos grupos que importan: que resuelva las referencias como las
 * resuelve WhatsApp, y que lo que no entiende se VEA en vez de desaparecer.
 */

import { describe, it, expect } from "vitest"
import { previsualizarFlow, previsualizarPantalla } from "./previsualizacion"
import { construirFlowJson, PANTALLA_ELEGIR, OPCION_NINGUNO } from "./flow-reagendar"

const PANTALLA = previsualizarFlow(construirFlowJson())[0]

describe("el Flow real", () => {
  it("es una sola pantalla, terminal", () => {
    expect(previsualizarFlow(construirFlowJson())).toHaveLength(1)
    expect(PANTALLA.id).toBe(PANTALLA_ELEGIR)
    expect(PANTALLA.terminal).toBe(true)
  })

  it("entiende todos sus componentes", () => {
    expect(PANTALLA.componentes.map((c) => c.tipo)).toEqual(["parrafo", "subtitulo", "opciones", "boton"])
  })

  it("muestra la lista con la opción de escape", () => {
    const opciones = PANTALLA.componentes.find((c) => c.tipo === "opciones")
    expect(opciones).toBeDefined()
    if (opciones?.tipo === "opciones") {
      expect(opciones.opciones.some((o) => o.id === OPCION_NINGUNO)).toBe(true)
    }
  })

  it("termina en el botón que cierra el Flow", () => {
    expect(PANTALLA.componentes.at(-1)).toEqual({ tipo: "boton", texto: "Confirmar cambio" })
  })
})

describe("referencias a datos", () => {
  it("resuelve una referencia embebida en una frase", () => {
    // El bug que esto atrapó: la primera versión sólo manejaba la referencia
    // sola, y la frase se veía con el "${data.turno_actual}" crudo.
    const parrafo = PANTALLA.componentes[0]
    expect(parrafo.tipo).toBe("parrafo")
    if (parrafo.tipo === "parrafo") {
      expect(parrafo.texto).not.toContain("${")
      expect(parrafo.texto).toContain("08:25")
    }
  })

  it("resuelve una referencia sola devolviendo el valor entero, no su texto", () => {
    // Así se pasa un array a un data-source: si se convirtiera a string, la
    // lista de opciones quedaría vacía.
    const p = previsualizarPantalla({
      id: "X",
      data: { items: { type: "array", __example__: [{ id: "a", title: "A" }] } },
      layout: { children: [{ type: "RadioButtonsGroup", label: "L", "data-source": "${data.items}" }] },
    })
    expect(p.componentes[0]).toEqual({
      tipo: "opciones",
      etiqueta: "L",
      opciones: [{ id: "a", title: "A" }],
    })
  })

  it("deja la referencia cruda si el campo no existe, como aviso", () => {
    const p = previsualizarPantalla({
      id: "X",
      data: {},
      layout: { children: [{ type: "TextBody", text: "${data.noExiste}" }] },
    })
    expect(p.componentes[0]).toEqual({ tipo: "parrafo", texto: "${data.noExiste}" })
  })
})

describe("lo que no entiende se ve", () => {
  it("un componente desconocido aparece, con su tipo", () => {
    // Una previsualización que oculta lo que no miró es peor que no tenerla:
    // da confianza sobre algo que no revisó.
    const p = previsualizarPantalla({ id: "X", layout: { children: [{ type: "PhotoPicker" }] } })
    expect(p.componentes[0]).toEqual({ tipo: "desconocido", texto: "PhotoPicker" })
  })
})

describe("entradas rotas", () => {
  it("no lanza nunca", () => {
    for (const entrada of [null, undefined, {}, { screens: "x" }, { screens: [null] }]) {
      expect(() => previsualizarFlow(entrada)).not.toThrow()
      expect(Array.isArray(previsualizarFlow(entrada))).toBe(true)
    }
  })

  it("una pantalla sin layout devuelve una lista vacía de componentes", () => {
    expect(previsualizarPantalla({ id: "X" }).componentes).toEqual([])
  })

  it("sin título usa el id, para no mostrar un encabezado vacío", () => {
    expect(previsualizarPantalla({ id: "MI_PANTALLA" }).titulo).toBe("MI_PANTALLA")
  })
})
