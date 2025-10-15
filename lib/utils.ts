import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalizes a phone number by removing all non-digit characters
 * This ensures consistent thread lookups across different phone number formats
 * @param phone - Phone number in any format (e.g., "+5493413121395", "5493413121395", "3413121395")
 * @returns Normalized phone number with only digits
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return ""
  // Remove all non-digit characters (including +, spaces, dashes, parentheses, etc.)
  return phone.replace(/\D/g, "")
}
