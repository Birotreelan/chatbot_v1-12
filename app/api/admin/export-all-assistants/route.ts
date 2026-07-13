import { NextRequest, NextResponse } from "next/server"
import { openai } from "@/lib/openai"
import { getAllWhatsAppConfigs } from "@/lib/db"

/**
 * Ruta TEMPORAL — Fase 0/1 de la migración fuera de OpenAI Assistants API
 * (deadline 26/8/2026, ver PLAN-DE-TRABAJO.md).
 *
 * El asistente usado en WhatsApp (`config.whatsappAssistantId`) es POR CLÍNICA,
 * no un único valor global — el respaldo anterior (export-assistant-config)
 * solo cubrió el assistantId del env var, no necesariamente el de cada clínica.
 * Esta ruta recorre todas las clínicas (getAllWhatsAppConfigs), junta los
 * whatsappAssistantId únicos, y exporta instructions/tools/model de cada uno.
 *
 * Uso: GET /api/admin/export-all-assistants?token=<OPENAI_ASSISTANT_ID>
 * Borrar este archivo después de usarlo una vez.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  const gate = process.env.OPENAI_ASSISTANT_ID

  if (!gate || !token || token !== gate) {
    return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
  }

  try {
    const configs = await getAllWhatsAppConfigs()

    const clinicas = configs.map((c) => ({
      configId: c.id,
      clienteId: c.cliente_id,
      displayName: c.displayName,
      whatsappAssistantId: c.whatsappAssistantId || null,
      widgetAssistantId: c.widgetAssistantId || null,
    }))

    let uniqueAssistantIds = Array.from(
      new Set(configs.map((c) => c.whatsappAssistantId).filter((id): id is string => !!id)),
    )

    const onlyParam = request.nextUrl.searchParams.get("only")
    if (onlyParam) {
      const wanted = new Set(onlyParam.split(",").map((s) => s.trim()).filter(Boolean))
      uniqueAssistantIds = uniqueAssistantIds.filter((id) => wanted.has(id))
    }

    const idsOnly = request.nextUrl.searchParams.get("idsOnly")
    if (idsOnly === "1") {
      return NextResponse.json({
        exportedAt: new Date().toISOString(),
        totalClinicas: configs.length,
        clinicas,
        uniqueAssistantIds,
      })
    }

    const assistants: Record<string, unknown> = {}
    for (const assistantId of uniqueAssistantIds) {
      try {
        const assistant = await openai.beta.assistants.retrieve(assistantId)
        assistants[assistantId] = {
          name: assistant.name,
          model: assistant.model,
          instructions: assistant.instructions,
          tools: assistant.tools,
          tool_resources: assistant.tool_resources ?? null,
          temperature: assistant.temperature ?? null,
          top_p: assistant.top_p ?? null,
        }
      } catch (err) {
        assistants[assistantId] = {
          error: err instanceof Error ? err.message : "Error desconocido al recuperar este assistant",
        }
      }
    }

    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      totalClinicas: configs.length,
      clinicas,
      uniqueAssistantIdsCount: uniqueAssistantIds.length,
      assistants,
    })
  } catch (error) {
    console.error("Error exportando todos los assistants:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Error desconocido" },
      { status: 500 },
    )
  }
}
