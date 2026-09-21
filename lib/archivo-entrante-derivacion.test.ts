/**
 * lib/archivo-entrante-derivacion.test.ts
 *
 * Las tres reglas de qué pasa cuando un paciente manda un archivo, probadas
 * contra un Redis de mentira. Lo que se verifica no es el mensaje que se le
 * manda al paciente (eso vive en whatsapp.tsx) sino la parte que no se puede
 * mirar a ojo: que cinco fotos seguidas no creen cinco sesiones, y que el
 * motivo cuente en vez de repetirse.
 *
 * El caso que justifica la mitad de estos tests: fotografiar una orden médica
 * son cuatro o cinco fotos, cada una es un webhook, y la cola por usuario
 * (`enqueueUserMessage`) recién actúa al final de `handleMessage`. Estos
 * bloques NO están serializados entre sí.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Redis de mentira, con el `set` NX que es lo que se está probando ─────────

const almacen = new Map<string, string>()
const pendientes = new Set<string>()

const redisFalso = {
  async get(key: string) {
    return almacen.has(key) ? almacen.get(key)! : null
  },
  async set(key: string, value: string, opts?: { nx?: true; ex?: number }) {
    // Esto es exactamente lo que el cliente de Upstash hace: `"nx" in opts`.
    // Si alguien vuelve a escribir `NX` en mayúscula, estos tests lo atrapan,
    // porque el lock deja de bloquear.
    if (opts && "nx" in opts && opts.nx && almacen.has(key)) return null
    almacen.set(key, value)
    return "OK"
  },
  async del(key: string) {
    almacen.delete(key)
    return 1
  },
  async zadd(_k: string, entry: { member: string }) {
    pendientes.add(entry.member)
    return 1
  },
  async zrem(_k: string, m: string) {
    pendientes.delete(m)
    return 1
  },
  async setex(key: string, _ttl: number, value: string) {
    almacen.set(key, value)
    return "OK"
  },
  async sadd() {
    return 1
  },
  async expire() {
    return 1
  },
  async rpush() {
    return 1
  },
  async lrange() {
    return []
  },
}

vi.mock("./redis", () => ({ getRedisClient: () => redisFalso }))
vi.mock("./conversations", () => ({ setConversationPaused: async () => {} }))
vi.mock("./db", () => ({ getWhatsAppConfigById: async () => null }))
vi.mock("./whatsapp-api", () => ({ sendWhatsAppMessage: async () => {} }))

import { registrarArchivoEntrante, getActiveSessionByPhone, createSupportSession } from "./human-support"

const BASE = {
  configId: "cfg1",
  phoneNumber: "5491144175052",
  tenantId: "clinica1",
  threadId: "thread_1",
  assistantId: "asst_1",
  displayName: "Salud Ocular",
}

beforeEach(() => {
  almacen.clear()
  pendientes.clear()
})

describe("regla 1: sin sesión abierta, se deriva", () => {
  it("crea una sesión con el motivo del archivo", async () => {
    const r = await registrarArchivoEntrante(BASE)
    expect(r?.resultado).toBe("creada")
    expect(r?.session?.reason).toBe("Envío de archivo (1 archivo)")
    expect(r?.session?.status).toBe("pending")
  })

  it("la sesión queda buscable por teléfono, que es lo que mira el panel", async () => {
    await registrarArchivoEntrante(BASE)
    const encontrada = await getActiveSessionByPhone(BASE.configId, BASE.phoneNumber)
    expect(encontrada).not.toBeNull()
  })

  it("el resumen le explica al agente por qué le llegó esto", async () => {
    const r = await registrarArchivoEntrante(BASE)
    expect(r?.session?.summary).toContain("archivo")
  })
})

describe("el caso de las cinco fotos seguidas", () => {
  it("crea UNA sola sesión, no cinco", async () => {
    for (let i = 0; i < 5; i++) await registrarArchivoEntrante(BASE)
    expect(pendientes.size).toBe(1)
  })

  it("y cuenta los cinco archivos en el motivo", async () => {
    for (let i = 0; i < 5; i++) await registrarArchivoEntrante(BASE)
    const s = await getActiveSessionByPhone(BASE.configId, BASE.phoneNumber)
    expect(s!.reason).toBe("Envío de archivo (5 archivos)")
  })

  it("solo la primera avisa al paciente; las otras cuatro no", async () => {
    const resultados: string[] = []
    for (let i = 0; i < 5; i++) {
      const r = await registrarArchivoEntrante(BASE)
      resultados.push(r!.resultado)
    }
    expect(resultados.filter((x) => x === "creada")).toHaveLength(1)
    expect(resultados.slice(1).every((x) => x === "anotada")).toBe(true)
  })

  it("dos webhooks a la vez no se pisan: el lock los ordena", async () => {
    // Sin lock los dos verían "no hay sesión", crearían dos, y la segunda
    // pisaría el puntero por teléfono dejando la primera huérfana con el
    // primer archivo adentro.
    const [a, b] = await Promise.all([registrarArchivoEntrante(BASE), registrarArchivoEntrante(BASE)])
    expect(pendientes.size).toBe(1)
    expect([a?.resultado, b?.resultado].filter((x) => x === "creada")).toHaveLength(1)
  })

  it("el que pierde la carrera no reporta una falla que no ocurrió", async () => {
    // El bug que esto atrapa: el webhook perdedor devolvía null porque miraba
    // si había sesión antes de que el ganador terminara de crearla. El
    // llamador leía ese null como "no se pudo derivar" y le mandaba al
    // paciente "hubo un problema", mientras el otro webhook lo derivaba bien.
    const [a, b] = await Promise.all([registrarArchivoEntrante(BASE), registrarArchivoEntrante(BASE)])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    for (const r of [a!, b!]) {
      expect(["creada", "anotada", "abierta", "en_curso"]).toContain(r.resultado)
    }
  })

  it("el lock se libera: el archivo siguiente se puede contar igual", async () => {
    await registrarArchivoEntrante(BASE)
    await registrarArchivoEntrante(BASE)
    expect([...almacen.keys()].some((k) => k.startsWith("human_support:lock:archivo:"))).toBe(false)
  })
})

describe("regla 3: ya hay una sesión", () => {
  it("si está esperando agente, le suma el archivo al motivo que ya tenía", async () => {
    await createSupportSession({
      ...BASE,
      reason: "Solicitud o consulta sobre estudios",
      priority: "medium",
      summary: "x",
    })

    const r = await registrarArchivoEntrante(BASE)
    expect(r?.resultado).toBe("anotada")
    expect(r?.session?.reason).toBe("Solicitud o consulta sobre estudios (1 archivo)")
  })

  it("si un agente ya la tiene abierta, NO le toca el motivo", async () => {
    const s = await createSupportSession({
      ...BASE,
      reason: "Recetas",
      priority: "medium",
      summary: "x",
    })
    // Simular la asignación sin pasar por el lock de assignSessionToAgent.
    s.status = "in_progress"
    s.assignedTo = "agente1"
    almacen.set(`human_support:session:${s.id}`, JSON.stringify(s))

    const r = await registrarArchivoEntrante(BASE)
    expect(r?.resultado).toBe("abierta")
    expect(r?.session?.reason).toBe("Recetas")
  })

  it("una sesión de otro paciente no se toca", async () => {
    await registrarArchivoEntrante(BASE)
    const otro = await registrarArchivoEntrante({ ...BASE, phoneNumber: "5491100000000" })
    expect(otro?.resultado).toBe("creada")
    expect(pendientes.size).toBe(2)
  })

  it("la misma persona en otra clínica es otra sesión", async () => {
    await registrarArchivoEntrante(BASE)
    const otra = await registrarArchivoEntrante({ ...BASE, configId: "cfg2" })
    expect(otra?.resultado).toBe("creada")
  })
})
