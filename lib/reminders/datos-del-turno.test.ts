/**
 * lib/reminders/datos-del-turno.test.ts
 *
 * Los dos templates de estos tests son los reales, copiados de los logs de
 * producción del 17/9/2026. El de cancelación es el que destapó el bug: sus
 * parámetros no empiezan con el nombre de la clínica, así que la lectura
 * posicional corría todos los campos un lugar.
 *
 * El test que más importa es el último de cada grupo: que un template
 * DESCONOCIDO no invente un profesional a partir de lo que haya en esa
 * posición. Preferimos un campo vacío a uno equivocado — un dato equivocado se
 * guarda en Redis y después el bot razona sobre él.
 */

import { describe, it, expect } from "vitest"
import { extraerDatosDelTurno } from "./datos-del-turno"

const RECORDATORIO = JSON.stringify({
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
})

const DATOS_RECORDATORIO = {
  paciente: { nombres: "Ariel", apellido: "RIZZI", dni: "27158093" },
  turnos: [
    {
      fecha: "2026-09-19",
      fecha_formateada: "19/09/2026",
      hora: "08:00:00",
      hora_formateada: "08:00",
      profesional: "TRAVERSO ALVARADO ARIANNA ANDREA",
      sede: "SALUD OCULAR CALLAO",
      direccion: "Av. Callao 710",
      agenda_id: "3755379",
    },
  ],
  tipo_mensaje: "confirmacion_turno",
}

const CANCELACION = JSON.stringify({
  template: {
    name: "cancelar_turno_solicitado",
    language: { code: "es_AR" },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: "3 de octubre de 2026" },
          { type: "text", text: "08:50" },
          { type: "text", text: "TRAVERSO ALVARADO, ARIANNA ANDREA" },
          { type: "text", text: "0800-345-9393" },
        ],
      },
    ],
  },
})

const DATOS_CANCELACION = {
  fecha: "3 de octubre de 2026",
  fecha_formateada: "3 de octubre de 2026",
  hora: "08:50",
  hora_formateada: "08:50",
  profesional: "TRAVERSO ALVARADO, ARIANNA ANDREA",
  telefono_contacto: "0800-345-9393",
  tipo_mensaje: "turno_cancelado_clinica",
}

describe("el caso que rompía: aviso de cancelación de la clínica", () => {
  it("ya no corre los campos un lugar", () => {
    const r = extraerDatosDelTurno(CANCELACION, DATOS_CANCELACION)
    expect(r.fecha).toBe("3 de octubre de 2026")
    expect(r.hora).toBe("08:50")
    expect(r.profesional).toBe("TRAVERSO ALVARADO, ARIANNA ANDREA")
  })

  it("nunca guarda el teléfono de contacto como profesional", () => {
    const r = extraerDatosDelTurno(CANCELACION, DATOS_CANCELACION)
    expect(r.profesional).not.toContain("0800")
    expect(r.hora).not.toContain("TRAVERSO")
    expect(r.fecha).not.toBe("08:50")
  })

  it("sin Chatbot_Data reconoce fecha y hora por su forma, y no inventa el resto", () => {
    const r = extraerDatosDelTurno(CANCELACION, null)
    expect(r.fecha).toBe("3 de octubre de 2026")
    expect(r.hora).toBe("08:50")
    // Es un template sin layout declarado: preferimos vacío antes que corrido.
    expect(r.profesional).toBeNull()
  })
})

describe("recordatorio de turno: sigue funcionando como antes", () => {
  it("lee los datos desde turnos[0]", () => {
    const r = extraerDatosDelTurno(RECORDATORIO, DATOS_RECORDATORIO)
    expect(r.fecha).toBe("19/09/2026")
    expect(r.hora).toBe("08:00")
    expect(r.profesional).toBe("TRAVERSO ALVARADO ARIANNA ANDREA")
    expect(r.lugar).toBe("Av. Callao 710")
  })

  it("prefiere el formato legible sobre el crudo", () => {
    const r = extraerDatosDelTurno(RECORDATORIO, DATOS_RECORDATORIO)
    expect(r.fecha).not.toBe("2026-09-19")
    expect(r.hora).not.toBe("08:00:00")
  })

  it("sin Chatbot_Data usa el layout declarado de ese template", () => {
    const r = extraerDatosDelTurno(RECORDATORIO, null)
    expect(r.fecha).toBe("19/09/2026")
    expect(r.hora).toBe("08:00")
    expect(r.profesional).toBe("TRAVERSO ALVARADO ARIANNA ANDREA")
    expect(r.lugar).toBe("Av. Callao 710")
  })

  it("el nombre de la clínica no se cuela como dato del turno", () => {
    const r = extraerDatosDelTurno(RECORDATORIO, null)
    expect(Object.values(r)).not.toContain("SALUD OCULAR CALLAO")
  })
})

describe("un template nuevo no puede desalinear nada", () => {
  const DESCONOCIDO = JSON.stringify({
    template: {
      name: "template_que_no_existe_todavia",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Dr. House" },
            { type: "text", text: "una nota cualquiera" },
            { type: "text", text: "25/12/2026" },
            { type: "text", text: "14:30" },
          ],
        },
      ],
    },
  })

  it("reconoce fecha y hora aunque estén en cualquier posición", () => {
    const r = extraerDatosDelTurno(DESCONOCIDO, null)
    expect(r.fecha).toBe("25/12/2026")
    expect(r.hora).toBe("14:30")
  })

  it("no asigna profesional ni lugar por posición", () => {
    const r = extraerDatosDelTurno(DESCONOCIDO, null)
    expect(r.profesional).toBeNull()
    expect(r.lugar).toBeNull()
  })

  it("con Chatbot_Data, ese template desconocido igual sale completo", () => {
    const r = extraerDatosDelTurno(DESCONOCIDO, DATOS_CANCELACION)
    expect(r.profesional).toBe("TRAVERSO ALVARADO, ARIANNA ANDREA")
  })
})

describe("entradas rotas no tiran la extracción", () => {
  it("body vacío, nulo o no parseable", () => {
    for (const entrada of [null, undefined, "", "{no es json", "{}"]) {
      expect(() => extraerDatosDelTurno(entrada, null)).not.toThrow()
      expect(extraerDatosDelTurno(entrada, null).fecha).toBeNull()
    }
  })

  it("template sin componentes", () => {
    const r = extraerDatosDelTurno(JSON.stringify({ template: { name: "x" } }), null)
    expect(r.fecha).toBeNull()
  })

  it("Chatbot_Data con turnos vacío cae a los campos de la raíz", () => {
    const r = extraerDatosDelTurno(CANCELACION, { ...DATOS_CANCELACION, turnos: [] })
    expect(r.fecha).toBe("3 de octubre de 2026")
  })

  it("campos en blanco en Chatbot_Data no tapan al respaldo", () => {
    const r = extraerDatosDelTurno(RECORDATORIO, { fecha: "   ", hora: "" })
    expect(r.fecha).toBe("19/09/2026")
    expect(r.hora).toBe("08:00")
  })
})
