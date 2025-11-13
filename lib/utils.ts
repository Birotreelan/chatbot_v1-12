import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizes a phone number by removing all non-digit characters and country codes
 * This ensures consistent thread lookups across different phone number formats
 *
 * Examples:
 * - "+5493413121395" → "3413121395"
 * - "5493413121395" → "3413121395"
 * - "3413121395" → "3413121395"
 *
 * For web session IDs (starting with "web_"), returns the ID as-is without normalization
 *
 * @param phone - Phone number in any format or web session ID
 * @returns Normalized phone number (local number without country code) or original web session ID
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return ""

  if (phone.startsWith("web_")) {
    console.log(`[UTILS] Web session ID detected, skipping normalization: "${phone}"`)
    return phone
  }

  // Remove all non-digit characters (including +, spaces, dashes, parentheses, etc.)
  let normalized = phone.replace(/\D/g, "")

  // Remove Argentina country code (549) if present at the start
  if (normalized.startsWith("549")) {
    normalized = normalized.substring(3)
  }

  console.log(`[UTILS] Phone normalization: "${phone}" → "${normalized}"`)

  return normalized
}
