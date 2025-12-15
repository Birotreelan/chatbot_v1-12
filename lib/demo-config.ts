import type { WhatsAppConfig } from "@/lib/types"

export const DEMO_CONFIG: Partial<WhatsAppConfig> = {
  id: "demo-client",
  clienteId: "demo-client",
  name: "Configuración de Demostración",
  assistantId: process.env.NEXT_PUBLIC_DEFAULT_ASSISTANT_ID || "",
  whatsappToken: "",
  whatsappPhoneNumberId: "",
  isActive: true,

  // Configuración del widget
  widgetEnabled: true,
  widgetTitle: "Chat de Demostración",
  widgetHeaderText: "Asistente Virtual",
  widgetSubtitle: "Estamos aquí para ayudarte",
  widgetWelcomeMessage: "¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?",
  widgetPlaceholder: "Escribe tu mensaje aquí...",
  widgetButtonText: "Enviar",
  widgetPrimaryColor: "#0ea5e9",
  widgetSecondaryColor: "#f0f9ff",
  widgetBrandingEnabled: true,
  widgetBrandingText: "Powered by AI Assistant",

  createdAt: new Date(),
  updatedAt: new Date(),
}

export async function ensureDemoConfig() {
  try {
    const { getConfigByClienteId, createConfig } = await import("@/lib/db")

    // Verificar si ya existe la configuración de demo
    const existingConfig = await getConfigByClienteId("demo-client")

    if (!existingConfig) {
      // Crear la configuración de demo
      await createConfig(DEMO_CONFIG as WhatsAppConfig)
      console.log("Configuración de demo creada")
    }

    return true
  } catch (error) {
    console.error("Error al crear configuración de demo:", error)
    return false
  }
}
