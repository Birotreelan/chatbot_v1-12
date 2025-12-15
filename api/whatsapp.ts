// API functions for WhatsApp configuration management

interface WhatsAppConfig {
  account_id: string
  phone_number_id: string
  access_token: string
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const response = await fetch("/api/dashboard/configs")
  if (!response.ok) {
    throw new Error("Failed to fetch WhatsApp config")
  }
  return response.json()
}

export async function updateWhatsAppConfig(config: WhatsAppConfig): Promise<WhatsAppConfig> {
  const response = await fetch("/api/dashboard/configs", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  })

  if (!response.ok) {
    throw new Error("Failed to update WhatsApp config")
  }

  return response.json()
}
