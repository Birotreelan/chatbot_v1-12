import { getAllWhatsAppConfigs, updateWhatsAppConfig } from "./db"

export async function migrateWidgetSettings() {
  console.log("[MIGRATION] Iniciando migración de configuraciones del widget...")

  try {
    const configs = await getAllWhatsAppConfigs()
    let migratedCount = 0

    for (const config of configs) {
      // Si widgetEnabled no está definido, establecerlo como true
      if (config.widgetEnabled === undefined) {
        const updates: any = {
          widgetEnabled: true,
          widgetTitle: config.widgetTitle || "Asistente Virtual",
          widgetPrimaryColor: config.widgetPrimaryColor || "#0ea5e9",
          widgetSecondaryColor: config.widgetSecondaryColor || "#f0f9ff",
          widgetPosition: config.widgetPosition || "bottom-right",
          widgetWelcomeMessage: config.widgetWelcomeMessage || "¡Hola! ¿En qué puedo ayudarte hoy?",
          widgetPlaceholder: config.widgetPlaceholder || "Escribe tu mensaje...",
          widgetButtonText: config.widgetButtonText || "Enviar",
          widgetHeaderText: config.widgetHeaderText || "Chat de Soporte",
          widgetSubtitle: config.widgetSubtitle || "Estamos aquí para ayudarte",
          widgetBrandingEnabled: config.widgetBrandingEnabled !== undefined ? config.widgetBrandingEnabled : true,
          widgetBrandingText: config.widgetBrandingText || "Powered by AI",
          widgetMaxHeight: config.widgetMaxHeight || 600,
          widgetMaxWidth: config.widgetMaxWidth || 400,
          widgetBorderRadius: config.widgetBorderRadius || 12,
          widgetShadow: config.widgetShadow !== undefined ? config.widgetShadow : true,
          widgetAnimation: config.widgetAnimation !== undefined ? config.widgetAnimation : true,
          widgetSoundEnabled: config.widgetSoundEnabled !== undefined ? config.widgetSoundEnabled : true,
          widgetTheme: config.widgetTheme || "light",
        }

        await updateWhatsAppConfig(config.id, updates)
        migratedCount++
        console.log(`[MIGRATION] Configuración ${config.id} migrada exitosamente`)
      }
    }

    console.log(`[MIGRATION] Migración completada. ${migratedCount} configuraciones actualizadas.`)
    return { success: true, migratedCount }
  } catch (error) {
    console.error("[MIGRATION] Error durante la migración:", error)
    return { success: false, error }
  }
}
