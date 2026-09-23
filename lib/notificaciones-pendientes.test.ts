/**
 * lib/notificaciones-pendientes.test.ts
 *
 * El widget de WhatsApp del cliente mostraba "Pendientes: 2" con el panel
 * vacío (23/9/2026). La causa: `human_support:pending` es un índice, y nadie
 * sacaba de ahí a las sesiones que se cerraban SIN haber sido asignadas.
 *
 * Lo que se prueba acá es la regla que lo resuelve, en sus dos mitades:
 *
 *  1. `closeSession` saca la sesión del índice, siempre.
 *  2. `getPendingSessions` no le cree al índice: mira el `status` de cada
 *     sesión, y si discrepan gana el status y el índice se corrige solo.
 *
 * La mitad 2 es la que importa más, y no por redundancia: es la que hace que
 * los fantasmas YA colgados en producción se vayan sin tocar Redis a mano, y
 * la que va a atrapar al próximo camino de cierre que alguien agregue y se
 * olvide del `zrem`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Redis de mentira, con pipeline y zrem variádico ─────────────────────────

const almacen = new Map<string, string>()
const pendientes = new Set<string>()

const redisFalso = {
  async get(key: string) {
    return almacen.has(key) ? almacen.get(key)! : null
  },
  async set(key: string, value: string, opts?: { nx?: true; ex?: number }) {
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
  async zrem(_k: string, ...miembros: string[]) {
    for (const m of miembros) pendientes.delete(m)
    return miembros.length
  },
  async zrange() {
    return [...pendientes]
  },
  async setex(key: string, _ttl: number, value: string) {
    almacen.set(key, value)
    return "OK"
  },
  async sadd() {
    return 1
  },
  async srem() {
    return 1
  },
  async expire() {
    return 1
  },
  pipeline() {
    const claves: string[] = []
    return {
      get(key: string) {
        claves.push(key)
      },
      async exec() {
        return claves.map((k) => (almacen.has(k) ? almacen.get(k)! : null))
      },
    }
  },
}

vi.mock("./redis", () => ({ getRedisClient: () => redisFalso }))
vi.mock("./conversations", () => ({ setConversationPaused: async () => {} }))
vi.mock("./db", () => ({ getWhatsAppConfigById: async () => null, getWhatsAppConfigsByTenant: async () => [] }))
vi.mock("./whatsapp-api", () => ({ sendWhatsAppMessage: async () => {} }))

import {
  createSupportSession,
  closeSession,
  assignSessionToAgent,
  getPendingSessions,
} from "./human-support"

const BASE = {
  configId: "cfg1",
  phoneNumber: "5491144175052",
  tenantId: "clinica1",
  threadId: "thread_1",
  assistantId: "asst_1",
  displayName: "Salud Ocular",
  priority: "medium" as const,
  reason: "Consulta",
  summary: "Quiere hablar con alguien",
}

beforeEach(() => {
  almacen.clear()
  pendientes.clear()
})

describe("una sesión cerrada sin haber sido asignada", () => {
  it("sale del índice de pendientes", async () => {
    const s = await createSupportSession(BASE)
    expect(pendientes.size).toBe(1)

    await closeSession(s.id)

    expect(pendientes.size).toBe(0)
  })

  it("deja de contarse como pendiente", async () => {
    const s = await createSupportSession(BASE)
    await closeSession(s.id)

    expect(await getPendingSessions("clinica1")).toHaveLength(0)
  })
})

describe("el índice y el estado desfasados", () => {
  it("no cuenta la sesión si su status ya no es pending", async () => {
    // Se fuerza a mano el estado que producía el bug: la sesión está resuelta
    // pero su id quedó en el índice. Es exactamente lo que había en Redis.
    const s = await createSupportSession(BASE)
    const resuelta = { ...s, status: "resolved" as const, resolvedAt: new Date().toISOString() }
    almacen.set(`human_support:session:${s.id}`, JSON.stringify(resuelta))
    expect(pendientes.size).toBe(1)

    expect(await getPendingSessions("clinica1")).toHaveLength(0)
  })

  it("además limpia el índice, así el fantasma no vuelve en el próximo poll", async () => {
    const s = await createSupportSession(BASE)
    almacen.set(`human_support:session:${s.id}`, JSON.stringify({ ...s, status: "resolved" }))

    await getPendingSessions("clinica1")

    expect(pendientes.has(s.id)).toBe(false)
  })

  it("saca del índice a las sesiones cuya clave ya venció", async () => {
    const s = await createSupportSession(BASE)
    almacen.delete(`human_support:session:${s.id}`)

    expect(await getPendingSessions("clinica1")).toHaveLength(0)
    expect(pendientes.size).toBe(0)
  })

  it("limpia fantasmas de otros tenants, no sólo del que consulta", async () => {
    // Si sólo se limpiara el propio, el fantasma de una clínica quedaría
    // esperando a que justo esa clínica abra el panel.
    const otra = await createSupportSession({ ...BASE, tenantId: "clinica2", phoneNumber: "5491100000000" })
    almacen.set(`human_support:session:${otra.id}`, JSON.stringify({ ...otra, status: "resolved" }))

    await getPendingSessions("clinica1")

    expect(pendientes.has(otra.id)).toBe(false)
  })
})

describe("lo que NO tiene que cambiar", () => {
  it("una sesión realmente pendiente se sigue contando", async () => {
    await createSupportSession(BASE)

    const pend = await getPendingSessions("clinica1")

    expect(pend).toHaveLength(1)
    expect(pend[0].status).toBe("pending")
  })

  it("el filtro por tenant sigue funcionando", async () => {
    await createSupportSession(BASE)
    await createSupportSession({ ...BASE, tenantId: "clinica2", phoneNumber: "5491100000000" })

    expect(await getPendingSessions("clinica1")).toHaveLength(1)
    expect(await getPendingSessions("clinica2")).toHaveLength(1)
    expect(await getPendingSessions(null)).toHaveLength(2)
  })

  it("asignar una sesión la saca de pendientes (camino de siempre)", async () => {
    const s = await createSupportSession(BASE)

    expect(await assignSessionToAgent(s.id, "clinica1:user_101")).toBe(true)

    expect(await getPendingSessions("clinica1")).toHaveLength(0)
  })

  it("cerrar una sesión ya asignada sigue funcionando", async () => {
    const s = await createSupportSession(BASE)
    await assignSessionToAgent(s.id, "clinica1:user_101")

    expect(await closeSession(s.id)).toBe(true)
    expect(await getPendingSessions("clinica1")).toHaveLength(0)
  })
})
