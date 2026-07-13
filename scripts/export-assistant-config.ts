/**
 * Fase 0 de la migración fuera de OpenAI Assistants API (deprecada, sunset
 * 26/8/2026 — ver PLAN-DE-TRABAJO.md).
 *
 * Las instructions del asistente principal viven SOLO en el dashboard de
 * OpenAI (assistant-config.ts lo dice explícitamente: "usando instrucciones
 * del panel de OpenAI"), no en el código. Este script las rescata ANTES de
 * que el objeto Assistant deje de existir: vuelca instructions, tools y
 * model completos a un JSON versionado en el repo, para no perder nada al
 * migrar a la Responses API (Fase 1/2).
 *
 * Uso: npx tsx scripts/export-assistant-config.ts
 * Requiere en el entorno: OPENAI_API_KEY, OPENAI_ASSISTANT_ID
 */

import OpenAI from "openai"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"

async function exportAssistantConfig() {
  const assistantId = process.env.OPENAI_ASSISTANT_ID
  if (!assistantId) {
    throw new Error("OPENAI_ASSISTANT_ID no está configurado en el entorno")
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY no está configurado en el entorno")
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  console.log(`=== Exportando configuración del Assistant ${assistantId} ===\n`)

  const assistant = await openai.beta.assistants.retrieve(assistantId)

  console.log(`Nombre: ${assistant.name}`)
  console.log(`Modelo: ${assistant.model}`)
  console.log(`Herramientas (tools) configuradas: ${assistant.tools?.length ?? 0}`)
  console.log(`Largo de las instructions: ${assistant.instructions?.length ?? 0} caracteres`)

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

  const outDir = join(process.cwd(), "docs", "assistant-backups")
  mkdirSync(outDir, { recursive: true })

  const dateStamp = new Date().toISOString().slice(0, 10)
  const outPath = join(outDir, `assistant-config-${dateStamp}.json`)
  writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8")

  console.log(`\nGuardado en: ${outPath}`)
  console.log("=== Exportación completada ===")
}

exportAssistantConfig()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error("Error exportando configuración del assistant:", error)
    process.exit(1)
  })
