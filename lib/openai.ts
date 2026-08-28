import OpenAI from "openai"

// Inicializar el cliente de OpenAI de forma lazy para evitar errores en build-time
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

// Exportar como getter lazy para uso en otros módulos
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return getOpenAIClient()[prop as keyof OpenAI]
  },
})

// NOTA (27/8/2026): este archivo tenía además getAssistantResponse/
// waitForRunCompletion, una versión vieja y sin uso real (basada en
// beta.threads/beta.runs — Assistants API, dada de baja por OpenAI el
// 26/8/2026) que ni siquiera soportaba tools. Se confirmó sin ningún import
// real en el código (lib/whatsapp.tsx usa la versión de lib/openai-tools.tsx,
// hoy migrada a lib/openai-responses.ts) y se eliminó en la limpieza de esta
// migración. Ver PLAN-DE-TRABAJO.md, sección "5quinquies".
