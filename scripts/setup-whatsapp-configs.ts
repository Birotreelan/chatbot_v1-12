// Script para configurar múltiples números de WhatsApp en Redis

import { kv } from "@vercel/kv"

async function setupWhatsAppConfigs() {
  // Configuración para Testing/Development (número de prueba)
  const testingConfig = {
    account_id: process.env.WHATSAPP_TEST_ACCOUNT_ID || "test_account",
    phone_number_id: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID!,
    access_token: process.env.WHATSAPP_TEST_TOKEN!,
    verify_token: process.env.WHATSAPP_TEST_VERIFY_TOKEN || "test_verify_token",
    assistant_id: process.env.OPENAI_TEST_ASSISTANT_ID || process.env.OPENAI_ASSISTANT_ID!,
    environment: "testing",
  }

  // Configuración para Production (número real)
  const productionConfig = {
    account_id: process.env.WHATSAPP_PROD_ACCOUNT_ID || "prod_account",
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    access_token: process.env.WHATSAPP_TOKEN!,
    verify_token: process.env.WHATSAPP_VERIFY_TOKEN!,
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    environment: "production",
  }

  try {
    // Guardar configuración de testing
    if (testingConfig.phone_number_id && testingConfig.access_token) {
      await kv.hset(`whatsapp:config:${testingConfig.phone_number_id}`, testingConfig)
      console.log(`✅ Configuración de testing guardada: ${testingConfig.phone_number_id}`)
    }

    // Guardar configuración de production
    if (productionConfig.phone_number_id && productionConfig.access_token) {
      await kv.hset(`whatsapp:config:${productionConfig.phone_number_id}`, productionConfig)
      console.log(`✅ Configuración de production guardada: ${productionConfig.phone_number_id}`)
    }

    // Listar todas las configuraciones
    const keys = await kv.keys("whatsapp:config:*")
    console.log(`\n📋 Configuraciones activas: ${keys.length}`)
    for (const key of keys) {
      const config = await kv.hgetall(key)
      console.log(`  - ${key}:`, {
        environment: config?.environment,
        phone_id: config?.phone_number_id,
      })
    }
  } catch (error) {
    console.error("❌ Error al configurar WhatsApp:", error)
    throw error
  }
}

setupWhatsAppConfigs()
  .then(() => console.log("\n✨ Configuración completada"))
  .catch((error) => console.error("\n💥 Error:", error))
