"use server"

import { revalidatePath } from "next/cache"
import {
  createWhatsAppConfig as createConfig,
  updateWhatsAppConfig as updateConfig,
  deleteWhatsAppConfig as deleteConfig,
  clearConfigCache, // Import cache clearing function
} from "@/lib/db"
import type { WhatsAppConfig } from "@/lib/types"

export async function createWhatsAppConfig(data: Partial<WhatsAppConfig>) {
  const config = await createConfig(data)
  revalidatePath("/dashboard")
  return config
}

export async function updateWhatsAppConfig(id: string, data: Partial<WhatsAppConfig>) {
  const config = await updateConfig(id, data)
  clearConfigCache(id)
  revalidatePath("/dashboard")
  revalidatePath(`/dashboard/config/${id}`)
  return config
}

export async function deleteWhatsAppConfig(id: string) {
  const result = await deleteConfig(id)
  clearConfigCache(id)
  revalidatePath("/dashboard")
  return result
}
