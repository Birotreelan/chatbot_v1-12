import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function adjustColor(color: string, amount: number): string {
  // Remove # if present
  const hex = color.replace("#", "")

  // Parse RGB values
  const r = Number.parseInt(hex.substr(0, 2), 16)
  const g = Number.parseInt(hex.substr(2, 2), 16)
  const b = Number.parseInt(hex.substr(4, 2), 16)

  // Adjust brightness
  const newR = Math.max(0, Math.min(255, r + amount))
  const newG = Math.max(0, Math.min(255, g + amount))
  const newB = Math.max(0, Math.min(255, b + amount))

  // Convert back to hex
  const toHex = (n: number) => n.toString(16).padStart(2, "0")

  return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`
}
