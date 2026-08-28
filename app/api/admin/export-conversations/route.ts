/**
 * app/api/admin/export-conversations/route.ts
 *
 * Exporta conversaciones reales (anonimizadas) para armar el dataset de
 * evaluación del motor conversacional — ver PLAN-DE-TRABAJO.md, "Fase 0:
 * medición". Sin un set de conversaciones etiquetadas no hay forma de saber si
 * un cambio de prompt/modelo mejora o empeora la asertividad del bot: hasta
 * hoy cada mejora se hizo de forma reactiva, a partir de un caso puntual que
 * un paciente real sufrió (casos Vicente, Patricia, Belén, Margarita, Carlos).
 *
 * SOLO LECTURA. No modifica ningún estado de conversación ni de turnos.
 *
 * Acceso: exclusivo super_admin (misma sesión del dashboard, sin secretos nuevos).
 *
 * ANONIMIZACIÓN (importante — son datos de pacientes en un contexto de salud):
 * antes de devolver nada se reemplazan teléfono, DNI, email y el nombre del
 * paciente (cuando lo conocemos por el patient snapshot) por marcadores. El
 * teléfono se sustituye por un hash corto y estable, de modo que se puedan
 * seguir agrupando los mensajes de una misma persona sin exponer el número.
 * La anonimización por regex nunca es perfecta con texto libre: revisá una
 * muestra del archivo antes de compartirlo fuera del equipo.
 *
 * Uso:
 *   GET /api/admin/export-conversations
 *   GET /api/admin/export-conversations?configId=<id>&limit=200&minMensajes=4
 *
 * Parámetros (todos opcionales):
 *   configId     — exportar solo esta clínica (default: todas)
 *   limit        — máximo de conversaciones por clínica (default 300, tope 2000)
 *   minMensajes  — descarta conversaciones más cortas que esto (default 2)
 */

import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { requireAuthFromRequest } from "@/lib/auth"
import { getAllWhatsAppConfigs } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { getPatientSnapshots } from "@/lib/conversations"

const CONVERSATION_PREFIX = "conversation:"
const CONVERSATION_CONTACTS_SET_PREFIX = "conversation_contacts:"

const DEFAULT_LIMIT = 300
const MAX_LIMIT = 2000

// Sal del hash de teléfono. No hace falta que sea secreta para el objetivo
// (evitar exponer números en el archivo); sí que sea estable dentro de un
// mismo export para poder agrupar por persona.
const HASH_SALT = "iris-conv-export-v1"

function hashPhone(phone: string): string {
  return "p_" + createHash("sha256").update(HASH_SALT + phone).digest("hex").slice(0, 8)
}

/**
 * Reemplaza datos identificatorios en texto libre.
 * `extraNombres` son nombres conocidos del paciente (del patient snapshot),
 * que es la parte que ninguna regex genérica puede detectar sola.
 */
function anonimizarTexto(texto: string, extraNombres: string[] = []): string {
  if (!texto) return ""
  let out = texto

  // Emails
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")

  // Teléfonos (con o sin +54, separadores varios, 8+ dígitos)
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[TELEFONO]" : m))

  // DNI: 7 u 8 dígitos sueltos (con o sin puntos)
  out = out.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}\b/g, "[DNI]")

  // Nombres conocidos del paciente (palabra completa, sin distinguir mayúsculas/acentos básicos)
  for (const nombre of extraNombres) {
    const limpio = (nombre || "").trim()
    if (limpio.length < 3) continue
    for (const parte of limpio.split(/\s+/)) {
      if (parte.length < 3) continue
      const escapado = parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      out = out.replace(new RegExp(`\\b${escapado}\\b`, "gi"), "[NOMBRE]")
    }
  }

  return out
}

export async function GET(request: Request) {
  try {
    const { session, error } = await requireAuthFromRequest(request)
    if (!session) {
      return NextResponse.json({ error: error || "No autenticado" }, { status: 401 })
    }
    if (session.role !== "super_admin") {
      return NextResponse.json({ error: "No autorizado — se requiere super_admin" }, { status: 403 })
    }

    const redis = getRedisClient()
    if (!redis) {
      return NextResponse.json({ error: "Redis no disponible" }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const configIdFiltro = searchParams.get("configId")
    const limit = Math.min(Number(searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT)
    const minMensajes = Math.max(Number(searchParams.get("minMensajes")) || 2, 1)

    const todasLasConfigs = await getAllWhatsAppConfigs()
    const configs = configIdFiltro ? todasLasConfigs.filter((c) => c.id === configIdFiltro) : todasLasConfigs

    if (configs.length === 0) {
      return NextResponse.json({ error: "No se encontraron configuraciones" }, { status: 404 })
    }

    const conversaciones: any[] = []
    const porClinica: Record<string, number> = {}

    for (const config of configs) {
      // 1) Teléfonos con conversación en esta clínica
      const phones = (await redis.smembers(`${CONVERSATION_CONTACTS_SET_PREFIX}${config.id}`)) as string[]
      if (!phones || phones.length === 0) continue

      const seleccionados = phones.slice(0, limit)

      // 2) Nombres conocidos (para anonimizar el texto libre)
      let snapshots = new Map<string, any>()
      try {
        snapshots = await getPatientSnapshots(config.id, seleccionados)
      } catch {
        // Sin snapshots seguimos igual — solo se pierde la redacción de nombres
      }

      // 3) Mensajes de cada conversación (pipeline: 1 round-trip para todas)
      const pipeline = redis.pipeline()
      seleccionados.forEach((phone) => pipeline.lrange(`${CONVERSATION_PREFIX}${config.id}:${phone}`, 0, -1))
      const resultados = (await pipeline.exec()) as any[]

      seleccionados.forEach((phone, i) => {
        const items = resultados[i]
        if (!Array.isArray(items) || items.length < minMensajes) return

        const snap = snapshots.get(phone)
        const nombres = [snap?.nombre, snap?.apellido, snap?.nombres].filter(Boolean) as string[]

        const mensajes = items
          .map((item: any) => {
            try {
              const m = typeof item === "string" ? JSON.parse(item) : item
              return {
                rol: m.role,
                texto: anonimizarTexto(m.content || "", nombres),
                timestamp: m.timestamp,
                tipo: m.messageType || "text",
              }
            } catch {
              return null
            }
          })
          .filter(Boolean)

        // Descartar conversaciones sin ningún mensaje del paciente: sin input
        // real del usuario no sirven para evaluar la clasificación de intención.
        if (!mensajes.some((m: any) => m.rol === "user")) return

        conversaciones.push({
          id: hashPhone(phone),
          clinica: config.displayName,
          configId: config.id,
          cantidadMensajes: mensajes.length,
          mensajes,
        })

        porClinica[config.displayName] = (porClinica[config.displayName] || 0) + 1
      })
    }

    // Más largas primero: son las que más señal tienen sobre fricción real
    conversaciones.sort((a, b) => b.cantidadMensajes - a.cantidadMensajes)

    return NextResponse.json({
      exportadoEl: new Date().toISOString(),
      nota: "Datos anonimizados (teléfono hasheado; DNI, email y nombres conocidos redactados). La redacción por regex sobre texto libre no es perfecta: revisar una muestra antes de compartir fuera del equipo.",
      totalConversaciones: conversaciones.length,
      totalMensajes: conversaciones.reduce((acc, c) => acc + c.cantidadMensajes, 0),
      porClinica,
      conversaciones,
    })
  } catch (error) {
    console.error("[EXPORT-CONVERSATIONS] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error exportando conversaciones" },
      { status: 500 },
    )
  }
}
