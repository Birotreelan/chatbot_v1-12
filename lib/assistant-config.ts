// MIGRADO (27/8/2026): antes esto validaba el Assistant contra la Assistants
// API (beta.assistants.retrieve), dada de baja por OpenAI el 26/8/2026 —
// esa llamada ya devuelve 404 siempre. El motor real de conversación ya no
// usa Assistants/threads (ver lib/openai-responses.ts), así que no hay nada
// que "verificar" contra OpenAI acá. Se deja esta función como no-op que solo
// valida la env var, para no romper los endpoints admin que la llaman
// (app/api/update-assistant, app/api/reset-assistant) — ver PLAN-DE-TRABAJO.md.
export async function configureAssistant(): Promise<string> {
  const assistantId = process.env.OPENAI_ASSISTANT_ID

  if (!assistantId) {
    throw new Error("OPENAI_ASSISTANT_ID no está configurado en las variables de entorno")
  }

  console.log(`[ASSISTANT_CONFIG] OPENAI_ASSISTANT_ID configurado: ${assistantId}`)
  console.log(
    `[ASSISTANT_CONFIG] Nota: ya no se valida contra la Assistants API de OpenAI (dada de baja 26/8/2026). ` +
      `Las instrucciones reales en uso están en lib/openai-responses.ts, no en el panel de OpenAI.`,
  )

  return assistantId
}
