import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Función para ajustar el brillo de un color hexadecimal
export function adjustColor(hex: string, amount: number): string {
  // Remover el # si está presente
  const color = hex.replace("#", "")

  // Convertir hex a RGB
  const num = Number.parseInt(color, 16)
  const r = Math.max(0, Math.min(255, (num >> 16) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount))
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount))

  // Convertir de vuelta a hex
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
}
