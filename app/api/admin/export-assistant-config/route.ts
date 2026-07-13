import { NextRequest, NextResponse } from "next/server"
import { openai } from "@/lib/openai"

/**
 * Ruta TEMPORAL — Fase 0 de la migración fuera de OpenAI Assistants API
 * (deadline 26/8/2026, ver PLAN-DE-TRABAJO.md).
 *
 * Hace lo mismo que scripts/export-assistant-config.ts, pero corriendo en
 * Vercel (donde OPENAI_API_KEY/OPENAI_ASSISTANT_ID ya están configuradas)
 * en vez de requerir Node.js local + .env.local, que no estaban disponibles.
 *
 * Uso: GET /api/admin/export-assistant-config?token=<OPENAI_ASSISTANT_ID>
 * Borrar este archivo después de usarlo una vez — es solo para el respaldo
 * puntual de las instructions/tools del assistant antes de que desaparezca.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const assistantId = process.env.OPENAI_ASSISTANT_ID

  if (!assistantId) {
    return NextResponse.json({ success: false, error: "OPENAI_ASSISTANT_ID no configurado" }, { status: 500 })
  }

  // Protección mínima: el token debe coincidir con el propio assistantId
  // (no es un secreto nuevo que haya que generar/recordar, solo evita que
  // cualquiera que encuentre la URL por casualidad la pueda usar).
  if (!token || token !== assistantId) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
  }

  try {
    const assistant = await openai.beta.assistants.retrieve(assistantId)

    const backup = {
      exportedAt: new Date().toISOString(),
      reason: "Backup previo a la migración fuera de OpenAI Assistants API (sunset 26/8/2026)",
      assistantId: assistant.id,
      name: assistant.name,
      model: assistant.model,
      instructions: assistant.instructions,
      tools: assistant.tools,
      tool_resources: assistant.tool_resources ?? null,
      temperature: assistant.temperature ?? null,
      top_p: assistant.top_p ?? null,
      response_format: assistant.response_format ?? null,
      metadata: assistant.metadata ?? null,
    }

    return NextResponse.json(backup)
  } catch (error) {
    console.error("Error exportando configuración del assistant:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
