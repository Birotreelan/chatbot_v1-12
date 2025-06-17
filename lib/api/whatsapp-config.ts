import type { WhatsAppConfig } from "@/lib/types"

// Función para obtener la configuración de WhatsApp
export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  try {
    const response = await fetch("/api/dashboard/configs", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()

    // Si hay configuraciones, devolver la primera activa
    if (data.configs && data.configs.length > 0) {
      return data.configs.find((config: WhatsAppConfig) => config.active) || data.configs[0]
    }

    return null
  } catch (error) {
    console.error("Error fetching WhatsApp config:", error)
    throw error
  }
}

// Función para actualizar la configuración de WhatsApp
export async function updateWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  try {
    const response = await fetch("/api/dashboard/configs/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error updating WhatsApp config:", error)
    throw error
  }
}

// Función para crear una nueva configuración de WhatsApp
export async function createWhatsAppConfig(
  config: Omit<WhatsAppConfig, "id" | "createdAt" | "updatedAt">,
): Promise<WhatsAppConfig> {
  try {
    const response = await fetch("/api/dashboard/configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error("Error creating WhatsApp config:", error)
    throw error
  }
}

// Función para eliminar una configuración de WhatsApp
export async function deleteWhatsAppConfig(id: string): Promise<void> {
  try {
    const response = await fetch(`/api/dashboard/configs/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
  } catch (error) {
    console.error("Error deleting WhatsApp config:", error)
    throw error
  }
}
